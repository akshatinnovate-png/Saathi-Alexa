import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Subject } from 'rxjs';
import { createServices } from '../src/services.js';
import { createFileStore } from '../src/local/fileStore.js';
import { createApp } from '../src/http/app.js';
import { createAccounts } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createVault } from '../src/accounts/google.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createDoorbell } from '../src/doorbell/doorbell.js';
import { testConfig, quiet } from './helpers.js';

let now = new Date('2026-11-02T13:00:00Z');
const clock = () => now;
const setLocal = (iso) => { now = new Date(iso); };

let server;
let base;
let services;
let accounts;
const events = [];
const ringCameras = [];
const fakeRing = {
  RingRestClient: class {
    constructor({ email, password }) { this.email = email; this.password = password; this.using2fa = false; }
    async getAuth(code) {
      if (this.password !== 'right-password') throw new Error('Failed to fetch oauth token from Ring. Verify that your email and password are correct.');
      if (!code) { this.using2fa = true; this.promptFor2fa = 'Please enter the code sent to +1 555'; throw new Error('2fa'); }
      if (code !== '123456') { this.promptFor2fa = 'Invalid 2fa code entered.  Please try again.'; throw new Error('Verification Code is invalid'); }
      this.refreshToken = 'ring-refresh-1';
      return { refresh_token: this.refreshToken };
    }
  },
  RingApi: class {
    constructor({ refreshToken }) { this.refreshToken = refreshToken; this.onRefreshTokenUpdated = new Subject(); }
    async getCameras() {
      const camera = { id: 77, name: 'Front Door', onNewNotification: new Subject() };
      ringCameras.push(camera);
      return [camera];
    }
    disconnect() {}
  },
};

before(async () => {
  const config = testConfig({ demo: false, host: '127.0.0.1', web: { requireLogin: true } });
  services = createServices(config, { store: createFileStore({ persist: false }), metrics: quiet, clock, sleep: async () => {} });
  services.localBus.subscribe((e) => events.push(e));
  accounts = createAccounts({ store: services.store, services, demo: false, clock, onInvite: async ({ token }) => ({ link: `https://saathi.test/join.html?invite=${token}`, emailed: false }) });
  const doorbell = createDoorbell({ store: services.store, services, vault: createVault('k'), publicUrl: 'https://saathi.test', ring: fakeRing, log: { error() {} } });
  const app = createApp({ config, services, accounts, sessions: createSessions('s'), doorbell, optionalVerifier: createHouseholdVerifier({ base: null, accounts }) });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function agent() {
  let cookie = '';
  const call = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: res.status, json, location: res.headers.get('location') };
  };
  return { call };
}

const household = {
  elder: { name: 'Robert Miller', preferredName: 'Grandpa Bob', language: 'en', city: 'Boston', home: '12 Elm St', pronoun: 'he', timezone: 'America/New_York', country: 'US' },
  owner: { name: 'Jen', relationship: 'daughter', language: 'en', city: 'Seattle' },
  neighbour: { name: 'Pat', language: 'en', email: 'pat@family.test' },
  medications: [{ name: 'Metformin 500 mg', purpose: 'diabetes', times: ['08:00', '20:00'], description: 'white oval tablet', remaining: 10 }],
};

let jen;
test('a fresh install has no fictional family, no demo logins and no demo endpoints', async () => {
  assert.deepEqual(await services.store.list('accounts'), []);
  assert.deepEqual(await services.store.list('circle'), []);
  jen = agent();
  assert.equal((await jen.call('/auth/login', { method: 'POST', body: { email: 'riya@saathi.demo', password: 'saathi-demo-2026' } })).status, 400);
  await jen.call('/auth/signup', { method: 'POST', body: { email: 'jen@family.test', password: 'look-after-dad-1', name: 'Jen' } });
  const made = await jen.call('/api/onboarding', { method: 'POST', body: household });
  assert.equal(made.status, 200);
  assert.equal((await jen.call('/api/demo/reset', { method: 'POST' })).status, 404);
  assert.equal((await jen.call('/api/demo/sweep', { method: 'POST' })).status, 404);
  assert.equal((await jen.call('/api/ring/simulate', { method: 'POST', body: { kind: 'ding' } })).status, 404);
  const status = (await jen.call('/api/status')).json;
  assert.equal(status.demo, false);
  assert.equal(status.elder.pronoun, 'he');
  assert.equal(status.elder.timezone, 'America/New_York');
});

test('the data file is never replaced, even when it was written by an older version', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'saathi-data-'));
  const file = join(dir, 'saathi.json');
  await writeFile(file, JSON.stringify({ meta: [{ id: 'schema', version: 1 }], accounts: [{ id: 'old@family.test', email: 'old@family.test' }] }));
  const store = createFileStore({ file });
  assert.equal((await store.get('accounts', 'old@family.test')).email, 'old@family.test');
  await store.put('circle', { id: 'x' });
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.accounts.length, 1);
  await writeFile(file, '{ not json');
  await assert.rejects(createFileStore({ file }).list('accounts'), /could not read its data file.*Nothing was changed/);
  assert.equal(await readFile(file, 'utf8'), '{ not json');
});

test('his time zone, his pronouns and his country\'s emergency number', async () => {
  const id = (await jen.call('/api/status')).json.householdId;
  const saathi = services.forHousehold(id);
  setLocal('2026-11-02T13:30:00Z');
  const o = await saathi.orientation({});
  assert.equal(o.time, '08:30');
  events.length = 0;
  await saathi.requestHelp({ reason: 'fell in the kitchen' });
  const help = events.find((e) => e['detail-type'] === 'HelpRequested').detail.escalation;
  assert.match(help.familyMessage, /He said: "fell in the kitchen". Please call him now/);
  assert.match(help.neighbourMessage, /his family hasn't responded yet\. Please check on him\./);
  assert.match(help.emergencyMessage, /call emergency services on 911\. Address: 12 Elm St/);
  assert.ok(!/\b(she|her)\b/.test(JSON.stringify(help)));

  const changed = await jen.call('/api/household/profile', { method: 'PUT', body: { pronoun: 'they', country: 'GB', emergencyNumber: '', timezone: 'Europe/London' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.json.emergencyNumber, null);
  assert.equal((await jen.call('/api/household/profile', { method: 'PUT', body: { timezone: 'Mars/Olympus' } })).status, 400);
  assert.equal((await saathi.orientation({})).time, '13:30');
  await saathi.acknowledgeAlert({ alertId: (await saathi.familySummary({})).alerts[0].id, by: 'jen' });
  await jen.call('/api/household/profile', { method: 'PUT', body: { pronoun: 'he', country: 'US', timezone: 'America/New_York' } });
});

test('medicines: twice a day, the right dose recorded, supply counted per dose', async () => {
  const id = (await jen.call('/api/status')).json.householdId;
  const saathi = services.forHousehold(id);
  setLocal('2026-11-02T13:05:00Z');
  let meds = await saathi.medicationStatus();
  assert.deepEqual(meds.map((m) => [m.time, m.status]), [['08:00', 'due'], ['20:00', 'upcoming']]);
  assert.equal(meds[0].daysLeft, 5);
  const first = await saathi.confirmMedication('metformin', {});
  assert.equal(first.recorded, true);
  assert.equal((await saathi.confirmMedication('metformin', {})).recorded, true, 'the evening dose can be taken early when named');
  assert.equal((await saathi.confirmMedication('metformin', {})).alreadyTaken, true);
  meds = await saathi.medicationStatus();
  assert.deepEqual(meds.map((m) => m.status), ['taken', 'taken']);
  assert.equal(meds[0].daysLeft, 4);

  const added = await jen.call('/api/care/medications', { method: 'POST', body: { name: 'Vitamin D', purpose: 'bones', times: ['09:00'], days: [1, 4], remaining: 8 } });
  assert.equal(added.status, 200);
  assert.deepEqual(added.json.days, [1, 4]);
  assert.equal((await jen.call('/api/care/medications', { method: 'POST', body: { name: 'Bad', times: ['25:00'] } })).status, 400);
  const care = (await jen.call('/api/care')).json;
  assert.equal(care.medications.find((m) => m.name === 'Vitamin D').daysLeft, 28);
  setLocal('2026-11-03T14:05:00Z');
  assert.ok(!(await saathi.medicationStatus()).some((m) => m.name === 'Vitamin D'), 'not on Tuesdays');
  await jen.call(`/api/care/medications/${added.json.id}`, { method: 'DELETE' });
  assert.ok(!(await jen.call('/api/care')).json.medications.some((m) => m.name === 'Vitamin D'));
});

test('reminders are spoken on time, once; visits are reminded two hours ahead', async () => {
  const id = (await jen.call('/api/status')).json.householdId;
  const saathi = services.forHousehold(id);
  setLocal('2026-11-04T13:00:00Z');
  events.length = 0;
  await saathi.sweepReminders();
  await saathi.sweepReminders();
  const tablets = events.filter((e) => e['detail-type'] === 'TabletReminder');
  assert.equal(tablets.length, 1);
  assert.match(tablets[0].detail.say, /white oval tablet for diabetes/);

  const visit = await jen.call('/api/care/appointments', { method: 'POST', body: { title: 'Check-up', with: 'Dr. Patel', place: 'Mass General', at: '2026-11-04T10:00' } });
  assert.equal(visit.status, 200);
  assert.equal((await jen.call('/api/care/appointments', { method: 'POST', body: { with: 'Dr. X', at: 'tomorrow' } })).status, 400);
  setLocal('2026-11-04T13:30:00Z');
  await saathi.sweepReminders();
  const visits = events.filter((e) => e['detail-type'] === 'VisitReminder');
  assert.equal(visits.length, 1);
  assert.match(visits[0].detail.say, /10:00 you see Dr\. Patel at Mass General/);
  await jen.call(`/api/care/appointments/${visit.json.id}`, { method: 'DELETE' });
  assert.deepEqual((await jen.call('/api/care')).json.appointments, []);
});

test('the weekly letter goes out on Sunday evening in his time zone, once', async () => {
  const id = (await jen.call('/api/status')).json.householdId;
  const saathi = services.forHousehold(id);
  setLocal('2026-11-08T22:00:00Z');
  assert.equal(await saathi.sweepWeeklyLetter(), null, '17:00 in Boston is too early');
  setLocal('2026-11-08T23:10:00Z');
  const letters = await saathi.sweepWeeklyLetter();
  assert.deepEqual(letters.map((l) => l.memberId), ['jen']);
  assert.match(letters[0].english, /Here is Grandpa Bob's week/);
  assert.match(letters[0].english, /Mood: he did not check in this week/);
  assert.equal(await saathi.sweepWeeklyLetter(), null);
});

test('the owner removes someone, who then loses access; neighbours cannot change care', async () => {
  const owner = jen;
  const invite = await owner.call('/api/household/invite', { method: 'POST', body: { name: 'Sam', relationship: 'grandson', email: 'sam@family.test' } });
  const sam = agent();
  await sam.call('/auth/signup', { method: 'POST', body: { email: 'sam@family.test', password: 'grandson-123', name: 'Sam', invite: new URL(invite.json.invite.link).searchParams.get('invite') } });
  assert.equal((await sam.call('/api/status')).status, 200);
  assert.equal((await sam.call('/api/household/members/jen', { method: 'DELETE' })).status, 403);
  assert.equal((await owner.call(`/api/household/members/${invite.json.id}`, { method: 'DELETE' })).json.removed, invite.json.id);
  assert.equal((await sam.call('/api/status')).status, 401);

  const pat = agent();
  const circle = (await owner.call('/api/status')).json.circle;
  assert.ok(circle.some((p) => p.role === 'neighbour'));
  await pat.call('/auth/signup', { method: 'POST', body: { email: 'pat@family.test', password: 'next-door-42', name: 'Pat' } });
  assert.equal((await pat.call('/api/care/medications', { method: 'POST', body: { name: 'x', times: ['08:00'] } })).status, 403);
});

test('doorbells: a private link for any smart doorbell, and a real Ring account with its 2-step code', async () => {
  const id = (await jen.call('/api/status')).json.householdId;
  const made = (await jen.call('/api/doorbell/hook', { method: 'POST' })).json.hookUrl;
  assert.match(made, /^https:\/\/saathi\.test\/hooks\/doorbell\/dbh_/);
  const token = made.split('/').pop();
  const rang = await fetch(`${base}/hooks/doorbell/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"event":"ding"}' });
  assert.deepEqual(await rang.json(), { ok: true, kind: 'ding' });
  assert.equal((await fetch(`${base}/hooks/doorbell/dbh_nope`, { method: 'POST' })).status, 404);
  assert.equal((await services.forHousehold(id).doorActivity())[0].kind, 'ding');
  assert.equal((await fetch(`${base}/ring/events`, { method: 'POST' })).status, 401);

  assert.equal((await jen.call('/api/doorbell/ring', { method: 'POST', body: { email: 'jen@family.test', password: 'wrong' } })).status, 400);
  const step = await jen.call('/api/doorbell/ring', { method: 'POST', body: { email: 'jen@family.test', password: 'right-password' } });
  assert.deepEqual(step.json, { needsCode: true, prompt: 'Please enter the code sent to +1 555' });
  assert.equal((await jen.call('/api/doorbell/ring/code', { method: 'POST', body: { code: '000000' } })).status, 400);
  const done = await jen.call('/api/doorbell/ring/code', { method: 'POST', body: { code: '123456' } });
  assert.deepEqual(done.json, { connected: true, cameras: ['Front Door'] });
  const stored = await services.store.get('doorbellSettings', id);
  assert.ok(!JSON.stringify(stored).includes('ring-refresh-1'), 'the Ring token is stored encrypted');

  setLocal('2026-11-08T23:45:00Z');
  ringCameras.at(-1).onNewNotification.next({ android_config: { category: 'com.ring.pn.live-event.motion' } });
  await new Promise((r) => setTimeout(r, 50));
  const latest = (await services.forHousehold(id).doorActivity())[0];
  assert.deepEqual([latest.kind, latest.deviceId], ['motion', 'ring-77']);
  const status = (await jen.call('/api/doorbell')).json;
  assert.equal(status.ring.connected, true);
  assert.equal(status.hookUrl, made);
});
