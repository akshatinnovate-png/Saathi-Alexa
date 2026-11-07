import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createBilling, PLANS, SAFETY } from '../src/billing/billing.js';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createFileStore } from '../src/local/fileStore.js';
import { testServices, testConfig } from './helpers.js';

const SECRET = 'whsec_test';
const sign = (body) => createHmac('sha256', SECRET).update(body).digest('hex');
const event = (name, plan = 'family', currentEnd = 1_800_000_000) => ({ event: name, payload: { subscription: { entity: { id: 'sub_1', current_end: currentEnd, notes: { householdId: 'h1', plan } } } } });

function setup() {
  let now = Date.parse('2026-11-01T00:00:00Z');
  const calls = [];
  const notices = [];
  const billing = createBilling({
    provider: 'razorpay', keyId: 'rzp_test_1', keySecret: 'k', webhookSecret: SECRET, planIds: { family: 'plan_F' },
    store: createFileStore({ persist: false }), clock: () => new Date(now),
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return { ok: true, json: async () => ({ id: 'sub_1', short_url: 'https://rzp.io/i/abc' }) }; },
    onNotice: async (h, text) => notices.push({ h, text }),
  });
  return { billing, calls, notices, advance: (ms) => { now += ms; } };
}

test('with no payment service set up, everything is included and nothing can be bought', async () => {
  const off = createBilling({ store: createFileStore({ persist: false }) });
  assert.equal(off.enabled, false);
  assert.equal(await off.entitled('h1', 'insight'), true);
  assert.equal((await off.status('h1')).paidExtras, 'all');
  await assert.rejects(off.checkout('h1', { plan: 'family' }), /already included/);
  assert.deepEqual(await off.cancel('h1'), { plan: 'free', status: 'cancelled' });
  assert.equal(off.verify('{}', 'x'), false);
  assert.ok(Object.values(PLANS).every((p) => !p.features.some((f) => SAFETY.has(f))), 'no plan sells a safety feature');
});

test('a family subscribes, a failed payment pauses only extras after a grace week, and cancelling is one step', async () => {
  const { billing, calls, notices, advance } = setup();
  assert.equal(await billing.entitled('h1', 'insight'), false);
  assert.equal(await billing.entitled('h1', 'help-escalation'), true);
  await assert.rejects(billing.checkout('h1', { plan: 'agency' }), /not available/);
  const checkout = await billing.checkout('h1', { plan: 'family', email: 'riya@x.org' });
  assert.equal(checkout.url, 'https://rzp.io/i/abc');
  assert.equal(calls[0].body.plan_id, 'plan_F');
  assert.equal(calls[0].body.notes.householdId, 'h1');
  assert.match(calls[0].auth, /^Basic /);

  const body = JSON.stringify(event('subscription.activated'));
  assert.equal(billing.verify(body, sign(body)), true);
  assert.equal(billing.verify(body, 'nope'), false);
  assert.equal(billing.verify(body, undefined), false);
  assert.deepEqual(await billing.webhook(JSON.parse(body)), { householdId: 'h1', status: 'active', plan: 'family' });
  assert.equal(await billing.entitled('h1', 'insight'), true);
  const s = await billing.status('h1');
  assert.equal(s.planName, 'Family');
  assert.ok(s.renewsAt);
  assert.ok(s.plans.find((p) => p.id === 'family').available);

  await billing.webhook(event('subscription.halted'));
  await billing.webhook(event('subscription.halted'));
  assert.equal(notices.length, 1, 'one quiet notice, not a stream');
  assert.match(notices[0].text, /keeps your family safe keeps working/);
  assert.equal(await billing.entitled('h1', 'insight'), true, 'extras keep working during the grace week');
  advance(8 * 24 * 3600 * 1000);
  assert.equal(await billing.entitled('h1', 'insight'), false);
  assert.equal(await billing.entitled('h1', 'scam-guard'), true);
  await billing.webhook(event('subscription.charged'));
  assert.equal(await billing.entitled('h1', 'insight'), true);

  assert.deepEqual(await billing.cancel('h1'), { plan: 'free', status: 'cancelled' });
  assert.match(calls.at(-1).url, /subscriptions\/sub_1\/cancel$/);
  assert.equal(await billing.entitled('h1', 'insight'), false);
  assert.deepEqual(await billing.webhook({ event: 'payment.captured' }), { ignored: true });
  assert.equal((await billing.webhook(event('subscription.cancelled'))).plan, 'free');
});

test('the payment service failing is reported plainly', async () => {
  const billing = createBilling({ provider: 'razorpay', keyId: 'a', keySecret: 'b', webhookSecret: 'c', planIds: { family: 'p' }, store: createFileStore({ persist: false }), fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: { description: 'Bad plan' } }) }) });
  await assert.rejects(billing.checkout('h1', { plan: 'family' }), /Bad plan/);
});

test('over HTTP: paid extras answer 402 until the signed webhook arrives', async () => {
  const services = testServices();
  const accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const billing = createBilling({ provider: 'razorpay', keyId: 'a', keySecret: 'b', webhookSecret: SECRET, planIds: { family: 'p' }, store: services.store, fetchImpl: async () => { throw new Error('offline'); } });
  const app = createApp({ config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }), services, accounts, billing, sessions: createSessions('s'), optionalVerifier: createHouseholdVerifier({ base: null, accounts }) });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'riya@saathi.demo', password: DEMO_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const insight = await fetch(`${base}/api/insight`, { headers: { cookie } });
    assert.equal(insight.status, 402);
    assert.equal((await insight.json()).code, 'plan');
    assert.equal((await (await fetch(`${base}/api/plan`, { headers: { cookie } })).json()).enabled, true);
    const raw = JSON.stringify({ event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_9', notes: { householdId: 'default', plan: 'family' } } } } });
    assert.equal((await fetch(`${base}/billing/razorpay/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'bad' }, body: raw })).status, 400);
    assert.equal((await fetch(`${base}/billing/razorpay/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(raw) }, body: raw })).status, 200);
    assert.equal((await fetch(`${base}/api/insight`, { headers: { cookie } })).status, 200);
    const cancel = await fetch(`${base}/api/plan/cancel`, { method: 'POST', headers: { cookie } });
    assert.equal(cancel.status, 502);
    assert.match((await cancel.json()).error, /could not be reached/);
    assert.equal((await fetch(`${base}/api/plan/checkout`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'clinic' }) })).status, 400);
  } finally {
    server.close();
  }
  const plain = createApp({ config: testConfig({ host: '127.0.0.1', web: { requireLogin: false } }), services: testServices() });
  const s2 = await new Promise((resolve) => { const s = plain.listen(0, '127.0.0.1', () => resolve(s)); });
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    assert.equal((await fetch(`${b2}/billing/razorpay/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
    assert.notEqual((await (await fetch(`${b2}/api/plan`)).json()).enabled, true);
  } finally {
    s2.close();
  }
});
