import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createScamShield, modelFrom } from '../src/features/scamShield.js';
import { testServices, testConfig } from './helpers.js';

const modelDir = mkdtempSync(join(tmpdir(), 'saathi-gemma-'));
const modelPath = join(modelDir, 'gemma.task');
const modelBytes = Buffer.from('not really a model, but bytes all the same');
writeFileSync(modelPath, modelBytes);
const modelSha = createHash('sha256').update(modelBytes).digest('hex');

test('the on-device model is offered only with a valid checksum, from a file here or an https address', () => {
  assert.equal(modelFrom({}), null);
  assert.equal(modelFrom({ SAATHI_GEMMA_MODEL_URL: 'https://x.example/g.task' }), null, 'no checksum, no model');
  assert.equal(modelFrom({ SAATHI_GEMMA_MODEL_URL: 'http://x.example/g.task', SAATHI_GEMMA_MODEL_SHA256: modelSha }), null, 'plain http is refused');
  assert.equal(modelFrom({ SAATHI_GEMMA_MODEL_FILE: join(modelDir, 'missing'), SAATHI_GEMMA_MODEL_SHA256: modelSha }), null);
  assert.deepEqual(modelFrom({ SAATHI_GEMMA_MODEL_URL: 'https://x.example/g.task', SAATHI_GEMMA_MODEL_SHA256: modelSha.toUpperCase(), SAATHI_GEMMA_MODEL_BYTES: '555' }), { name: 'Gemma 3 1B', sha256: modelSha, bytes: 555, file: null, url: 'https://x.example/g.task' });
  assert.equal(modelFrom({ SAATHI_GEMMA_MODEL_FILE: modelPath, SAATHI_GEMMA_MODEL_SHA256: modelSha, SAATHI_GEMMA_MODEL_NAME: 'Gemma 3 270M' }).bytes, modelBytes.length);
});

test('a scam message on her phone tells the family the kind, never the words, and repeats are folded together', async () => {
  const services = testServices();
  const saathi = services.forHousehold('default');
  const shield = createScamShield({ services });
  await assert.rejects(shield.report('default', { kind: 'kyc' }), (e) => e.status === 409);
  await saathi.updateProfile({ scamShield: { enabled: true } });
  const first = await shield.report('default', { kind: 'kyc', engine: 'gemma', channel: 'whatsapp', confidence: 0.93, text: 'Your SBI account is blocked, my number 98...' });
  assert.equal(first.deduplicated, false);
  const alert = (await saathi.familySummary({})).alerts.find((a) => a.id === first.alertId);
  assert.equal(alert.type, 'scam-shield');
  assert.match(alert.summary, /WhatsApp message on Aaji's phone looked like a fake bank or KYC message/);
  assert.ok(!JSON.stringify(await services.store.list('alerts')).includes('SBI'), 'the message text is never stored');
  assert.ok(!JSON.stringify(await services.store.list('scamShield')).includes('SBI'));
  const second = await shield.report('default', { kind: 'made-up', engine: 'something', channel: 'telegram', confidence: 9 });
  assert.equal(second.deduplicated, true);
  assert.equal(second.alertId, first.alertId);
  const view = await shield.view('default');
  assert.equal(view.enabled, true);
  assert.equal(view.model, null);
  assert.deepEqual(view.recent.map((r) => [r.kind, r.engine, r.channel, r.confidence]).sort(), [['kyc', 'gemma', 'whatsapp', 0.93], ['other', 'rules', 'other', 1]].sort());
});

let server;
let base;
const cookies = {};

before(async () => {
  const services = testServices();
  const accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }), services,
    accounts, sessions: createSessions('test-secret'), optionalVerifier: createHouseholdVerifier({ base: null, accounts }),
    scamShield: createScamShield({ services, model: modelFrom({ SAATHI_GEMMA_MODEL_FILE: modelPath, SAATHI_GEMMA_MODEL_SHA256: modelSha }) }),
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const who of ['riya', 'anand']) {
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${who}@saathi.demo`, password: DEMO_PASSWORD }) });
    cookies[who] = res.headers.get('set-cookie').split(';')[0];
  }
});

after(() => server?.close());

const call = async (who, method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { ...(who ? { cookie: cookies[who] } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, headers: res.headers, body: res.headers.get('content-type')?.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};

test('over HTTP: the owner switches it on, the phone reads its settings and the model, and strangers get nothing', async () => {
  assert.equal((await call(null, 'GET', '/api/scam-shield')).status, 401);
  assert.equal((await call(null, 'GET', '/api/scam-shield/model')).status, 401);
  assert.equal((await call('anand', 'PUT', '/api/scam-shield', { enabled: true })).status, 403, 'only the owner changes it');
  const on = await call('riya', 'PUT', '/api/scam-shield', { enabled: true });
  assert.equal(on.body.enabled, true);
  assert.deepEqual(on.body.model, { name: 'Gemma 3 1B', sha256: modelSha, bytes: modelBytes.length, url: '/api/scam-shield/model' });
  const model = await call('riya', 'GET', '/api/scam-shield/model');
  assert.equal(model.status, 200);
  assert.equal(model.headers.get('x-content-sha256'), modelSha);
  assert.equal(createHash('sha256').update(model.body).digest('hex'), modelSha);
  const reported = await call('riya', 'POST', '/api/scam-shield/report', { kind: 'digital-arrest', engine: 'gemma', channel: 'sms', confidence: 0.97 });
  assert.equal(reported.status, 200);
  assert.ok(reported.body.alertId);
  assert.equal((await call('riya', 'GET', '/api/scam-shield')).body.recent[0].kind, 'digital-arrest');
});
