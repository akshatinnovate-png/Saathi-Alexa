import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SNSClient, PublishCommand, SubscribeCommand } from '@aws-sdk/client-sns';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

export const EVENT_SOURCE = 'saathi.companion';

export function createAwsEventBus({ region, eventBusName, client, local } = {}) {
  const eb = client ?? new EventBridgeClient({ region });
  return {
    kind: 'amazon-eventbridge',
    async publish(detailType, detail) {
      const out = await eb.send(new PutEventsCommand({
        Entries: [{ EventBusName: eventBusName, Source: EVENT_SOURCE, DetailType: detailType, Detail: JSON.stringify(detail) }],
      }));
      if (out.FailedEntryCount) throw new Error(`EventBridge rejected ${detailType}: ${out.Entries?.[0]?.ErrorMessage}`);
      local?.publish(detailType, detail, { mirrorOnly: true });
      return out.Entries?.[0]?.EventId;
    },
    subscribe: (...args) => local?.subscribe(...args),
  };
}

export function createAwsNotifier({ region, topicArn, client } = {}) {
  const sns = client ?? new SNSClient({ region });
  return {
    kind: 'amazon-sns',
    async notify({ audience, subject, message, severity = 'info', recipientId, householdId }) {
      const out = await sns.send(new PublishCommand({
        TopicArn: topicArn,
        Subject: subject.slice(0, 99),
        Message: message,
        MessageAttributes: {
          audience: { DataType: 'String', StringValue: audience },
          severity: { DataType: 'String', StringValue: severity },
          ...(recipientId ? { recipient: { DataType: 'String', StringValue: recipientId } } : {}),
          ...(householdId ? { household: { DataType: 'String', StringValue: householdId } } : {}),
        },
      }));
      return out.MessageId;
    },
    async subscribe({ email, householdId, memberId, audiences }) {
      const out = await sns.send(new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'email',
        Endpoint: email,
        ReturnSubscriptionArn: true,
        Attributes: {
          FilterPolicy: JSON.stringify({
            household: [householdId],
            audience: audiences,
            ...(memberId ? { recipient: [memberId, { exists: false }] } : {}),
          }),
        },
      }));
      return out.SubscriptionArn;
    },
  };
}

export function createAwsMedia({ region, bucket, client } = {}) {
  const s3 = client ?? new S3Client({ region });
  return {
    kind: 'amazon-s3',
    async save(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
      return `s3://${bucket}/${key}`;
    },
    async playbackUrl(ref, expiresIn = 3600) {
      const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(ref ?? '');
      if (!match) return ref;
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: match[1], Key: match[2] }), { expiresIn });
    },
  };
}

export function createAwsEscalation({ region, stateMachineArn, client } = {}) {
  const sfn = client ?? new SFNClient({ region });
  return {
    kind: 'aws-step-functions',
    async start(input) {
      const out = await sfn.send(new StartExecutionCommand({
        stateMachineArn,
        name: `escalation-${input.alertId}`,
        input: JSON.stringify(input),
      }));
      return out.executionArn;
    },
  };
}
