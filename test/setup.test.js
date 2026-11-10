import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createHaq } from '../src/features/haq.js';
import { createRaksha } from '../src/features/raksha.js';
import { createSetup } from '../src/features/setup.js';
import { testServices, testConfig, fixedClock } from './helpers.js';

test('the attention list names what needs someone, most urgent first, each with one action', async () => {
  const services = testServices();
  const saathi = services.forHousehold('default');
  const haq = createHaq({ llm: null, services, clock: () => new Date('2026-11-12T05:30:00Z') });
  const setup = createSetup({ services, haq, clock: fixedClock });
  await saathi.updateProfile({ haq: { birthYear: 1948, pensioner: true } });
  const riya = (await saathi.circle()).find((p) => p.name === 'Riya');

  const { items, count } = await setup.attention('default', { memberId: riya.id, role: 'family' });
  assert.equal(count, items.length);
  assert.ok(items.length >= 2);
  const order = { urgent: 0, soon: 1, info: 2 };
  assert.deepEqual(items.map((i) => order[i.severity]), [...items.map((i) => order[i.severity])].sort((a, b) => a - b));
  for (const item of items) assert.ok(item.title && item.action.label && (item.action.href || item.action.post), item.id);
  const life = items.find((i) => i.id === 'haq-life-certificate');
  assert.equal(life.action.href, '#care/haq');
  const escort = items.find((i) => i.id.startsWith('escort-'));
  assert.equal(escort.action.post, '/family/escort');
  assert.ok(escort.action.body.appointmentId);

  await saathi.requestHelp({ reason: 'I fell' });
  const withHelp = await setup.attention('default', { memberId: riya.id, role: 'family' });
  assert.equal(withHelp.items[0].severity, 'urgent');
  assert.match(withHelp.items[0].action.post, /^\/family\/alerts\/.+\/ack$/);

  const neighbour = await setup.attention('default', { memberId: null, role: 'neighbour' });
  assert.ok(neighbour.items.every((i) => i.id.startsWith('help-')), 'a neighbour sees only calls for help');
});

test('setup progress counts what is done, and hides everything from a neighbour', async () => {
  const services = testServices();
  const setup = createSetup({
    services,
    accounts: { listDevices: async () => [] },
    security: { summary: async () => ({ totp: false, passkeys: [] }) },
  });
  const first = await setup.status('default', { email: 'riya@saathi.demo', role: 'owner' });
  assert.equal(first.total, 7);
  const byId = Object.fromEntries(first.steps.map((s) => [s.id, s]));
  assert.equal(byId.profile.done, true);
  assert.equal(byId.medicines.done, true);
  assert.equal(byId.device.done, false);
  assert.equal(byId.protection.done, false);
  assert.equal(byId['sign-in'].done, false);
  assert.equal(first.done, first.steps.filter((s) => s.done).length);
  for (const s of first.steps) assert.ok(s.action.label && (s.action.href || s.action.open));

  const withoutAccount = await setup.status('default', { role: 'family' });
  assert.equal(withoutAccount.total, 6);
  assert.deepEqual(await setup.status('default', { role: 'neighbour' }), { steps: [], done: 0, total: 0 });

  const secured = createSetup({ services, accounts: { listDevices: async () => [{ id: 'd1' }] }, security: { summary: async () => ({ totp: false, passkeys: [{ id: 'p' }] }) } });
  const later = await secured.status('default', { email: 'riya@saathi.demo', role: 'owner' });
  assert.equal(later.steps.find((s) => s.id === 'device').done, true);
  assert.equal(later.steps.find((s) => s.id === 'sign-in').done, true);
});

test('recommended protection turns on only what is off, never widens sharing, and undoes exactly', async () => {
  const services = testServices();
  const saathi = services.forHousehold('default');
  const setup = createSetup({ services });
  await saathi.updateProfile({ raksha: { enabled: false, stillness: true, stillHours: 5, from: '07:00', to: '19:00' } });

  const preview = await setup.recommended('default');
  assert.deepEqual(preview.changes.map((c) => [c.id, c.on]), [['raksha', false], ['scam-warnings', false]]);

  const applied = await setup.applyRecommended('default');
  assert.deepEqual(applied.applied, ['raksha', 'scam-warnings']);
  assert.ok(applied.changes.every((c) => c.on));
  const elder = await saathi.elder();
  assert.deepEqual(elder.raksha, { enabled: true, stillness: true, stillHours: 5, from: '07:00', to: '19:00' }, 'her own stillness settings are kept');
  assert.deepEqual(elder.scamNetwork, { receive: true, share: false }, 'sharing stays off');

  const again = await setup.applyRecommended('default');
  assert.deepEqual(again.applied, []);
  assert.equal(again.undo, null);

  const undone = await setup.undoRecommended('default', applied.undo);
  assert.deepEqual(undone.restored, ['raksha', 'scam-warnings']);
  const after = await saathi.elder();
  assert.equal(after.raksha.enabled, false);
  assert.equal(after.raksha.stillHours, 5);
  assert.deepEqual(after.scamNetwork, { receive: false, share: false });
  await assert.rejects(setup.undoRecommended('default', null), /Nothing to undo/);

  const one = await setup.applyRecommended('default', ['scam-warnings']);
  assert.deepEqual(one.applied, ['scam-warnings']);
  assert.equal((await saathi.elder()).raksha.enabled, false);
});

let server;
let base;
const cookies = {};

before(async () => {
  const services = testServices();
  const accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const haq = createHaq({ llm: null, services });
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }), services,
    accounts, sessions: createSessions('test-secret'), optionalVerifier: createHouseholdVerifier({ base: null, accounts }),
    haq, raksha: createRaksha({ services, setTimer: () => null }), setup: createSetup({ services, accounts, haq }),
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
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('over HTTP: anyone in the family sees the lists, only the owner turns protection on, and strangers see nothing', async () => {
  assert.equal((await call(null, 'GET', '/api/attention')).status, 401);
  assert.equal((await call(null, 'POST', '/api/setup/recommended', {})).status, 401);

  const attention = await call('anand', 'GET', '/api/attention');
  assert.equal(attention.status, 200);
  assert.ok(Array.isArray(attention.body.items));
  assert.equal((await call('anand', 'GET', '/api/setup')).body.total, 6);
  assert.equal((await call('anand', 'POST', '/api/setup/recommended', {})).status, 403, 'a family member who is not the owner cannot change protection');

  assert.equal((await call('riya', 'GET', '/api/setup/recommended')).body.changes.length, 2);
  const applied = await call('riya', 'POST', '/api/setup/recommended', {});
  assert.deepEqual(applied.body.applied, ['raksha', 'scam-warnings']);
  assert.equal((await call('riya', 'GET', '/api/raksha')).body.settings.enabled, true);
  assert.equal((await call('riya', 'GET', '/api/setup')).body.steps.find((s) => s.id === 'protection').done, true);
  const undone = await call('riya', 'POST', '/api/setup/recommended/undo', { undo: applied.body.undo });
  assert.deepEqual(undone.body.restored, ['raksha', 'scam-warnings']);
  assert.equal((await call('riya', 'GET', '/api/raksha')).body.settings.enabled, false);
  assert.equal((await call('riya', 'POST', '/api/setup/recommended/undo', {})).status, 400);
});
