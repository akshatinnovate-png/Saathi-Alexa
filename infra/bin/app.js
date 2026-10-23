import { App } from 'aws-cdk-lib';
import { SaathiStack } from '../lib/saathi-stack.js';

const app = new App();
new SaathiStack(app, 'Saathi', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' },
  description: 'Saathi - Alexa+ MCP server for elders and their care circle',
});
