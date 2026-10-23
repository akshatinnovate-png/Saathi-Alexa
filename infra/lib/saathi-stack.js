import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  Stack, Duration, RemovalPolicy, CfnOutput, AssetHashType, DockerImage, TimeZone,
  aws_dynamodb as dynamodb, aws_s3 as s3, aws_sns as sns, aws_sns_subscriptions as subs,
  aws_events as events, aws_events_targets as targets, aws_stepfunctions as sfn,
  aws_lambda as lambda, aws_iam as iam, aws_logs as logs, aws_secretsmanager as secrets,
  aws_cloudwatch as cloudwatch, aws_cloudwatch_actions as cwActions,
  aws_scheduler as scheduler, aws_scheduler_targets as schedulerTargets,
  aws_apigatewayv2 as apigw, aws_apigatewayv2_integrations as integrations, aws_cognito as cognito,
} from 'aws-cdk-lib';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

function filesUnder(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

export function serverSourceHash() {
  const hash = createHash('sha256');
  for (const file of [...filesUnder(join(repoRoot, 'src')), join(repoRoot, 'package.json'), join(repoRoot, 'package-lock.json')]) {
    hash.update(file.slice(repoRoot.length)).update(readFileSync(file));
  }
  return hash.digest('hex');
}

export const LAMBDA_ENTRIES = { mcp: 'src/lambda/mcp.js', ring: 'src/lambda/ring.js', sweep: 'src/lambda/sweep.js', digest: 'src/lambda/digest.js' };

export function bundleServer(outputDir) {
  buildSync({
    entryPoints: Object.fromEntries(Object.entries(LAMBDA_ENTRIES).map(([name, path]) => [name, join(repoRoot, path)])),
    outdir: outputDir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: true,
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'error',
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  });
  return true;
}

export class SaathiStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const list = (key) => (this.node.tryGetContext(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean);

    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const media = new s3.Bucket(this, 'Media', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ transitions: [{ storageClass: s3.StorageClass.INTELLIGENT_TIERING, transitionAfter: Duration.days(30) }] }],
    });

    const circleTopic = new sns.Topic(this, 'CareCircle', { displayName: 'Saathi care circle' });
    for (const email of list('familyEmails')) {
      circleTopic.addSubscription(new subs.EmailSubscription(email, {
        filterPolicy: { audience: sns.SubscriptionFilter.stringFilter({ allowlist: ['family', 'everyone'] }) },
      }));
    }
    for (const email of list('neighbourEmails')) {
      circleTopic.addSubscription(new subs.EmailSubscription(email, {
        filterPolicy: { audience: sns.SubscriptionFilter.stringFilter({ allowlist: ['neighbour', 'everyone'] }) },
      }));
    }

    const opsTopic = new sns.Topic(this, 'Ops', { displayName: 'Saathi operations' });
    for (const email of list('opsEmail')) opsTopic.addSubscription(new subs.EmailSubscription(email));

    const escalationLogs = new logs.LogGroup(this, 'EscalationLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    const escalation = new sfn.StateMachine(this, 'Escalation', {
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromString(readFileSync(join(repoRoot, 'src', 'escalation', 'escalation.asl.json'), 'utf8')),
      definitionSubstitutions: { TableName: table.tableName, FamilyTopicArn: circleTopic.topicArn },
      tracingEnabled: true,
      logs: { destination: escalationLogs, level: sfn.LogLevel.ALL },
      timeout: Duration.hours(1),
    });
    table.grant(escalation, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    circleTopic.grantPublish(escalation);

    const bus = new events.EventBus(this, 'Bus', { eventBusName: `saathi-bus-${this.stackName.toLowerCase()}` });
    bus.archive('CareEventArchive', {
      archiveName: `saathi-care-events-${this.stackName.toLowerCase()}`,
      description: 'Every care event, replayable for audits and debugging',
      eventPattern: { source: ['saathi.companion'] },
      retention: Duration.days(365),
    });
    new events.Rule(this, 'HelpRequestedToEscalation', {
      eventBus: bus,
      description: 'Start the care-circle escalation whenever help is requested',
      eventPattern: { source: ['saathi.companion'], detailType: ['HelpRequested'] },
      targets: [new targets.SfnStateMachine(escalation, { input: events.RuleTargetInput.fromEventPath('$.detail.escalation') })],
    });

    const userPool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: { minLength: 12 },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const elderScope = new cognito.ResourceServerScope({ scopeName: 'elder', scopeDescription: "Act as the elder's own device" });
    const familyScope = new cognito.ResourceServerScope({ scopeName: 'family', scopeDescription: 'Read summaries and acknowledge alerts' });
    const resourceServer = userPool.addResourceServer('Saathi', { identifier: 'saathi', scopes: [elderScope, familyScope] });
    const domainPrefix = this.node.tryGetContext('cognitoDomainPrefix') || `saathi-${this.node.addr.slice(0, 12)}`;
    const domain = userPool.addDomain('Domain', { cognitoDomain: { domainPrefix } });
    const callbackUrls = list('oauthCallbackUrls').length ? list('oauthCallbackUrls') : ['https://localhost:6274/oauth/callback'];
    const elderClient = userPool.addClient('ElderDevice', {
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.resourceServer(resourceServer, elderScope), cognito.OAuthScope.resourceServer(resourceServer, familyScope)],
        callbackUrls,
      },
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });
    const familyClient = userPool.addClient('FamilyDevice', {
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.resourceServer(resourceServer, familyScope)],
        callbackUrls,
      },
      accessTokenValidity: Duration.hours(1),
    });
    const serviceClient = userPool.addClient('Service', {
      generateSecret: true,
      oAuth: { flows: { clientCredentials: true }, scopes: [cognito.OAuthScope.resourceServer(resourceServer, elderScope)] },
      accessTokenValidity: Duration.hours(1),
    });

    const ringSecret = new secrets.Secret(this, 'RingWebhookSecret', {
      description: 'HMAC secret for Ring doorbell event webhooks',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });

    const code = lambda.Code.fromAsset(join(repoRoot, 'src'), {
      assetHashType: AssetHashType.CUSTOM,
      assetHash: serverSourceHash(),
      bundling: {
        image: DockerImage.fromRegistry('public.ecr.aws/sam/build-nodejs22.x'),
        local: { tryBundle: (outputDir) => bundleServer(outputDir) },
      },
    });
    const environment = {
      SAATHI_USE_AWS: 'true',
      SAATHI_USE_BEDROCK: 'false',
      SAATHI_TABLE: table.tableName,
      SAATHI_EVENT_BUS: bus.eventBusName,
      SAATHI_FAMILY_TOPIC_ARN: circleTopic.topicArn,
      SAATHI_MEDIA_BUCKET: media.bucketName,
      SAATHI_ESCALATION_SFN_ARN: escalation.stateMachineArn,
      SAATHI_AUTH_MODE: 'cognito',
      SAATHI_COGNITO_USER_POOL_ID: userPool.userPoolId,
      SAATHI_COGNITO_CLIENT_IDS: [elderClient, familyClient, serviceClient].map((c) => c.userPoolClientId).join(','),
      SAATHI_COGNITO_DOMAIN: domainPrefix,
      SAATHI_RING_WEBHOOK_SECRET_ARN: ringSecret.secretArn,
      SAATHI_FAMILY_ACK_WAIT: '300',
      SAATHI_NEIGHBOUR_ACK_WAIT: '300',
      NODE_OPTIONS: '--enable-source-maps',
    };
    const common = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      code,
      environment,
      tracing: lambda.Tracing.ACTIVE,
    };

    const mcpFn = new lambda.Function(this, 'McpServer', {
      ...common,
      handler: 'mcp.handler',
      memorySize: 1024,
      timeout: Duration.seconds(29),
      description: 'Saathi MCP server (Streamable HTTP, stateless, spec 2025-11-25)',
      logGroup: new logs.LogGroup(this, 'McpLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
    });
    const sweepFn = new lambda.Function(this, 'MissedDoseSweep', {
      ...common,
      handler: 'sweep.handler',
      memorySize: 512,
      timeout: Duration.seconds(60),
      description: 'Raises gentle reminders for tablets not confirmed',
      logGroup: new logs.LogGroup(this, 'SweepLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
    });

    const ringFn = new lambda.Function(this, 'RingEvents', {
      ...common,
      handler: 'ring.handler',
      memorySize: 512,
      timeout: Duration.seconds(15),
      description: 'Verifies and processes Ring doorbell events',
      logGroup: new logs.LogGroup(this, 'RingLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
    });
    ringSecret.grantRead(ringFn);

    const digestFn = new lambda.Function(this, 'WeeklyLetters', {
      ...common,
      handler: 'digest.handler',
      memorySize: 512,
      timeout: Duration.minutes(2),
      description: 'Sunday letter to each family member, in their language',
      logGroup: new logs.LogGroup(this, 'DigestLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
    });

    for (const fn of [mcpFn, sweepFn, ringFn, digestFn]) {
      table.grantReadWriteData(fn);
      bus.grantPutEventsTo(fn);
      circleTopic.grantPublish(fn);
      media.grantPut(fn);
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['translate:TranslateText', 'comprehend:DetectSentiment', 'comprehend:DetectDominantLanguage', 'polly:SynthesizeSpeech'],
        resources: ['*'],
      }));
    }
    escalation.grantStartExecution(mcpFn);

    new scheduler.Schedule(this, 'SweepSchedule', {
      schedule: scheduler.ScheduleExpression.rate(Duration.minutes(15)),
      target: new schedulerTargets.LambdaInvoke(sweepFn, {}),
      description: 'Missed-dose, refill, appointment and quiet-day sweep',
    });
    new scheduler.Schedule(this, 'WeeklyLetterSchedule', {
      schedule: scheduler.ScheduleExpression.cron({ minute: '0', hour: '18', weekDay: 'SUN', timeZone: TimeZone.ASIA_KOLKATA }),
      target: new schedulerTargets.LambdaInvoke(digestFn, {}),
      description: 'Weekly family letter, Sunday 18:00 India time',
    });

    const httpApi = new apigw.HttpApi(this, 'McpApi', {
      description: 'Public Streamable HTTP endpoint for Alexa+',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.DELETE],
        allowHeaders: ['authorization', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'],
        exposeHeaders: ['mcp-session-id'],
      },
    });
    httpApi.addRoutes({
      path: '/mcp',
      methods: [apigw.HttpMethod.POST, apigw.HttpMethod.GET, apigw.HttpMethod.DELETE],
      integration: new integrations.HttpLambdaIntegration('McpIntegration', mcpFn),
    });
    httpApi.addRoutes({
      path: '/.well-known/oauth-protected-resource/{proxy+}',
      methods: [apigw.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('MetadataIntegration', mcpFn),
    });
    httpApi.addRoutes({
      path: '/ring/events',
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('RingIntegration', ringFn),
    });
    const stage = httpApi.defaultStage.node.defaultChild;
    stage.defaultRouteSettings = { throttlingBurstLimit: 50, throttlingRateLimit: 20 };

    const metric = (name, stat = 'Sum') => new cloudwatch.Metric({ namespace: 'Saathi', metricName: name, statistic: stat, period: Duration.hours(1) });
    const failedEscalations = escalation.metricFailed({ period: Duration.minutes(5) });
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', { dashboardName: `Saathi-${this.stackName}` });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({ title: 'Care signals', left: [metric('CheckIn'), metric('HelpRequested'), metric('DoseMissed'), metric('DoseTaken')], width: 12 }),
      new cloudwatch.GraphWidget({ title: 'Connection', left: [metric('MessageSent'), metric('StorySaved'), metric('TranslationFailure')], width: 12 }),
      new cloudwatch.GraphWidget({ title: 'Front door (Ring)', left: [metric('DoorActivity'), metric('HelpRequestDeduplicated')], width: 12 }),
      new cloudwatch.GraphWidget({ title: 'Care logistics', left: [metric('RefillNeeded'), metric('VoiceNote'), metric('WeeklyLetter')], width: 12 }),
      new cloudwatch.GraphWidget({ title: 'Escalations', left: [escalation.metricStarted(), escalation.metricSucceeded(), failedEscalations], width: 12 }),
      new cloudwatch.GraphWidget({ title: 'MCP Lambda', left: [mcpFn.metricInvocations(), mcpFn.metricErrors()], right: [mcpFn.metricDuration({ statistic: 'p95' })], width: 12 }),
    );

    const alarms = [
      new cloudwatch.Alarm(this, 'EscalationFailed', {
        metric: failedEscalations, threshold: 1, evaluationPeriods: 1,
        alarmDescription: 'An escalation workflow failed: someone who asked for help may not have been reached',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'McpErrors', {
        metric: mcpFn.metricErrors({ period: Duration.minutes(5) }), threshold: 3, evaluationPeriods: 1,
        alarmDescription: 'The MCP server Lambda is erroring',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    for (const alarm of alarms) alarm.addAlarmAction(new cwActions.SnsAction(opsTopic));

    new CfnOutput(this, 'McpEndpoint', { value: `${httpApi.apiEndpoint}/mcp`, description: 'Register this URL as the Alexa+ MCP server' });
    new CfnOutput(this, 'OAuthIssuer', { value: `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}` });
    new CfnOutput(this, 'OAuthDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'ElderDeviceClientId', { value: elderClient.userPoolClientId });
    new CfnOutput(this, 'FamilyDeviceClientId', { value: familyClient.userPoolClientId });
    new CfnOutput(this, 'ServiceClientId', { value: serviceClient.userPoolClientId });
    new CfnOutput(this, 'RingWebhookUrl', { value: `${httpApi.apiEndpoint}/ring/events` });
    new CfnOutput(this, 'RingWebhookSecretArn', { value: ringSecret.secretArn });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'EventBusName', { value: bus.eventBusName });
    new CfnOutput(this, 'CareCircleTopicArn', { value: circleTopic.topicArn });
    new CfnOutput(this, 'EscalationStateMachineArn', { value: escalation.stateMachineArn });
    new CfnOutput(this, 'MediaBucketName', { value: media.bucketName });
  }
}
