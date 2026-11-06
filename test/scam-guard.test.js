import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createSahayQueue } from '../src/agent/sahayQueue.js';
import { testServices, testConfig, fixedClock } from './helpers.js';

let server;
let base;
let services;
let cookie = '';
const notes = [];

before(async () => {
  services = testServices();
  services.localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && notes.push(e.detail));
  const accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }), services, sahayQueue: createSahayQueue(),
    accounts, sessions: createSessions('test-secret'), optionalVerifier: createHouseholdVerifier({ base: null, accounts }),
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'riya@saathi.demo', password: DEMO_PASSWORD }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => server.close());

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const sahay = { 'x-sahay': '1' };
const family = () => ({ cookie });

const incident = {
  kind: 'remote-payment', title: 'AnyDesk was open while a bank page asked for an OTP', moneyAtRisk: true,
  why: ['AnyDesk was started during the session', 'The page asked for an OTP'], explain: 'A real bank never asks you to install an app or share your screen.',
  how: ['They call pretending to be the bank', 'They ask you to install AnyDesk', 'They move your money'], actions: ['Closed AnyDesk', 'Closed the bank page'],
  screenshot: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
};

test('only Sahay on this computer can report an incident', async () => {
  assert.equal((await call('POST', '/sahay/incidents', incident)).status, 403);
  assert.equal((await call('POST', '/sahay/incidents', incident, { ...sahay, 'x-forwarded-for': '203.0.113.5' })).status, 403);
  assert.equal((await call('GET', '/sahay/holds/x')).status, 403);
});

test('a stopped scam alerts the family, holds for 30 minutes and waits for their decision', async () => {
  const out = await call('POST', '/sahay/incidents', incident, sahay);
  assert.equal(out.status, 200);
  assert.ok(out.body.id.startsWith('guard-'));
  const note = notes.find((n) => /stopped a possible scam/.test(n.subject));
  assert.ok(note, 'family was told');
  assert.equal(note.severity, 'critical');

  const hold = await call('GET', `/sahay/holds/${out.body.id}`, null, sahay);
  assert.deepEqual([hold.body.active, hold.body.approved], [true, false]);
  assert.equal((await call('GET', '/sahay/holds/nope', null, sahay)).status, 404);

  const list = await call('GET', '/api/scam-guard/incidents', null, family());
  const saved = list.body.incidents[0];
  assert.equal(saved.kind, 'remote-payment');
  assert.equal(saved.screenshot, incident.screenshot);
  assert.deepEqual(saved.actions, incident.actions);
  const summary = await call('GET', '/api/family/summary', null, family());
  assert.ok(summary.body.alerts.some((a) => a.type === 'scam-guard' && a.incidentId === out.body.id && !a.acknowledged));

  assert.equal((await call('POST', `/api/scam-guard/incidents/${out.body.id}/decide`, { decision: 'maybe' }, family())).status, 400);
  assert.equal((await call('POST', '/api/scam-guard/incidents/nope/decide', { decision: 'keep' }, family())).status, 404);
  const kept = await call('POST', `/api/scam-guard/incidents/${out.body.id}/decide`, { decision: 'keep' }, family());
  assert.equal(kept.body.hold.decision, 'keep');
  assert.ok(Date.parse(kept.body.hold.until) - fixedClock().getTime() > 20 * 3600 * 1000);
  assert.equal((await call('GET', `/sahay/holds/${out.body.id}`, null, sahay)).body.active, true);
  const after = await call('GET', '/api/family/summary', null, family());
  assert.ok(after.body.alerts.find((a) => a.incidentId === out.body.id).acknowledged);

  await call('POST', `/api/scam-guard/incidents/${out.body.id}/decide`, { decision: 'approve' }, family());
  const freed = await call('GET', `/sahay/holds/${out.body.id}`, null, sahay);
  assert.deepEqual([freed.body.active, freed.body.approved], [false, true]);
});

test('odd reports are cleaned: unknown kinds, unsafe screenshots and long lists', async () => {
  const out = await call('POST', '/sahay/incidents', { kind: 'nonsense', screenshot: 'https://evil.example/x.png', why: Array(20).fill('x'), title: '' }, sahay);
  const saved = (await call('GET', '/api/scam-guard/incidents', null, family())).body.incidents.find((i) => i.id === out.body.id);
  assert.deepEqual([saved.kind, saved.screenshot, saved.why.length, saved.title, saved.severity], ['other', null, 6, 'A possible scam', 'high']);
  assert.equal((await call('POST', '/sahay/incidents', null, sahay)).status, 200);
});

test('the Scam Guard page needs a signed-in family member', async () => {
  const res = await fetch(`${base}/scam-guard.html`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const ok = await fetch(`${base}/scam-guard.html`, { headers: { cookie } });
  assert.equal(ok.status, 200);
});
