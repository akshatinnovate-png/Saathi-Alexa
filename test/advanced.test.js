import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ResourceUpdatedNotificationSchema, LoggingMessageNotificationSchema, ResourceListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { createApp } from '../src/http/app.js';
import { createAlexaSimulator } from '../src/agent/alexaSimulator.js';
import { createStaticVerifier, createCognitoVerifier, cognitoIssuer } from '../src/auth/verifier.js';
import { createRingSimulator, sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../src/ring/webhook.js';
import { testServices, testConfig } from './helpers.js';

const ELDER = 'elder-token';
const FAMILY = 'family-token';
const RING_SECRET = 'ring-secret';
let server;
let base;
let services;
let simulator;
let ring;

before(async () => {
  services = testServices();
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', ring: { webhookSecret: RING_SECRET } }),
    services,
    simulator: { turn: (...a) => simulator.turn(...a), answer: (...a) => simulator.answer(...a), reset: () => {} },
    verifier: createStaticVerifier({ elderToken: ELDER, familyToken: FAMILY }),
    ringSimulator: { trigger: (...a) => ring.trigger(...a) },
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  simulator = createAlexaSimulator({ mcpUrl: `${base}/mcp`, headers: { Authorization: `Bearer ${ELDER}` }, llm: null, translator: services.translator });
  ring = createRingSimulator({ url: `${base}/ring/events`, secret: RING_SECRET });
});

after(async () => {
  await simulator.close();
  server.close();
});

async function connect(token) {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

const waitFor = (predicate, ms = 2000) => new Promise((resolve, reject) => {
  const start = Date.now();
  const tick = () => (predicate() ? resolve() : Date.now() - start > ms ? reject(new Error('timed out')) : setTimeout(tick, 10));
  tick();
});

test('OAuth scopes: a family device can ask how Aaji is but cannot speak as her', async () => {
  const family = await connect(FAMILY);
  const summary = await family.callTool({ name: 'family_summary', arguments: { member: 'riya' } });
  assert.ok(!summary.isError);
  assert.equal(typeof summary.structuredContent.english, 'string');
  const denied = await family.callTool({ name: 'send_message_to_family', arguments: { message: 'hi' } });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /saathi\/elder/);
  await family.close();
});

test('typed outputs: tools advertise outputSchema and return conforming structuredContent', async () => {
  const client = await connect(ELDER);
  const { tools } = await client.listTools();
  const withSchemas = tools.filter((t) => t.outputSchema).map((t) => t.name).sort();
  assert.deepEqual(withSchemas, ['ask_family_for_help', 'confirm_medication_taken', 'family_summary', 'get_medication_schedule', 'what_day_is_it']);
  const meds = await client.callTool({ name: 'get_medication_schedule', arguments: {} });
  assert.ok(meds.structuredContent.medications.every((m) => ['taken', 'due', 'missed', 'upcoming'].includes(m.status)));
  await client.close();
});

test('resource subscriptions and logging: Alexa+ is told when today changes and when an escalation moves', async () => {
  const client = await connect(ELDER);
  const updated = [];
  const logs = [];
  let listChanged = 0;
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, ({ params }) => updated.push(params.uri));
  client.setNotificationHandler(LoggingMessageNotificationSchema, ({ params }) => logs.push(params));
  client.setNotificationHandler(ResourceListChangedNotificationSchema, () => { listChanged++; });
  await client.subscribeResource({ uri: 'saathi://today' });
  await client.setLoggingLevel('notice');

  await client.callTool({ name: 'confirm_medication_taken', arguments: { medication: 'calcium' } });
  await waitFor(() => updated.includes('saathi://today'));

  const help = await client.callTool({ name: 'ask_family_for_help', arguments: { reason: 'dizzy' } });
  await waitFor(() => logs.some((l) => l.logger === 'escalation' && l.data.event === 'HelpRequested'));
  await services.escalation.wait(help.structuredContent.alertId);

  await client.callTool({ name: 'save_memory_story', arguments: { story: 'We danced in the rain', title: 'Rain' } });
  await waitFor(() => listChanged > 0);
  await client.close();
});

test('progress notifications while a story is translated and narrated', async () => {
  const client = await connect(ELDER);
  const progress = [];
  await client.callTool({ name: 'save_memory_story', arguments: { story: 'आजोबांनी मला सायकल शिकवली', title: 'The bicycle', language: 'mr' } }, undefined, {
    onprogress: (p) => progress.push(p),
  });
  assert.ok(progress.length >= 3);
  assert.equal(progress.at(-1).progress, progress.at(-1).total);
  assert.match(progress[0].message, /Translating into/);
  await client.close();
});

test('resource templates and completions: every story is addressable and discoverable', async () => {
  const client = await connect(ELDER);
  const { resources } = await client.listResources();
  const story = resources.find((r) => r.uri.startsWith('saathi://stories/'));
  assert.ok(story, 'stories are listed through the template');
  const read = JSON.parse((await client.readResource({ uri: story.uri })).contents[0].text);
  assert.ok(read.translations);
  const { resourceTemplates } = await client.listResourceTemplates();
  assert.equal(resourceTemplates[0].uriTemplate, 'saathi://stories/{storyId}');

  const themes = await client.complete({ ref: { type: 'ref/prompt', name: 'memory_lane' }, argument: { name: 'theme', value: 'w' } });
  assert.deepEqual(themes.completion.values, ['wedding']);
  const ids = await client.complete({ ref: { type: 'ref/resource', uri: 'saathi://stories/{storyId}' }, argument: { name: 'storyId', value: 'story-' } });
  assert.ok(ids.completion.values.length >= 1);
  await client.close();
});

test('elicitation: nothing leaves the house until she says yes', async () => {
  const before = (await services.store.list('messages')).length;
  const paused = await simulator.turn({ text: 'Tell Riya that I am proud of her', language: 'en' });
  assert.ok(paused.elicitation, 'the turn pauses for confirmation');
  assert.match(paused.elicitation.message, /Shall I send this to Riya/);
  assert.equal((await services.store.list('messages')).length, before, 'not sent yet');

  const done = await simulator.answer({ id: paused.elicitation.id, accept: true });
  assert.match(done.reply, /sent it to Riya/);
  assert.equal((await services.store.list('messages')).length, before + 1);

  const again = await simulator.turn({ text: 'Tell Anand that the tap is leaking', language: 'en' });
  const declined = await simulator.answer({ id: again.elicitation.id, accept: false });
  assert.match(declined.reply, /haven't sent it/);
  assert.equal((await services.store.list('messages')).length, before + 1);
});

test('retry safety: asking twice (or a retried tool call) starts exactly one escalation', async () => {
  const s = testServices({ sleep: () => new Promise(() => {}) });
  const first = await s.saathi.requestHelp({ reason: 'I fell' });
  const second = await s.saathi.requestHelp({ reason: 'I fell, please come' });
  const viaCheckIn = await s.saathi.checkIn({ text: 'मी पडले', language: 'mr' });
  assert.equal(second.alertId, first.alertId);
  assert.equal(second.deduplicated, true);
  assert.equal(viaCheckIn.alertId, first.alertId);
  assert.equal((await s.store.list('alerts')).filter((a) => a.type === 'help').length, 1);
});

test('dignity: "keep it between us" is honoured for sadness but never for danger', async () => {
  const s = testServices();
  const notes = [];
  s.localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && notes.push(e));
  const sad = await s.saathi.checkIn({ text: 'I feel lonely, please do not tell Riya', language: 'en', keepPrivate: true });
  assert.equal(sad.concerns.level, 'gentle');
  assert.equal(notes.length, 0);
  const summary = await s.saathi.familySummary({ forMemberId: 'riya' });
  assert.equal(summary.checkins[0].text, 'A private check-in');

  const fall = await s.saathi.checkIn({ text: 'I fell, but keep it private', language: 'en', keepPrivate: true });
  assert.ok(fall.alertId, 'a fall escalates even when she asked for privacy');
  await s.escalation.wait(fall.alertId);
});

test('Ring webhook: signed events are accepted; forged and replayed ones are not', async () => {
  const ok = await ring.trigger('motion');
  assert.equal(ok.event.kind, 'motion');

  const body = JSON.stringify({ kind: 'ding' });
  const now = String(Math.floor(Date.now() / 1000));
  const forged = await fetch(`${base}/ring/events`, { method: 'POST', headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign('wrong', now, body), [TIMESTAMP_HEADER]: now }, body });
  assert.equal(forged.status, 401);
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  const replayed = await fetch(`${base}/ring/events`, { method: 'POST', headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign(RING_SECRET, old, body), [TIMESTAMP_HEADER]: old }, body });
  assert.equal(replayed.status, 401);
});

test('Ring doorbell closes the loop: a ring after the neighbour is sent for resolves the alert', async () => {
  const s = testServices({ sleep: () => new Promise(() => {}) });
  const { alertId } = await s.saathi.requestHelp({ reason: 'I fell' });

  const early = await s.saathi.doorEvent({ kind: 'ding' });
  assert.equal(early.resolved, false);
  assert.equal((await s.store.get('alerts', alertId)).acknowledged, false);

  await s.store.update('alerts', alertId, { escalationStage: 'neighbour-notified' });
  const arrived = await s.saathi.doorEvent({ kind: 'ding' });
  assert.equal(arrived.resolved, true);
  const alert = await s.store.get('alerts', alertId);
  assert.equal(alert.acknowledgedBy, 'front-door');
  const inbox = await s.saathi.familyMessages();
  assert.match(inbox.messages.at(-1).original, /दारात कोणीतरी/);
});

test('quiet day: no door activity, check-in or tablets by late morning nudges the family once', async () => {
  const s = testServices();
  assert.equal(await s.saathi.sweepQuietDay(), 'quiet-2026-10-23');
  assert.equal(await s.saathi.sweepQuietDay(), null);

  const busy = testServices();
  await busy.saathi.doorEvent({ kind: 'motion', at: '2026-10-23T03:00:00Z' });
  assert.equal(await busy.saathi.sweepQuietDay(), null);
});

test('Amazon Cognito access tokens: issuer, token_use, client and scopes are enforced', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const cfg = { region: 'us-east-1', userPoolId: 'us-east-1_TEST', clientIds: ['alexa-client'] };
  const v = createCognitoVerifier({ ...cfg, jwks: createLocalJWKSet({ keys: [jwk] }) });
  const mint = (claims) => new SignJWT({ token_use: 'access', client_id: 'alexa-client', scope: 'saathi/elder openid', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(cognitoIssuer(cfg)).setIssuedAt().setExpirationTime('1h').sign(privateKey);

  const info = await v.verifyAccessToken(await mint({}));
  assert.deepEqual(info.scopes, ['saathi/elder']);
  assert.equal(info.clientId, 'alexa-client');
  await assert.rejects(v.verifyAccessToken(await mint({ token_use: 'id' })), /Not an access token/);
  await assert.rejects(v.verifyAccessToken(await mint({ client_id: 'someone-else' })), /Unknown client/);
  const other = await new SignJWT({ token_use: 'access', client_id: 'alexa-client' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://evil.example').setExpirationTime('1h').sign(privateKey);
  await assert.rejects(v.verifyAccessToken(other), /Invalid token/);
});
