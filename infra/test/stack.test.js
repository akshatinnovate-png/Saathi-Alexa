import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SaathiStack } from '../lib/saathi-stack.js';

const app = new App({ context: { familyEmails: 'riya@example.com', neighbourEmails: 'meera@example.com', 'aws:cdk:bundling-stacks': [] } });
const template = Template.fromStack(new SaathiStack(app, 'Test', { env: { region: 'us-east-1' } }));

test('HelpRequested events start the escalation state machine with the escalation payload', () => {
  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: { source: ['saathi.companion'], 'detail-type': ['HelpRequested'] },
    Targets: Match.arrayWith([Match.objectLike({ InputPath: '$.detail.escalation' })]),
  });
});

test('state machine is deployed from the same ASL file the local interpreter runs', () => {
  const [sm] = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));
  const body = JSON.stringify(sm.Properties.DefinitionString);
  assert.match(body, /WaitForFamily/);
  assert.match(body, /arn:aws:states:::dynamodb:getItem/);
  assert.ok(sm.Properties.DefinitionSubstitutions.TableName);
});

test('neighbours are filtered to escalations only', () => {
  template.hasResourceProperties('AWS::SNS::Subscription', {
    Endpoint: 'meera@example.com',
    FilterPolicy: { audience: ['neighbour', 'everyone'] },
  });
});

test('MCP Lambda is ARM64 Node 22 with X-Ray and least-privilege AI service access', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'mcp.handler', Runtime: 'nodejs22.x', Architectures: ['arm64'], TracingConfig: { Mode: 'Active' },
  });
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: ['translate:TranslateText', 'comprehend:DetectSentiment', 'comprehend:DetectDominantLanguage', 'polly:SynthesizeSpeech'] })]) },
  });
});

test('Streamable HTTP routes exist for POST, GET and DELETE /mcp', () => {
  for (const verb of ['POST', 'GET', 'DELETE']) template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: `${verb} /mcp` });
});

test('missed-dose sweep runs on EventBridge Scheduler every 15 minutes', () => {
  template.hasResourceProperties('AWS::Scheduler::Schedule', { ScheduleExpression: 'rate(15 minutes)' });
});

test('Cognito is the OAuth server: saathi/elder and saathi/family scopes, per-device clients', () => {
  template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
    Identifier: 'saathi',
    Scopes: [{ ScopeName: 'elder', ScopeDescription: Match.anyValue() }, { ScopeName: 'family', ScopeDescription: Match.anyValue() }],
  });
  template.resourceCountIs('AWS::Cognito::UserPoolClient', 3);
  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'mcp.handler',
    Environment: { Variables: Match.objectLike({ SAATHI_AUTH_MODE: 'cognito' }) },
  });
});

test('Ring doorbell webhook has its own Lambda, route and signing secret', () => {
  template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /ring/events' });
  template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /.well-known/oauth-protected-resource/{proxy+}' });
  template.hasResourceProperties('AWS::Lambda::Function', { Handler: 'ring.handler' });
});
