import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockClient } from 'aws-sdk-client-mock';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { ComprehendClient, DetectSentimentCommand } from '@aws-sdk/client-comprehend';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createAwsTranslator, createAwsSentiment, createAwsSpeech } from '../src/aws/language.js';
import { createAwsEventBus, createAwsNotifier, createAwsEscalation, EVENT_SOURCE } from '../src/aws/platform.js';
import { createDynamoStore } from '../src/aws/dynamoStore.js';
import { createMetrics } from '../src/aws/metrics.js';

test('Amazon Translate: auto-detects source language and masks profanity', async () => {
  const mock = mockClient(TranslateClient);
  mock.on(TranslateTextCommand).resolves({ TranslatedText: 'I feel lonely today', SourceLanguageCode: 'mr' });
  const t = createAwsTranslator({ client: new TranslateClient({ region: 'us-east-1' }) });
  const out = await t.translate('मला आज एकटं वाटतंय', { to: 'en' });
  assert.deepEqual(out, { text: 'I feel lonely today', from: 'mr', to: 'en', translated: true, engine: 'amazon-translate' });
  const input = mock.commandCalls(TranslateTextCommand)[0].args[0].input;
  assert.equal(input.SourceLanguageCode, 'auto');
  assert.equal(input.Settings.Profanity, 'MASK');
});

test('Amazon Comprehend: Marathi is translated to English before sentiment, Hindi is analysed directly', async () => {
  const comprehend = mockClient(ComprehendClient);
  comprehend.on(DetectSentimentCommand).resolves({ Sentiment: 'NEGATIVE', SentimentScore: { Negative: 0.93, Positive: 0.01, Neutral: 0.05, Mixed: 0.01 } });
  const translated = [];
  const translator = { translate: async (text, opts) => { translated.push(opts); return { text: 'I feel lonely' }; } };
  const s = createAwsSentiment({ client: new ComprehendClient({ region: 'us-east-1' }), translator });

  const mr = await s.analyze('मला एकटं वाटतंय', 'mr');
  assert.equal(mr.sentiment, 'NEGATIVE');
  assert.equal(mr.analysedLanguage, 'en');
  assert.deepEqual(translated, [{ from: 'mr', to: 'en' }]);

  await s.analyze('मुझे अकेलापन लग रहा है', 'hi');
  assert.equal(comprehend.commandCalls(DetectSentimentCommand)[1].args[0].input.LanguageCode, 'hi');
  assert.equal(translated.length, 1);
});

test('Amazon Polly: neural SSML with slowed prosody; no voice means null', async () => {
  const polly = mockClient(PollyClient);
  polly.on(SynthesizeSpeechCommand).resolves({ AudioStream: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } });
  const sp = createAwsSpeech({ client: new PollyClient({ region: 'us-east-1' }) });
  const out = await sp.synthesize('Namaste <Aaji> & family', 'hi', { slow: true });
  assert.equal(out.audio.length, 3);
  const input = polly.commandCalls(SynthesizeSpeechCommand)[0].args[0].input;
  assert.equal(input.Engine, 'neural');
  assert.equal(input.VoiceId, 'Kajal');
  assert.equal(input.Text, '<speak><prosody rate="85%">Namaste &lt;Aaji&gt; &amp; family</prosody></speak>');
  assert.equal(await sp.synthesize('வணக்கம்', 'ta'), null);
});

test('Amazon EventBridge: domain events land on the custom bus and fail loudly', async () => {
  const eb = mockClient(EventBridgeClient);
  eb.on(PutEventsCommand).resolvesOnce({ FailedEntryCount: 0, Entries: [{ EventId: 'e1' }] })
    .resolvesOnce({ FailedEntryCount: 1, Entries: [{ ErrorMessage: 'nope' }] });
  const bus = createAwsEventBus({ eventBusName: 'saathi-bus', client: new EventBridgeClient({ region: 'us-east-1' }) });
  assert.equal(await bus.publish('HelpRequested', { alertId: 'a1' }), 'e1');
  const entry = eb.commandCalls(PutEventsCommand)[0].args[0].input.Entries[0];
  assert.equal(entry.Source, EVENT_SOURCE);
  assert.equal(entry.EventBusName, 'saathi-bus');
  await assert.rejects(bus.publish('X', {}), /nope/);
});

test('Amazon SNS: message attributes drive subscription filter policies', async () => {
  const sns = mockClient(SNSClient);
  sns.on(PublishCommand).resolves({ MessageId: 'm1' });
  const n = createAwsNotifier({ topicArn: 'arn:aws:sns:us-east-1:1:circle', client: new SNSClient({ region: 'us-east-1' }) });
  await n.notify({ audience: 'family', severity: 'gentle', subject: 'x'.repeat(150), message: 'hi', recipientId: 'riya' });
  const input = sns.commandCalls(PublishCommand)[0].args[0].input;
  assert.equal(input.Subject.length, 99);
  assert.equal(input.MessageAttributes.recipient.StringValue, 'riya');
  assert.equal(input.MessageAttributes.audience.StringValue, 'family');
});

test('AWS Step Functions: execution name is derived from the alert for idempotency', async () => {
  const sfn = mockClient(SFNClient);
  sfn.on(StartExecutionCommand).resolves({ executionArn: 'arn:exec' });
  const e = createAwsEscalation({ stateMachineArn: 'arn:sm', client: new SFNClient({ region: 'us-east-1' }) });
  assert.equal(await e.start({ alertId: 'alert-1' }), 'arn:exec');
  assert.equal(sfn.commandCalls(StartExecutionCommand)[0].args[0].input.name, 'escalation-alert-1');
});

test('Amazon DynamoDB: single-table list paginates and update returns null for missing items', async () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  ddb.on(QueryCommand)
    .resolvesOnce({ Items: [{ pk: 'alerts', sk: 'a', id: 'a' }], LastEvaluatedKey: { pk: 'alerts', sk: 'a' } })
    .resolvesOnce({ Items: [{ pk: 'alerts', sk: 'b', id: 'b' }] });
  const err = Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' });
  ddb.on(UpdateCommand).rejects(err);
  const store = createDynamoStore({ tableName: 'saathi', client: new DynamoDBClient({ region: 'us-east-1' }) });
  assert.deepEqual(await store.list('alerts'), [{ id: 'a' }, { id: 'b' }]);
  assert.equal(await store.update('alerts', 'zzz', { acknowledged: true }), null);
  ddb.restore();
});

test('CloudWatch Embedded Metric Format output', () => {
  const lines = [];
  createMetrics({ log: (l) => lines.push(JSON.parse(l)) }).emit('HelpRequested', 1, { severity: 'critical' });
  assert.equal(lines[0]._aws.CloudWatchMetrics[0].Namespace, 'Saathi');
  assert.deepEqual(lines[0]._aws.CloudWatchMetrics[0].Dimensions, [['severity']]);
  assert.equal(lines[0].HelpRequested, 1);
});
