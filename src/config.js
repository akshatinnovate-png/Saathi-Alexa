import { fileURLToPath } from 'node:url';
const env = process.env;

const flag = (name, fallback = false) => {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

const useAws = flag('SAATHI_USE_AWS');

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '127.0.0.1',
  region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? 'us-east-1',
  dataFile: env.SAATHI_DATA_FILE ?? fileURLToPath(new URL('../data/saathi.json', import.meta.url)),
  timezone: env.SAATHI_TIMEZONE ?? 'Asia/Kolkata',

  aws: {
    translate: flag('SAATHI_AWS_TRANSLATE', useAws),
    polly: flag('SAATHI_AWS_POLLY', useAws),
    comprehend: flag('SAATHI_AWS_COMPREHEND', useAws),
    dynamodb: flag('SAATHI_AWS_DYNAMODB', useAws),
    eventbridge: flag('SAATHI_AWS_EVENTBRIDGE', useAws),
    stepfunctions: flag('SAATHI_AWS_STEPFUNCTIONS', useAws),
    sns: flag('SAATHI_AWS_SNS', useAws),
    s3: flag('SAATHI_AWS_S3', useAws),
  },

  resources: {
    tableName: env.SAATHI_TABLE ?? 'saathi',
    eventBusName: env.SAATHI_EVENT_BUS ?? 'saathi-bus',
    escalationStateMachineArn: env.SAATHI_ESCALATION_SFN_ARN ?? '',
    familyTopicArn: env.SAATHI_FAMILY_TOPIC_ARN ?? '',
    mediaBucket: env.SAATHI_MEDIA_BUCKET ?? '',
  },

  agent: {
    provider: env.SAATHI_AGENT_PROVIDER ?? (flag('SAATHI_USE_BEDROCK', useAws) ? 'bedrock' : env.ANTHROPIC_API_KEY ? 'anthropic' : 'offline'),
    model: env.SAATHI_MODEL ?? 'claude-opus-5-5',
    bedrockModel: env.SAATHI_BEDROCK_MODEL ?? 'anthropic.claude-opus-5-5',
  },

  auth: {
    mode: env.SAATHI_AUTH_MODE ?? (env.SAATHI_COGNITO_USER_POOL_ID ? 'cognito' : env.SAATHI_MCP_TOKEN ? 'static' : 'none'),
    elderToken: env.SAATHI_MCP_TOKEN || undefined,
    familyToken: env.SAATHI_FAMILY_TOKEN || undefined,
    region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? 'us-east-1',
    userPoolId: env.SAATHI_COGNITO_USER_POOL_ID,
    clientIds: (env.SAATHI_COGNITO_CLIENT_IDS ?? '').split(',').filter(Boolean),
    domain: env.SAATHI_COGNITO_DOMAIN,
    publicUrl: env.SAATHI_PUBLIC_URL,
    webClientId: env.SAATHI_COGNITO_WEB_CLIENT_ID,
    socialProviders: (env.SAATHI_SOCIAL_PROVIDERS ?? '').split(',').map((p) => p.trim()).filter(Boolean),
  },

  web: {
    requireLogin: env.SAATHI_REQUIRE_LOGIN !== 'false',
    sessionSecret: env.SAATHI_SESSION_SECRET || undefined,
    demoAccounts: env.SAATHI_DEMO_ACCOUNTS !== 'false',
  },

  ring: {
    webhookSecret: env.SAATHI_RING_WEBHOOK_SECRET || 'local-ring-simulator-secret',
    webhookSecretArn: env.SAATHI_RING_WEBHOOK_SECRET_ARN,
  },

  escalation: {
    familyAckWaitSeconds: Number(env.SAATHI_FAMILY_ACK_WAIT ?? 20),
    neighbourAckWaitSeconds: Number(env.SAATHI_NEIGHBOUR_ACK_WAIT ?? 20),
  },
};
