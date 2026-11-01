import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createAccountSecurity } from '../src/accounts/security.js';
import { createAuditLog } from '../src/security/audit.js';
import { createSealer } from '../src/security/keys.js';
import { createVault } from '../src/vault/vault.js';
import {
  createFamilyKey, unlockKeys, beginJoin, joinerStep, approverBegin, approverPictures, approverDecide,
  rotateFamilyKey, recoverWithCode, replaceRecoveryKit, seal, open,
} from '../public/vault-flows.js';
import { newDevice, encodePublic, commitment, random, b64u, utf8, text, keyId } from '../public/vault-crypto.js';
import { testServices, testConfig } from './helpers.js';

let server;
let base;
let services;
const H = 'default';

before(async () => {
  services = testServices();
  const accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const audit = createAuditLog({ store: services.store, key: randomBytes(32) });
  const sessions = createSessions('vault-test-secret-that-is-long-enough-1', { store: services.store });
  const security = createAccountSecurity({ accounts, store: services.store, sealer: createSealer(randomBytes(32)), rp: { name: 'Saathi', id: '127.0.0.1', origins: [] } });
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true, rateLimit: false } }),
    services, accounts, sessions, security, audit, vault: createVault({ store: services.store, audit }),
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

let ip = 0;
function agent() {
  let cookie = '';
  const addr = `10.7.0.${++ip}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { 'x-forwarded-for': addr, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair] = set.split(';');
      const [name] = pair.split('=');
      cookie = [...cookie.split('; ').filter((c) => c && !c.startsWith(`${name}=`)), pair].join('; ');
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(json?.error ?? `HTTP ${res.status}`), { status: res.status });
    return json;
  };
  return call;
}

async function signIn(email) {
  const call = agent();
  await call('POST', '/auth/login', { email, password: DEMO_PASSWORD });
  return call;
}

async function pairTablet(owner) {
  const { code } = await owner('POST', '/api/devices/pairing-code', {});
  const tablet = agent();
  await tablet('POST', '/auth/device', { code });
  const pending = (await owner('GET', '/api/devices/requests')).find((r) => r.status === 'pending');
  await owner('POST', `/api/devices/requests/${pending.id}`, { approve: true });
  await tablet('GET', '/auth/device/status');
  return tablet;
}

async function runJoin(joinerCall, approverCall, approverKeys, label) {
  const join = await beginJoin(joinerCall, { label });
  const request = (await approverCall('GET', '/api/vault')).joins.find((j) => j.id === join.id);
  const check = await approverBegin(approverCall, request);
  const seen = await joinerStep(joinerCall, join);
  const pictures = await approverPictures(approverCall, check);
  assert.deepEqual(pictures, seen.pictures, 'both screens show the same pictures');
  await approverDecide(approverCall, H, approverKeys, check, true);
  assert.equal((await joinerStep(joinerCall, join)).status, 'approved');
  return { device: join.device, ...(await unlockKeys(joinerCall, H, join.device)) };
}

const family = {};

test('the owner creates the family key and gets a recovery kit; the server only ever sees public keys and wrapped keys', async () => {
  family.riya = await signIn('riya@saathi.demo');
  const made = await createFamilyKey(family.riya, H, { label: "Riya's phone" });
  assert.match(made.recoveryCode, /^[A-Z2-9-]+$/);
  family.riyaKeys = made.keys;
  family.riyaDevice = made.device;
  family.recoveryCode = made.recoveryCode;
  const state = await family.riya('GET', '/api/vault');
  assert.equal(state.ready, true);
  assert.equal(state.epoch, 1);
  assert.equal(state.hasRecovery, true);
  assert.deepEqual(state.devices.map((d) => d.kind).sort(), ['browser', 'recovery']);
  const raw = JSON.stringify(await services.store.list('vaultGrants')) + JSON.stringify(await services.store.list('vaultDevices'));
  assert.ok(!raw.includes(b64u(made.keys.get(1))), 'the family key never reaches the server');
  await assert.rejects(createFamilyKey(family.riya, H, {}), /already has a private key/);
});

test('a family member\'s new browser joins only after both screens show the same pictures', async () => {
  family.anand = await signIn('anand@saathi.demo');
  const joined = await runJoin(family.anand, family.riya, family.riyaKeys, "Anand's laptop");
  family.anandKeys = joined.keys;
  assert.ok(family.anandKeys.get(1));
});

test('Aaji\'s tablet joins the same way, and private content moves between devices without the server reading it', async () => {
  family.tablet = await pairTablet(family.riya);
  const joined = await runJoin(family.tablet, family.anand, family.anandKeys, "Aaji's Saathi screen");
  family.tabletKeys = joined.keys;
  family.tabletDevice = joined.device;
  const secret = 'Aaji, Kabir passed his exam! We will call at 6.';
  const blob = await seal(H, family.anandKeys, 'message', 'm-1', utf8(secret));
  await services.store.put('e2eProbe', { id: 'p', blob: Buffer.from(blob).toString('base64') });
  assert.equal(text(await open(H, family.tabletKeys, 'message', 'm-1', blob)), secret);
  assert.equal(text(await open(H, family.riyaKeys, 'message', 'm-1', blob)), secret);
  const everything = JSON.stringify(await Promise.all(['vaultGrants', 'vaultDevices', 'vaultJoins', 'vaultMeta', 'e2eProbe', 'audit'].map((c) => services.store.list(c))));
  assert.ok(!everything.includes('Kabir passed'), 'the message is not readable anywhere on the server');
});

test('neighbours and signed-out callers cannot touch the family key', async () => {
  const meera = await signIn('meera@saathi.demo');
  await assert.rejects(meera('GET', '/api/vault'), (e) => e.status === 403);
  await assert.rejects(meera('POST', '/api/vault/join', { commit: 'x'.repeat(43) }), (e) => e.status === 403);
  await assert.rejects(agent()('GET', '/api/vault'), (e) => e.status === 401);
  const id = (await family.riya('GET', '/api/vault')).devices.find((d) => d.kind === 'browser' && d.owner === 'riya@saathi.demo').id;
  await assert.rejects(family.anand('GET', `/api/vault/keys/${id}`), (e) => e.status === 403);
  await assert.rejects(family.tablet('GET', `/api/vault/keys/${id}`), (e) => e.status === 403);
});

test('a device that swaps its key after promising one is refused', async () => {
  const sneaky = await signIn('anand@saathi.demo');
  const join = await beginJoin(sneaky, { label: 'sneaky' });
  const request = (await family.riya('GET', '/api/vault')).joins.find((j) => j.id === join.id);
  await approverBegin(family.riya, request);
  const other = newDevice();
  await assert.rejects(sneaky('POST', `/api/vault/join/${join.id}/reveal`, { pub: encodePublic(other.public), nonce: b64u(join.nonce) }), /does not match/);
});

test('a malicious server that substitutes its own key cannot make the pictures match', async () => {
  const honest = await beginJoin(await signIn('anand@saathi.demo'), { label: 'real tablet' });
  const attacker = newDevice();
  const attackerNonce = random(16);
  const forged = { id: honest.id, commit: await commitment(attacker.public, attackerNonce) };
  const approverNonce = random(16);
  const { sasPictures } = await import('../public/vault-crypto.js');
  const shownOnRealTablet = await sasPictures(honest.commit, honest.device.public, honest.nonce, approverNonce);
  const shownToFamily = await sasPictures(forged.commit, attacker.public, attackerNonce, approverNonce);
  assert.notDeepEqual(shownToFamily, shownOnRealTablet);
});

test('a device the server slipped in without a family approval never receives a new key', async () => {
  const fake = newDevice();
  const id = await keyId(fake.public);
  await services.store.put('vaultDevices', { id, householdId: H, kind: 'browser', owner: 'riya@saathi.demo', deviceId: null, label: 'Riya\'s other phone', pub: encodePublic(fake.public), cert: { epoch: 1, mac: 'AAAA' }, status: 'active', addedAt: new Date().toISOString() });
  await assert.rejects(rotateFamilyKey(family.riya, H, family.riyaKeys), /never approved by your family/);
  await services.store.update('vaultDevices', id, { status: 'removed' });
});

test('removing someone rotates the key: they keep what they already had, but cannot read anything new', async () => {
  const state = await family.riya('GET', '/api/vault');
  const anandDevice = state.devices.find((d) => d.owner === 'anand@saathi.demo');
  const epoch = await rotateFamilyKey(family.riya, H, family.riyaKeys, { remove: [anandDevice.id] });
  assert.equal(epoch, 2);
  const fresh = await seal(H, family.riyaKeys, 'voice', 'v-9', utf8('new secret after removal'));
  await assert.rejects(open(H, family.anandKeys, 'voice', 'v-9', fresh), /does not have the key/);
  await assert.rejects(unlockKeys(family.anand, H, { public: anandDevice.pub }), () => true);
  const tablet = await unlockKeys(family.tablet, H, family.tabletDevice);
  assert.equal(text(await open(H, tablet.keys, 'voice', 'v-9', fresh)), 'new secret after removal');
});

test('the recovery kit brings every version of the family key back on a brand new device', async () => {
  const newPhone = await signIn('riya@saathi.demo');
  const restored = await recoverWithCode(newPhone, H, { code: family.recoveryCode, label: 'Riya new phone' });
  assert.deepEqual([...restored.keys.keys()].sort(), [1, 2]);
  const old = await seal(H, family.tabletKeys, 'photo', 'p-1', utf8('photo bytes'));
  assert.equal(text(await open(H, restored.keys, 'photo', 'p-1', old)), 'photo bytes');
  await assert.rejects(recoverWithCode(newPhone, H, { code: family.recoveryCode.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }), /typo/);
});

test('a split recovery kit works with any two of the three sheets', async () => {
  const { recoverySheets } = await replaceRecoveryKit(family.riya, H, family.riyaKeys, { split: true });
  assert.equal(recoverySheets.length, 3);
  const call = await signIn('riya@saathi.demo');
  const restored = await recoverWithCode(call, H, { sheets: [recoverySheets[2], recoverySheets[0]], label: 'from sheets' });
  assert.ok(restored.keys.get(2));
  await assert.rejects(recoverWithCode(call, H, { code: family.recoveryCode }), () => true);
});
