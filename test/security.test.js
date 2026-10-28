import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign as signData } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createAccountSecurity } from '../src/accounts/security.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createAuditLog } from '../src/security/audit.js';
import { createSealer, deriveKey, loadMasterKey } from '../src/security/keys.js';
import { createRateLimiter, safeJsonReviver } from '../src/security/guards.js';
import { totpAt, verifyTotp } from '../src/security/totp.js';
import { configurePepper, hashPassword, verifyPassword, passwordProblem, createBreachCheck } from '../src/accounts/passwords.js';
import { createFileStore } from '../src/local/fileStore.js';
import { createLocalMedia } from '../src/local/platform.js';
import { createReplayGuard, sign as signWebhook, verifySignature } from '../src/ring/webhook.js';
import { startupProblems } from '../src/security/startup.js';
import { routeFor } from '../src/http/guard.js';
import { decide, chainLink, sessionState, CORE_SHA256 } from '../src/security/core.js';
import { testServices, testConfig } from './helpers.js';

let server;
let base;
let services;
let accounts;
let audit;
let sessions;
const rp = { name: 'Saathi', id: '127.0.0.1', origins: [] };

before(async () => {
  services = testServices();
  accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  audit = createAuditLog({ store: services.store, key: randomBytes(32) });
  sessions = createSessions('security-test-secret-that-is-long-enough', { store: services.store });
  const security = createAccountSecurity({ accounts, store: services.store, sealer: createSealer(randomBytes(32)), rp });
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true, exposed: true, rateLimit: false } }),
    services, accounts, sessions, security, audit,
    optionalVerifier: createHouseholdVerifier({ base: null, accounts }),
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  rp.origins.push(base);
});

after(() => server.close());

let ipCounter = 0;
function agent() {
  let cookie = '';
  ipCounter += 1;
  const ip = `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { 'x-forwarded-for': ip, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair] = set.split(';');
      const [name] = pair.split('=');
      cookie = [...cookie.split('; ').filter((c) => c && !c.startsWith(`${name}=`)), pair].join('; ');
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

async function login(email, password = DEMO_PASSWORD) {
  const a = agent();
  const out = await a.call('/auth/login', { method: 'POST', body: { email, password } });
  return Object.assign(a, { out });
}

function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') { const s = Buffer.from(value); return Buffer.concat([head(3, s.length), s]); }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

function softwareAuthenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(16);
  const b64 = (b) => Buffer.from(b).toString('base64url');
  let counter = 0;
  const rpHash = createHash('sha256').update(rp.id).digest();
  const client = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin: base, crossOrigin: false }));
  return {
    id: b64(credentialId),
    register(options) {
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const len = Buffer.alloc(2); len.writeUInt16BE(credentialId.length);
      const count = Buffer.alloc(4); count.writeUInt32BE(counter);
      const authData = Buffer.concat([rpHash, Buffer.from([0x45]), count, Buffer.alloc(16), len, credentialId, cose]);
      return {
        id: b64(credentialId), rawId: b64(credentialId), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64(client('webauthn.create', options.challenge)), attestationObject: b64(cbor({ fmt: 'none', attStmt: {}, authData })), transports: ['internal'] },
      };
    },
    assert(options, { userHandle } = {}) {
      counter += 1;
      const count = Buffer.alloc(4); count.writeUInt32BE(counter);
      const authData = Buffer.concat([rpHash, Buffer.from([0x05]), count]);
      const clientData = client('webauthn.get', options.challenge);
      const signature = signData('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]), privateKey);
      return {
        id: b64(credentialId), rawId: b64(credentialId), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature), userHandle },
      };
    },
    rewind() { counter = 0; },
  };
}

test('every response carries a strict content security policy and hardening headers', async () => {
  const res = await agent().call('/login.html');
  const csp = res.headers.get('content-security-policy');
  for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "require-trusted-types-for 'script'", "script-src-attr 'none'"]) {
    assert.ok(csp.includes(directive), `missing ${directive}`);
  }
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.ok(res.headers.get('permissions-policy').includes('geolocation=()'));
  assert.equal(res.headers.get('x-powered-by'), null);
  const family = await agent().call('/family.html');
  const html = await readFile(new URL('../public/family.html', import.meta.url), 'utf8');
  for (const [, script] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const hash = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
    assert.ok(family.headers.get('content-security-policy').includes(hash), 'inline script hash missing');
  }
  const api = await agent().call('/api/session');
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('cross-site requests are refused before they reach any handler', async () => {
  const a = agent();
  const crossSite = await a.call('/auth/login', { method: 'POST', body: { email: 'riya@saathi.demo', password: DEMO_PASSWORD }, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  const evil = await a.call('/auth/login', { method: 'POST', body: { email: 'riya@saathi.demo', password: DEMO_PASSWORD }, headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const nullOrigin = await a.call('/auth/login', { method: 'POST', body: { email: 'riya@saathi.demo', password: DEMO_PASSWORD }, headers: { origin: 'null' } });
  assert.equal(nullOrigin.status, 403);
  const same = await a.call('/auth/login', { method: 'POST', body: { email: 'riya@saathi.demo', password: DEMO_PASSWORD }, headers: { 'sec-fetch-site': 'same-origin', origin: base } });
  assert.equal(same.status, 200);
});

test('prototype pollution payloads are dropped while parsing', async () => {
  const parsed = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"bad":1}},"ok":1}', safeJsonReviver);
  assert.equal(parsed.ok, 1);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, '__proto__'), false);
  const a = await login('riya@saathi.demo');
  await a.call('/api/family/message', { method: 'POST', body: '{"from":"riya","text":"hi","__proto__":{"isAdmin":true}}' });
  assert.equal({}.isAdmin, undefined);
});

test('token bucket rate limiting refills over time', () => {
  let t = 0;
  const limiter = createRateLimiter({ now: () => t });
  const rule = { capacity: 3, perMinute: 6 };
  assert.deepEqual([1, 2, 3].map(() => limiter.take('k', rule)), [0, 0, 0]);
  assert.ok(limiter.take('k', rule) > 0);
  t += 10_000;
  assert.equal(limiter.take('k', rule), 0);
  limiter.stop?.();
});

test('sessions live on the server: logging out kills the cookie everywhere, and sign out everywhere else works', async () => {
  const phone = await login('riya@saathi.demo');
  const laptop = await login('riya@saathi.demo');
  const stolen = phone.cookie;
  assert.equal((await phone.call('/api/status')).status, 200);
  await phone.call('/auth/logout', { method: 'POST' });
  const thief = agent();
  thief.cookie = stolen;
  assert.equal((await thief.call('/api/status')).status, 401);

  const tablet = await login('riya@saathi.demo');
  const list = await laptop.call('/api/security');
  assert.ok(list.json.sessions.length >= 2);
  assert.ok(list.json.sessions.every((s) => !('tokenHash' in s) && !('email' in s)));
  const ended = await laptop.call('/api/security/sessions/revoke-others', { method: 'POST', body: {} });
  assert.ok(ended.json.ended >= 1);
  assert.equal((await tablet.call('/api/status')).status, 401);
  assert.equal((await laptop.call('/api/status')).status, 200);

  const forged = agent();
  forged.cookie = laptop.cookie.replace(/s1\.([^.]+)\./, (m, raw) => `s1.${raw.slice(0, -2)}xx.`);
  assert.equal((await forged.call('/api/status')).status, 401);
});

test('passwords: peppered scrypt, transparent upgrade, breach and common-password checks', async () => {
  configurePepper(null);
  const old = await hashPassword('a sturdy family password');
  configurePepper(randomBytes(32));
  const check = await verifyPassword('a sturdy family password', old);
  assert.equal(check.ok, true);
  assert.equal(check.needsRehash, true);
  const fresh = await hashPassword('a sturdy family password');
  assert.match(fresh, /^scrypt2\$p1\$/);
  assert.deepEqual(await verifyPassword('a sturdy family password', fresh), { ok: true, needsRehash: false });
  assert.equal((await verifyPassword('wrong', fresh)).ok, false);
  configurePepper(null);

  assert.ok(passwordProblem('password123'));
  assert.ok(passwordProblem('short'));
  assert.ok(passwordProblem('riya.sharma@example.com', { email: 'riya.sharma@example.com' }));
  assert.equal(passwordProblem('grandson-visits-7'), null);

  const asked = [];
  const breached = createBreachCheck({
    fetchImpl: async (url, opts) => {
      asked.push({ url, padding: opts.headers['Add-Padding'] });
      const suffix = createHash('sha1').update('hunter2hunter2').digest('hex').toUpperCase().slice(5);
      return { ok: true, text: async () => `0000000000000000000000000000000000A:0\r\n${suffix}:4242\r\n` };
    },
  });
  assert.equal(await breached('hunter2hunter2'), 4242);
  assert.match(asked[0].url, /\/range\/[0-9A-F]{5}$/);
  assert.equal(asked[0].padding, 'true');
});

test('repeated wrong passwords lock the account, even against the right password', async () => {
  for (let i = 0; i < 5; i++) {
    const wrong = await agent().call('/auth/login', { method: 'POST', body: { email: 'meera@saathi.demo', password: `nope-${i}-guess` } });
    assert.equal(wrong.status, 400);
  }
  const locked = await agent().call('/auth/login', { method: 'POST', body: { email: 'meera@saathi.demo', password: DEMO_PASSWORD } });
  assert.equal(locked.status, 429);
  assert.match(locked.json.error, /wait/i);
  const unknown = await agent().call('/auth/login', { method: 'POST', body: { email: 'nobody@nowhere.test', password: 'whatever-it-is-9' } });
  assert.equal(unknown.status, 400);
});

test('two-step sign-in: TOTP with replay protection, recovery codes that work once, and fresh-auth for changes', async () => {
  const anand = await login('anand@saathi.demo');
  const started = await anand.call('/api/security/totp/start', { method: 'POST', body: {} });
  assert.equal(started.status, 200);
  assert.match(started.json.qr, /^<svg/);
  const secret = started.json.secret.replace(/\s/g, '');
  const step = () => Math.floor(Date.now() / 30000);
  assert.equal((await anand.call('/api/security/totp/confirm', { method: 'POST', body: { code: '000000' === totpAt(secret, step()) ? '111111' : '000000' } })).status, 400);
  const confirmed = await anand.call('/api/security/totp/confirm', { method: 'POST', body: { code: totpAt(secret, step()) } });
  assert.equal(confirmed.json.recoveryCodes.length, 10);
  const recovery = confirmed.json.recoveryCodes;
  const stored = await accounts.raw('anand@saathi.demo');
  assert.ok(!JSON.stringify(stored).includes(secret), 'TOTP secret must be sealed at rest');
  assert.ok(!JSON.stringify(stored).includes(recovery[0]), 'recovery codes must be hashed at rest');

  const half = await login('anand@saathi.demo');
  assert.deepEqual(half.out.json, { mfa: true });
  assert.equal((await half.call('/api/status')).status, 401);
  assert.equal((await half.call('/auth/login/mfa', { method: 'POST', body: { code: totpAt(secret, step()) } })).status, 400, 'a code already used must not work again');
  assert.equal((await half.call('/auth/login/mfa', { method: 'POST', body: { code: recovery[0] } })).status, 200);
  assert.equal((await half.call('/api/status')).status, 200);

  const again = await login('anand@saathi.demo');
  assert.equal((await again.call('/auth/login/mfa', { method: 'POST', body: { code: recovery[0] } })).status, 400, 'recovery codes are single use');
  const next = await again.call('/auth/login/mfa', { method: 'POST', body: { code: totpAt(secret, step() + 1) } });
  assert.equal(next.status, 200);

  assert.ok(verifyTotp(secret, totpAt(secret, step() - 1), { window: 1 }) !== null);
  assert.equal(verifyTotp(secret, totpAt(secret, step() - 5), { window: 1 }), null);
});

test('sensitive changes need a recent sign-in, or the password again', async () => {
  const meera = agent();
  for (const t of await services.store.list('loginThrottle')) await services.store.remove('loginThrottle', t.id);
  await meera.call('/auth/login', { method: 'POST', body: { email: 'meera@saathi.demo', password: DEMO_PASSWORD } });
  const [mine] = await sessions.list((x) => x.kind === 'user' && x.email === 'meera@saathi.demo');
  await sessions.update(mine.id, { createdAt: new Date(Date.now() - 3600_000).toISOString() });
  const stale = await meera.call('/api/security/totp/start', { method: 'POST', body: {} });
  assert.equal(stale.status, 401);
  assert.equal(stale.json.code, 'reauth');
  assert.equal((await meera.call('/api/security/reauth', { method: 'POST', body: { password: 'not-my-password' } })).status, 400);
  assert.equal((await meera.call('/api/security/reauth', { method: 'POST', body: { password: DEMO_PASSWORD } })).status, 200);
  assert.equal((await meera.call('/api/security/totp/start', { method: 'POST', body: {} })).status, 200);
});

test('passkeys: register with a software authenticator, sign in without a password, and catch cloned keys', async () => {
  const riya = await login('riya@saathi.demo');
  const key = softwareAuthenticator();
  const options = await riya.call('/api/security/passkeys/options', { method: 'POST', body: {} });
  assert.equal(options.json.authenticatorSelection.userVerification, 'required');
  assert.equal(options.json.authenticatorSelection.residentKey, 'required');
  const saved = await riya.call('/api/security/passkeys', { method: 'POST', body: { response: key.register(options.json), name: 'Test key' } });
  assert.equal(saved.status, 200, saved.text);
  const replayed = await riya.call('/api/security/passkeys', { method: 'POST', body: { response: key.register(options.json), name: 'Again' } });
  assert.equal(replayed.status, 400, 'a registration challenge works once');

  const fresh = agent();
  const loginOptions = await fresh.call('/auth/passkey/options', { method: 'POST', body: {} });
  const ok = await fresh.call('/auth/passkey/verify', { method: 'POST', body: { response: key.assert(loginOptions.json) } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await fresh.call('/api/status')).status, 200);

  const tooLate = await fresh.call('/auth/passkey/verify', { method: 'POST', body: { response: key.assert(loginOptions.json) } });
  assert.equal(tooLate.status, 400, 'a login challenge works once');

  const clone = agent();
  const cloneOptions = await clone.call('/auth/passkey/options', { method: 'POST', body: {} });
  key.rewind();
  const cloned = await clone.call('/auth/passkey/verify', { method: 'POST', body: { response: key.assert(cloneOptions.json) } });
  assert.equal(cloned.status, 400, 'a signature counter going backwards means a cloned key');

  const imposter = softwareAuthenticator();
  const other = agent();
  const otherOptions = await other.call('/auth/passkey/options', { method: 'POST', body: {} });
  assert.equal((await other.call('/auth/passkey/verify', { method: 'POST', body: { response: imposter.assert(otherOptions.json) } })).status, 400);
});

test('the security history is a hash chain: edits, deletions and truncation are all detected', async () => {
  const store = createFileStore({ persist: false });
  const log = createAuditLog({ store, key: randomBytes(32) });
  for (let i = 0; i < 5; i++) await log.append({ householdId: 'h1', actor: 'riya', action: 'signed-in', detail: { i } });
  await log.append({ householdId: 'h2', actor: 'kabir', action: 'signed-in' });
  assert.deepEqual(await log.verify('h1'), { ok: true, entries: 5 });

  const third = (await log.entries('h1'))[2];
  await store.put('audit', { ...third, actor: 'mallory' });
  assert.equal((await log.verify('h1')).ok, false);
  await store.put('audit', third);
  assert.equal((await log.verify('h1')).ok, true);

  await store.remove('audit', third.id);
  assert.equal((await log.verify('h1')).ok, false);
  await store.put('audit', third);

  const last = (await log.entries('h1'))[4];
  await store.remove('audit', last.id);
  assert.equal((await log.verify('h1')).ok, false);
  assert.equal((await log.verify('h2')).ok, true);

  const riya = await login('riya@saathi.demo');
  const history = await riya.call('/api/security/log');
  assert.equal(history.status, 200);
  assert.equal(history.json.verified.ok, true);
  assert.ok(history.json.entries.some((e) => e.action === 'signed-in'));
  const member = await login('anand@saathi.demo');
  assert.notEqual((await member.call('/api/security/log')).status, 200);
});

test('voice notes and photos: encrypted on disk, served only through short-lived signed links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'saathi-media-'));
  let now = Date.parse('2026-10-28T10:00:00Z');
  const media = createLocalMedia({ dir, signingKey: randomBytes(32), encryptionKey: randomBytes(32), clock: () => now });
  const ref = await media.save('h1/voice/note.webm', Buffer.from('grandma-voice-note'));
  const onDisk = await readFile(join(dir, 'h1/voice/note.webm'));
  assert.ok(!onDisk.includes(Buffer.from('grandma-voice-note')));
  const url = new URL(await media.playbackUrl(ref), 'http://x');
  const query = Object.fromEntries(url.searchParams);
  assert.equal(media.verify(url.pathname, query), true);
  assert.equal(media.verify('/media/h2/voice/note.webm', query), false);
  assert.equal(media.verify(url.pathname, { ...query, sig: query.sig.slice(0, -1) + (query.sig.endsWith('A') ? 'B' : 'A') }), false);
  assert.equal(media.verify(url.pathname, { ...query, exp: String(Number(query.exp) + 3600) }), false);
  assert.equal(media.verify(url.pathname, {}), false);
  assert.equal((await media.read('h1/voice/note.webm')).body.toString(), 'grandma-voice-note');
  now += 2 * 3600 * 1000;
  assert.equal(media.verify(url.pathname, query), false);
  await assert.rejects(media.save('../escape.webm', Buffer.from('x')));
  assert.equal(await media.read('../../etc/passwd'), null);
  await writeFile(join(dir, 'h1/voice/note.webm'), Buffer.concat([onDisk.subarray(0, -1), Buffer.from([onDisk.at(-1) ^ 1])]));
  await assert.rejects(media.read('h1/voice/note.webm'));

  const unsigned = await agent().call('/media/default/voice/x.webm');
  assert.ok([403, 404].includes(unsigned.status));
});

test('the data file is sealed with AES-256-GCM and refuses the wrong key without touching it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'saathi-store-'));
  const file = join(dir, 'saathi.json');
  const master = loadMasterKey({ keyFile: join(dir, 'saathi.key') });
  assert.equal(master.created, true);
  const key = deriveKey(master.key, 'store');
  const store = createFileStore({ file, key });
  await store.put('accounts', { id: 'x@test', email: 'x@test', secretNote: 'the spare key is under the mat' });
  await new Promise((r) => setTimeout(r, 150));
  const raw = await readFile(file, 'utf8');
  assert.match(raw, /^SAATHI-ENC1/);
  assert.ok(!raw.includes('spare key'));
  assert.equal((await createFileStore({ file, key }).get('accounts', 'x@test')).secretNote, 'the spare key is under the mat');
  await assert.rejects(createFileStore({ file, key: randomBytes(32) }).list('accounts'), /could not read its data file/);
  assert.equal(await readFile(file, 'utf8'), raw);
  assert.equal(loadMasterKey({ keyFile: join(dir, 'saathi.key') }).key.equals(master.key), true);
  assert.notDeepEqual(deriveKey(master.key, 'store'), deriveKey(master.key, 'sessions'));
});

test('doorbell webhooks: signatures, stale timestamps and replays are all refused', () => {
  const secret = 'ring-secret';
  const body = '{"kind":"ding"}';
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const replay = createReplayGuard();
  const signature = signWebhook(secret, ts, body);
  assert.deepEqual(verifySignature({ secret, signature, timestamp: ts, rawBody: body, now, replay }), { ok: true });
  assert.equal(verifySignature({ secret, signature, timestamp: ts, rawBody: body, now, replay }).reason, 'replayed');
  assert.equal(verifySignature({ secret, signature, timestamp: ts, rawBody: `${body} `, now }).reason, 'bad signature');
  const old = String(Math.floor(now / 1000) - 3600);
  assert.equal(verifySignature({ secret, signature: signWebhook(secret, old, body), timestamp: old, rawBody: body, now }).reason, 'stale timestamp');
  assert.equal(verifySignature({ secret, signature, timestamp: '1e9', rawBody: body, now }).reason, 'bad timestamp');
});

test('a Saathi reachable from the internet refuses anonymous MCP callers', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /Bearer/);
});

test('unsafe configurations refuse to start', () => {
  const exposed = startupProblems(testConfig({ demo: false, host: '0.0.0.0', web: { requireLogin: false }, auth: {} }), { env: {} });
  assert.equal(exposed.exposed, true);
  assert.equal(exposed.errors.length, 1);
  const local = startupProblems(testConfig({ demo: false, host: '127.0.0.1', web: { requireLogin: false }, auth: {} }), { env: {} });
  assert.deepEqual(local.errors, []);
  const plainHttp = startupProblems(testConfig({ demo: false, host: '127.0.0.1', web: {}, auth: { publicUrl: 'http://saathi.example.com' } }), { env: {} });
  assert.ok(plainHttp.warnings.some((w) => /not https/.test(w)));
  assert.ok(startupProblems(testConfig({ host: '127.0.0.1', web: {}, auth: {} }), { env: { SAATHI_MASTER_KEY: 'c2hvcnQ=' } }).errors.length);
});

test('a device only joins after the family approves the matching pictures', async () => {
  const riya = await login('riya@saathi.demo');
  const { json: { code } } = await riya.call('/api/devices/pairing-code', { method: 'POST', body: {} });
  const intruder = agent();
  const asked = await intruder.call('/auth/device', { method: 'POST', body: { code } });
  assert.equal(asked.json.status, 'pending');
  const [request] = (await riya.call('/api/devices/requests')).json;
  assert.deepEqual(request.emoji, asked.json.emoji);
  await riya.call(`/api/devices/requests/${request.id}`, { method: 'POST', body: { approve: false } });
  assert.equal((await intruder.call('/auth/device/status')).json.status, 'denied');
  assert.equal((await intruder.call('/api/session')).json.device ?? null, null);
  const history = await riya.call('/api/security/log');
  assert.ok(history.json.entries.some((e) => e.action === 'device-refused'));
});

test('zero trust: every API route in the code is covered by the default-deny guard', async () => {
  const files = ['app.js', 'authRoutes.js', 'securityRoutes.js'];
  const routes = [];
  for (const f of files) {
    const src = await readFile(new URL(`../src/http/${f}`, import.meta.url), 'utf8');
    for (const [, who, method, path] of src.matchAll(/\b(api|app)\.(get|post|put|delete|patch)\('([^']+)'/g)) {
      if (who === 'api') routes.push([method.toUpperCase(), path]);
      else if (path.startsWith('/api/')) routes.push([method.toUpperCase(), path.slice(4)]);
    }
  }
  assert.ok(routes.length > 60, `found ${routes.length} routes`);
  for (const [method, path] of routes) {
    const concrete = path.replace(/:[A-Za-z]+/g, 'x1');
    assert.ok(routeFor(method, concrete), `${method} /api${path} has no entry in the guard`);
  }
  assert.equal(routeFor('GET', '/something-new'), null);
  assert.equal((await agent().call('/api/something-new')).status, 404);
});

test('zero trust: neighbours and devices only reach what their role allows', async () => {
  for (const t of await services.store.list('loginThrottle')) await services.store.remove('loginThrottle', t.id);
  const meera = await login('meera@saathi.demo');
  assert.equal((await meera.call('/api/status')).status, 200);
  const care = await meera.call('/api/care');
  assert.equal(care.status, 403);
  assert.equal(care.json.code, 'neighbour-cannot');
  assert.equal((await meera.call('/api/devices/pairing-code', { method: 'POST', body: {} })).status, 403);
  assert.equal((await meera.call('/api/family/letter', { method: 'POST', body: {} })).status, 403);

  const riya = await login('riya@saathi.demo');
  assert.equal(riya.out.status, 200, riya.out.text);
  const made = await riya.call('/api/devices/pairing-code', { method: 'POST', body: {} });
  assert.equal(made.status, 200, made.text);
  const { code } = made.json;
  const tablet = agent();
  await tablet.call('/auth/device', { method: 'POST', body: { code } });
  const pending = await riya.call('/api/devices/requests');
  assert.equal(pending.status, 200, pending.text);
  const request = pending.json.find((r) => r.status === 'pending');
  await riya.call(`/api/devices/requests/${request.id}`, { method: 'POST', body: { approve: true } });
  assert.equal((await tablet.call('/auth/device/status')).json.status, 'approved');
  assert.equal((await tablet.call('/api/family/summary')).status, 200);
  const refill = await tablet.call('/api/family/refill', { method: 'POST', body: { medicationId: 'x', quantity: 30 } });
  assert.equal(refill.status, 403);
  assert.equal(refill.json.code, 'device-cannot');
  assert.equal((await tablet.call('/api/care')).status, 403);
  const history = await riya.call('/api/security/log');
  assert.ok(history.json.entries.some((e) => e.action === 'access-denied' && e.detail.why === 'neighbour-cannot'));
});

test('the Rust core is the single decision point and matches the old JavaScript behaviour', () => {
  assert.match(CORE_SHA256, /^[0-9a-f]{64}$/);
  assert.deepEqual(decide({ principal: { kind: 'anonymous' }, action: 'status', household: 'h' }), { ok: false, status: 401, code: 'not-signed-in' });
  assert.equal(decide({ principal: { kind: 'user', household: 'h2', role: 'owner' }, action: 'care.read', household: 'h1' }).code, 'other-household');
  assert.throws(() => decide({ principal: { kind: 'user', household: 'h', role: 'owner' }, action: 'made.up', household: 'h' }), /unknown action/);
  const key = randomBytes(32);
  const js = createHmac('sha256', key).update('prev').update('\n').update('{"a":1}').digest('base64url');
  assert.equal(chainLink(key, 'prev', '{"a":1}'), js);
  const t = Date.parse('2026-10-28T10:00:00Z');
  assert.equal(sessionState({ kind: 'user', createdAt: t, lastSeenAt: t, now: t + 8 * 86400_000 }).state, 'idle');
  assert.equal(sessionState({ kind: 'device', createdAt: t, lastSeenAt: t, now: t + 8 * 86400_000 }).valid, true);
  assert.equal(sessionState({ kind: 'user', createdAt: t, lastSeenAt: t, now: t + 16 * 60_000 }).fresh, false);
});
