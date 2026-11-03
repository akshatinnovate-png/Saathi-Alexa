import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { getPath, resolveParameters, runStateMachine, loadDefinition } from '../src/escalation/interpreter.js';
import { validateOnboarding, buildHousehold, newHouseholdId } from '../src/households/onboarding.js';
import { doorKind, createDoorbell } from '../src/doorbell/doorbell.js';
import { isLoopback, isPrivate, hostAllowed, guardedLookup } from '../src/security/egress.js';
import { pkce, createVault, createGoogle, GMAIL_SEND_SCOPE } from '../src/accounts/google.js';
import { createMailer, rfc822, UNDELIVERABLE } from '../src/mail/mailer.js';
import { createFamilyMail } from '../src/mail/familyMail.js';
import { createAwsTranslator, createAwsSentiment, createAwsSpeech } from '../src/aws/language.js';
import { hashPassword, verifyPassword, passwordProblem, createBreachCheck, configurePepper, burnEqualTime } from '../src/accounts/passwords.js';
import { createFileStore } from '../src/local/fileStore.js';

const silent = { error() {}, warn() {}, log() {} };
const plainVault = { seal: async (s) => `sealed:${s}`, open: async (s) => String(s).slice(7) };

test('interpreter: JSONPath, parameters and every state type', async () => {
  assert.deepEqual(getPath({ a: 1 }, '$'), { a: 1 });
  assert.equal(getPath({ a: { b: 2 } }, '$.a.b'), 2);
  assert.equal(getPath({ a: null }, '$.a.b'), undefined);
  assert.equal(getPath({ a: 1 }, '$.missing'), undefined);
  assert.throws(() => getPath({}, 'a.b'), /Unsupported JSONPath/);
  assert.deepEqual(resolveParameters([{ 'x.$': '$.a' }, 3, null], { a: 7 }), [{ x: 7 }, 3, null]);
  assert.deepEqual(resolveParameters({ n: { 'v.$': '$.a' }, k: 'k' }, { a: 1 }), { n: { v: 1 }, k: 'k' });

  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  let flaky = 0;
  const def = {
    StartAt: 'Seed',
    States: {
      Seed: { Type: 'Pass', Result: { n: 3, ok: true, name: 'x' }, ResultPath: '$.v', Next: 'Keep' },
      Keep: { Type: 'Pass', Next: 'Work' },
      Work: { Type: 'Task', Resource: 'work', Parameters: { 'n.$': '$.v.n' }, Retry: [{ ErrorEquals: ['States.ALL'], MaxAttempts: 2 }], ResultPath: '$.out', Next: 'Nap' },
      Nap: { Type: 'Wait', SecondsPath: '$.v.n', Next: 'Nap2' },
      Nap2: { Type: 'Wait', Seconds: 1, Next: 'Pick' },
      Pick: {
        Type: 'Choice',
        Choices: [
          { And: [{ Variable: '$.v.ok', BooleanEquals: true }, { Not: { Variable: '$.v.name', StringEquals: 'y' } }], Next: 'Or' },
        ],
        Default: 'Bad',
      },
      Or: { Type: 'Choice', Choices: [{ Or: [{ Variable: '$.v.n', NumericGreaterThan: 5 }, { Variable: '$.out', IsPresent: true }], Next: 'Drop' }] },
      Drop: { Type: 'Task', Resource: 'noop', ResultPath: null, Next: 'Done' },
      Done: { Type: 'Succeed' },
      Bad: { Type: 'Fail', Error: 'E', Cause: 'C' },
    },
  };
  const tasks = { noop: async () => 1, work: async ({ n }) => { if (flaky++ < 2) throw new Error('again'); return n * 2; } };
  const seen = [];
  const out = await runStateMachine(def, {}, { tasks, sleep, onTransition: ({ state }) => seen.push(state) });
  assert.equal(out.status, 'SUCCEEDED');
  assert.equal(out.output.out, 6);
  assert.deepEqual(sleeps, [1000, 2000, 3000, 1000]);
  assert.ok(seen.includes('Drop'));

  const fail = await runStateMachine({ StartAt: 'P', States: { P: { Type: 'Choice', Choices: [{ Variable: '$.x', IsPresent: true, Next: 'S' }], Default: 'F' }, S: { Type: 'Succeed' }, F: { Type: 'Fail', Error: 'E', Cause: 'C' } } }, {}, { tasks: {}, sleep });
  assert.deepEqual([fail.status, fail.error, fail.cause], ['FAILED', 'E', 'C']);
  const ended = await runStateMachine({ StartAt: 'P', States: { P: { Type: 'Pass', Result: 2, End: true } } }, {}, { tasks: {}, sleep });
  assert.equal(ended.output, 2);

  await assert.rejects(runStateMachine({ StartAt: 'Z', States: {} }, {}, { tasks: {}, sleep }), /Unknown state/);
  await assert.rejects(runStateMachine({ StartAt: 'T', States: { T: { Type: 'Task', Resource: 'nope', End: true } } }, {}, { tasks: {}, sleep }), /No local handler/);
  await assert.rejects(runStateMachine({ StartAt: 'T', States: { T: { Type: 'Task', Resource: 'x', End: true } } }, {}, { tasks: { x: async () => { throw new Error('boom'); } }, sleep }), /boom/);
  await assert.rejects(runStateMachine({ StartAt: 'T', States: { T: { Type: 'Map' } } }, {}, { tasks: {}, sleep }), /Unsupported state type/);
  await assert.rejects(runStateMachine({ StartAt: 'C', States: { C: { Type: 'Choice', Choices: [] } } }, {}, { tasks: {}, sleep }), /NoChoiceMatched/);
  await assert.rejects(runStateMachine({ StartAt: 'C', States: { C: { Type: 'Choice', Choices: [{ Variable: '$.a', Weird: 1, Next: 'C' }] } } }, {}, { tasks: {}, sleep }), /Unsupported Choice rule/);
  await assert.rejects(runStateMachine({ StartAt: 'L', States: { L: { Type: 'Pass', Next: 'L' } } }, {}, { tasks: {}, sleep }), /1000 transitions/);
  assert.ok(JSON.stringify(loadDefinition()).includes('${'));
});

test('onboarding: every validation problem and a translated household', async () => {
  assert.equal(validateOnboarding(undefined).length, 4);
  const problems = validateOnboarding({
    elder: { name: 'A', language: 'mr', timezone: 'Mars/Base', pronoun: 'it', country: 'ZZ' },
    owner: { name: 'B', relationship: 'son' },
    medications: [{ name: '', time: '8am' }, { name: 'X', times: ['08:00', '20:00'] }],
  });
  assert.equal(problems.length, 4);
  assert.match(newHouseholdId(), /^h-[0-9a-f]{12}$/);

  const translate = async (text) => (text.includes('neighbour is') ? text : `T(${text})`);
  const h = await buildHousehold({
    elder: { name: 'Sunita Rao', language: 'mr', timezone: 'Asia/Kolkata', pronoun: 'she', country: 'IN', emergencyNumber: '+91 112', memorySupport: true, lowVision: true, city: 'Pune' },
    owner: { name: 'Elder', relationship: 'Son', language: 'en' },
    neighbour: { name: 'Elder', email: 'N@X.org' },
    medications: [{ name: 'Elder', times: ['20:00', '08:00', '08:00'], purpose: 'sugar', remaining: 'x' }, { name: 'Pill', time: '09:00', description: 'red tablet', withFood: 1 }],
    privacy: { shareMoodWords: false },
    pharmacy: { name: 'Apollo', phone: '123' },
  }, { ownerEmail: 'o@x.org', translate, now: new Date(0) });
  assert.deepEqual(h.circle.map((p) => p.id), ['member', 'member-2']);
  assert.equal(h.circle[1].email, 'n@x.org');
  assert.ok(h.circle[0].i18n.mr.relationship);
  assert.deepEqual(h.medications[0].times, ['08:00', '20:00']);
  assert.equal(h.medications[0].supply.remaining, 30);
  assert.ok(h.medications[1].i18n.mr.phrase.startsWith('T('));
  const p = h.profile[0];
  assert.deepEqual([p.preferredName, p.pronoun, p.country, p.emergencyNumber, p.accessibility.preferredPace, p.privacy.shareMoodWords, p.pharmacy.name], ['Sunita', 'she', 'IN', '+91112', 'slow', false, 'Apollo']);

  const plain = await buildHousehold({ elder: { name: 'Ann', language: 'en', timezone: 'Nowhere', pronoun: 'x', country: 'ZZ' }, owner: { name: '!!!', relationship: 'daughter' } }, { ownerEmail: 'a@b.c' });
  assert.deepEqual([plain.profile[0].timezone, plain.profile[0].pronoun, plain.profile[0].country, plain.profile[0].pharmacy, plain.circle.length, plain.circle[0].id], ['UTC', 'they', null, null, 1, 'member']);
  const same = await buildHousehold({ elder: { name: 'Ann', language: 'hi' }, owner: { name: 'Raj', relationship: 'son' }, medications: [{ name: 'M', time: '07:00' }] }, { ownerEmail: 'a@b.c', translate: async (t) => t });
  assert.deepEqual(same.medications[0].i18n, {});
  assert.deepEqual(same.circle[0].i18n, {});
});

test('doorbell: hooks, events, Ring sign-in, codes and listeners', async () => {
  assert.equal(doorKind('Button pressed'), 'ding');
  assert.equal(doorKind('Person detected'), 'motion');
  assert.equal(doorKind(null), null);

  const store = createFileStore({ persist: false });
  const events = [];
  const services = { forHousehold: (id) => ({ doorEvent: async (e) => { events.push({ id, ...e }); if (e.deviceId === 'fail') throw new Error('x'); return e; } }) };
  const subs = { token: null, cams: [] };
  const camera = { id: 7, name: 'Front', onNewNotification: { subscribe: (fn) => subs.cams.push(fn) } };
  let twoFactor = false;
  let badPassword = false;
  class RingRestClient {
    constructor({ email }) { this.email = email; this.refreshToken = 'rt'; }
    async getAuth(code) {
      if (badPassword) throw new Error('not correct');
      if (twoFactor && !code) { this.using2fa = true; this.promptFor2fa = 'Code sent'; throw new Error('2fa'); }
      if (code === 'bad') { this.promptFor2fa = 'Invalid code'; throw new Error('bad'); }
      if (code === 'odd') throw new Error('odd');
    }
  }
  let failListen = false;
  class RingApi {
    constructor() { this.onRefreshTokenUpdated = { subscribe: (fn) => { subs.token = fn; } }; }
    async getCameras() { if (failListen) throw new Error('ring down'); return [camera]; }
    disconnect() { this.gone = true; }
  }
  const errors = [];
  const bell = createDoorbell({ store, services, vault: plainVault, publicUrl: 'https://s', ring: { RingApi, RingRestClient }, log: { error: (...a) => errors.push(a.join(' ')) } });

  const url = await bell.newHook('h1');
  const url2 = await bell.newHook('h1');
  const token = url2.split('/').pop();
  assert.equal(await bell.handleHook(url.split('/').pop()), null);
  assert.equal(await bell.handleHook(''), null);
  assert.equal((await bell.handleHook(token, { event: 'motion', device: 'cam' })).kind, 'motion');
  assert.equal((await bell.handleHook(token)).kind, 'ding');
  await assert.rejects(bell.handleHook(token, { type: 'hello' }), /ding/);
  assert.equal((await bell.status('h1')).hookUrl, url2);
  assert.deepEqual((await bell.status('h2')).ring, { connected: false });

  await assert.rejects(bell.connectRing('h1', {}), /email and password/);
  badPassword = true;
  await assert.rejects(bell.connectRing('h1', { email: 'a', password: 'b' }), /did not accept/);
  badPassword = false;
  twoFactor = true;
  assert.deepEqual(await bell.connectRing('h1', { email: 'a@b', password: 'p' }), { needsCode: true, prompt: 'Code sent' });
  assert.equal((await bell.status('h1')).waitingForCode, true);
  await assert.rejects(bell.verifyRingCode('h1', 'bad'), /not right/);
  await assert.rejects(bell.verifyRingCode('h9', '1'), /Start again/);
  const done = await bell.verifyRingCode('h1', ' 123 ');
  assert.deepEqual(done, { connected: true, cameras: ['Front'] });
  twoFactor = false;
  assert.deepEqual(await bell.connectRing('h1', { email: 'a@b', password: 'p' }), { connected: true, cameras: ['Front'] });
  const s = await bell.status('h1');
  assert.deepEqual([s.ring.connected, s.ring.email, s.ring.cameras], [true, 'a@b', ['Front']]);

  subs.cams.at(-1)({ android_config: { category: 'com.ring.pn.live-event.ding' } });
  subs.cams.at(-1)({ action: 'com.ring.pn.live-event.motion' });
  subs.cams.at(-1)({ action: 'other' });
  await subs.token({ newRefreshToken: 'rt2' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events.slice(-2).map((e) => e.kind), ['ding', 'motion']);
  assert.equal((await store.get('doorbellSettings', 'h1')).ring.refreshToken, 'sealed:rt2');

  assert.equal(await bell.listen('h2'), null);
  await store.put('doorbellSettings', { id: 'h3', ring: { refreshToken: 'sealed:x' } });
  failListen = true;
  await bell.startAll();
  assert.match(errors.join(), /ring down/);
  assert.equal((await store.get('doorbellSettings', 'h3')).ring.error, 'ring down');
  failListen = false;
  bell.stopAll();
  assert.deepEqual(await bell.disconnectRing('h1'), { connected: false });

  const missing = createDoorbell({ store, services, vault: plainVault, publicUrl: 'x', ring: null });
  await assert.rejects(missing.connectRing('h1', { email: 'a', password: 'b' }).catch((e) => { throw e; }), (e) => e.code === 'ring-missing' || /Ring/.test(e.message));
});

test('doorbell: odd Ring errors pass through', async () => {
  const store = createFileStore({ persist: false });
  class RingRestClient { constructor() { this.using2fa = false; } async getAuth(code) { if (code === undefined) { this.using2fa = true; this.promptFor2fa = undefined; throw new Error('2fa'); } throw new Error('odd'); } }
  const bell = createDoorbell({ store, services: {}, vault: plainVault, publicUrl: 'x', ring: { RingRestClient, RingApi: class {} } });
  assert.deepEqual(await bell.connectRing('h', { email: 'a', password: 'b' }), { needsCode: true, prompt: 'Enter the code Ring sent you.' });
  await assert.rejects(bell.verifyRingCode('h', undefined), /Ring said/);
  class Rude { async getAuth() { throw new Error('server sad'); } }
  const other = createDoorbell({ store, services: {}, vault: plainVault, publicUrl: 'x', ring: { RingRestClient: Rude, RingApi: class {} } });
  await assert.rejects(other.connectRing('h', { email: 'a', password: 'b' }), /Ring said: server sad/);
});

test('egress: address classes, allow rules and the guarded resolver', async () => {
  for (const a of ['127.0.0.1', '[::1]', '::ffff:127.0.0.2', 'localhost']) assert.ok(isLoopback(a), a);
  for (const a of ['8.8.8.8', '2001:db8::1', 'example.com']) assert.ok(!isLoopback(a), a);
  for (const a of ['0.1.2.3', '10.0.0.1', '169.254.1.1', '172.20.0.1', '192.168.1.1', '100.64.0.1', '224.0.0.1', '::', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1']) assert.ok(isPrivate(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '2606:4700::1', 'host']) assert.ok(!isPrivate(a), a);
  const allow = ['.googleapis.com', 'api.anthropic.com'];
  assert.ok(hostAllowed('gmail.googleapis.com.', allow));
  assert.ok(!hostAllowed('googleapis.com', allow));
  assert.ok(hostAllowed('API.anthropic.com', allow));
  assert.ok(hostAllowed('localhost', allow));
  assert.ok(!hostAllowed('', allow));
  assert.ok(!hostAllowed('1.2.3.4', allow));

  const fake = (address, family) => (host, opts, cb) => cb(address instanceof Error ? address : null, address, family);
  const call = (lookup, ...args) => new Promise((resolve) => lookup('example.com', ...args, (err, address) => resolve(err ?? address)));
  assert.equal(await call(guardedLookup(fake('8.8.8.8', 4)), 4), '8.8.8.8');
  assert.equal((await call(guardedLookup(fake('10.0.0.1', 4)), {})).code, 'ESAATHIEGRESS');
  assert.equal((await call(guardedLookup(fake([{ address: '1.1.1.1' }, { address: 'fd00::1' }])), { all: true })).code, 'ESAATHIEGRESS');
  assert.match((await call(guardedLookup(fake(new Error('nxdomain'))))).message, /nxdomain/);
  const local = await new Promise((r) => guardedLookup(fake('127.0.0.1', 4))('localhost', {}, (e, a) => r(e ?? a)));
  assert.equal(local, '127.0.0.1');
});

test('google: PKCE, vault, auth URL, sign-in and Gmail sending', async () => {
  const p = pkce();
  assert.ok(p.verifier && p.challenge && p.state);
  const v = createVault('s');
  assert.equal(v.open(v.seal('hello')), 'hello');
  assert.throws(() => createVault('other').open(v.seal('x')));

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256' }] });
  const idToken = (claims) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuer('https://accounts.google.com').setAudience('cid').setSubject('42').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const replies = [];
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); const r = replies.shift(); return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => { if (r.bad) throw new Error('no json'); return r.body; } }; };
  const g = createGoogle({ clientId: 'cid', clientSecret: 'sec', fetchImpl, jwks });

  const gmailUrl = new URL(g.authUrl({ redirectUri: 'https://r', state: 's', challenge: 'c', nonce: 'n', gmail: true, loginHint: 'a@b' }));
  assert.ok(gmailUrl.searchParams.get('scope').includes(GMAIL_SEND_SCOPE));
  assert.equal(gmailUrl.searchParams.get('access_type'), 'offline');
  const plainUrl = new URL(g.authUrl({ redirectUri: 'https://r', state: 's', challenge: 'c' }));
  assert.equal(plainUrl.searchParams.get('prompt'), 'select_account');
  assert.equal(plainUrl.searchParams.get('nonce'), null);

  replies.push({ body: { id_token: await idToken({ email: 'A@B.com', nonce: 'n', given_name: 'Al' }), refresh_token: 'r', scope: 'openid email' } });
  const ok = await g.finish({ code: 'c', verifier: 'v', redirectUri: 'https://r', nonce: 'n' });
  assert.deepEqual([ok.identity.email, ok.identity.name, ok.identity.sub, ok.identity.picture, ok.refreshToken], ['a@b.com', 'Al', 'google:42', null, 'r']);
  replies.push({ body: { id_token: await idToken({ email: 'a@b.com', name: 'A', picture: 'p' }) } });
  const bare = await g.finish({ code: 'c', verifier: 'v', redirectUri: 'https://r' });
  assert.deepEqual([bare.refreshToken, bare.scopes, bare.identity.picture], [null, [''], 'p']);
  replies.push({ body: { id_token: await idToken({ email: 'a@b.com', nonce: 'x' }) } });
  await assert.rejects(g.finish({ code: 'c', verifier: 'v', redirectUri: 'https://r', nonce: 'n' }), /did not match/);
  replies.push({ body: { id_token: await idToken({ email: 'a@b.com', email_verified: false }) } });
  await assert.rejects(g.finish({ code: 'c', verifier: 'v', redirectUri: 'https://r' }), /email address/);
  replies.push({ ok: false, status: 400, body: { error: 'invalid_grant' } });
  await assert.rejects(g.finish({ code: 'c' }), /invalid_grant/);
  replies.push({ ok: false, status: 500, bad: true });
  await assert.rejects(g.finish({ code: 'c' }), /\(500\)/);
  replies.push({ ok: false, status: 400, body: { error_description: 'Bad code' } });
  await assert.rejects(g.finish({ code: 'c' }), /Bad code/);

  calls.length = 0;
  const sender = g.gmailSender({ email: 'a@b.com', name: 'A "B"', refreshToken: 'r' });
  replies.push({ body: { access_token: 't1' } }, { body: { id: 'm1' } }, { body: { id: 'm2' } });
  assert.equal(await sender.send({ to: 'c@d.com', subject: 's', html: '<p>h</p>', text: 't', replyTo: 'e@f.com' }), 'm1');
  assert.equal(await sender.send({ to: 'c@d.com', subject: 's', html: 'h', text: 't' }), 'm2');
  assert.equal(calls.filter((c) => String(c.url).includes('token')).length, 1);
  replies.push({ ok: false, status: 403, body: { error: { message: 'no scope' } } });
  await assert.rejects(sender.send({ to: 'c@d.com', subject: 's', html: 'h', text: 't' }), /no scope/);
  const noName = g.gmailSender({ email: 'a@b.com', refreshToken: 'r' });
  replies.push({ body: { access_token: 't', expires_in: 1 } }, { ok: false, status: 502, bad: true });
  await assert.rejects(noName.send({ to: 'c@d.com', subject: 's', html: 'h', text: 't' }), /\(502\)/);
});

test('mailer: transports, skipping, fallback and the family mail wrapper', async () => {
  assert.ok(UNDELIVERABLE.test('x@example.com'));
  assert.match(rfc822({ from: 'a', to: 'b', subject: 's', html: 'h', text: 't', replyTo: 'r' }), /Reply-To: r/);
  assert.doesNotMatch(rfc822({ from: 'a', to: 'b', subject: 's', html: 'h', text: 't' }), /Reply-To/);

  const sent = [];
  const sesClient = { send: async (cmd) => { sent.push(cmd.input); return { MessageId: 'ses1' }; } };
  const ses = createMailer({ mail: { ses: true, from: 'f@x.org' }, region: 'us-east-1', sesClient });
  assert.deepEqual([ses.kind, ses.real], ['amazon-ses', true]);
  assert.deepEqual(await ses.send({ to: 'p@x.org', subject: 's', html: 'h', text: 't', replyTo: 'r@x.org', fromName: 'Riya' }), { id: 'ses1', kind: 'amazon-ses' });
  await ses.send({ to: 'p@x.org', subject: 's', html: 'h', text: 't' });
  assert.equal(sent[1].ReplyToAddresses, undefined);
  assert.equal((await ses.send({ to: 'p@saathi.demo' })).skipped, true);
  assert.equal(createMailer({ mail: { gmailUser: 'g@gmail.com', gmailAppPassword: 'ab cd' } }).kind, 'gmail-smtp');
  assert.equal(createMailer({ mail: { smtpUrl: 'smtp://localhost:2525', from: 'a@b.c' } }).kind, 'smtp');

  const logs = [];
  const outbox = createMailer({ log: (m) => logs.push(m) });
  assert.equal(outbox.real, false);
  const viaFail = { kind: 'gmail-api', send: async () => { throw new Error('down'); } };
  const origError = console.error;
  console.error = () => {};
  try {
    const out = await outbox.send({ to: 'p@x.org', subject: 's', html: 'h', text: 'see https://x.org/a' }, { via: viaFail });
    assert.equal(out.kind, 'outbox');
    await outbox.send({ to: 'p@x.org', subject: 's', html: 'h', text: 'no link' });
    assert.match(logs[0], /Link: https:\/\/x.org\/a/);
    assert.doesNotMatch(logs[1], /Link/);
    assert.deepEqual(await outbox.send({ to: 'p@x.org', subject: 's', html: 'h', text: 't' }, { via: { kind: 'v', send: async () => 'v1' } }), { id: 'v1', kind: 'v' });

    const store = createFileStore({ persist: false });
    await store.put('hh#h1#profile', { id: 'elder', preferredName: 'Aaji' });
    await store.put('hh#h1#circle', { id: 'r', role: 'family', email: 'r@x.org' });
    await store.put('hh#h1#circle', { id: 'n', role: 'neighbour', email: 'n@x.org' });
    await store.put('hh#h1#circle', { id: 'z', email: 'z@x.org' });
    const mails = [];
    const mailer = { kind: 'outbox', real: false, from: 'f', send: async (m, o) => { mails.push({ ...m, via: o?.via?.kind }); if (m.to === 'bad@x.org') throw new Error('nope'); return { id: m.to === 'none@x.org' ? null : 'id', kind: o?.via?.kind ?? 'outbox' }; } };
    const google = { gmailSender: ({ email }) => ({ kind: 'gmail-api', from: email }) };
    const fm = createFamilyMail({ store, mailer, google, vault: plainVault, publicUrl: 'https://s' });
    assert.equal(fm.kind, 'outbox');
    assert.deepEqual(await fm.status('h1'), { service: 'outbox', real: false, from: 'f', gmail: null, googleAvailable: true });
    await fm.connectGmail('h1', { email: 'g@x.org', name: 'G', refreshToken: 'rt', by: 'r', now: new Date(0) });
    assert.equal((await fm.status('h1')).gmail.email, 'g@x.org');
    assert.deepEqual(await fm.sendInvite({ householdId: 'h1', inviterName: 'R', member: { email: null }, token: 't' }), { link: 'https://s/join.html?invite=t', emailed: false });
    assert.deepEqual(await fm.sendInvite({ householdId: 'h1', inviterName: 'R', member: { email: 'm@x.org', language: 'en' }, token: 't' }), { link: 'https://s/join.html?invite=t', emailed: true, via: 'gmail-api' });
    assert.equal((await fm.sendInvite({ householdId: 'h2', inviterName: 'R', member: { email: 'bad@x.org' }, token: 't' })).error, 'nope');
    assert.deepEqual(await fm.sendTest('h2', { to: 'none@x.org', name: 'N' }), { sent: false, via: 'outbox', skipped: false });
    const notifier = fm.wrapNotifier({ kind: 'local', notify: async () => 'n1' });
    assert.equal(notifier.kind, 'local+email');
    mails.length = 0;
    assert.equal(await notifier.notify({ householdId: 'h1', audience: 'everyone', subject: 's', message: 'm', severity: 'high' }), 'n1');
    assert.deepEqual(mails.map((m) => m.to).sort(), ['n@x.org', 'r@x.org', 'z@x.org']);
    mails.length = 0;
    await notifier.notify({ householdId: 'h1', audience: 'odd', recipientId: 'r', subject: 's', message: 'm' });
    assert.deepEqual(mails.map((m) => m.to), ['r@x.org']);
    await store.put('hh#h1#circle', { id: 'b', role: 'neighbour', email: 'bad@x.org' });
    await notifier.notify({ householdId: 'h1', audience: 'neighbour', subject: 's', message: 'm' });
    const broken = createFamilyMail({ store: { get: async () => null, list: async () => { throw new Error('db'); } }, mailer, publicUrl: 'x' });
    assert.equal(await broken.wrapNotifier({ kind: 'k', notify: async () => 'id' }).notify({ householdId: 'h1' }), 'id');
    await assert.rejects(broken.connectGmail('h1', {}), /session secret/);
    await fm.disconnectGmail('h1');
    assert.equal((await fm.status('h1')).gmail, null);
  } finally {
    console.error = origError;
  }
});

test('AWS language: translate, sentiment and speech with stub clients', async () => {
  const tr = createAwsTranslator({ client: { send: async (c) => ({ TranslatedText: `[${c.input.Text}]`, SourceLanguageCode: c.input.SourceLanguageCode === 'auto' ? undefined : 'hi' }) } });
  assert.deepEqual(await tr.translate('', { to: 'en' }), { text: '', from: 'auto', to: 'en', translated: false, engine: 'none' });
  assert.equal((await tr.translate('x', { from: 'en', to: 'en' })).engine, 'none');
  assert.equal((await tr.translate('x', { from: 'hi', to: 'en' })).translated, true);
  assert.equal((await tr.translate('x', { to: 'auto' })).translated, false);
  const sentiment = createAwsSentiment({ client: { send: async (c) => ({ Sentiment: 'POSITIVE', SentimentScore: c.input.LanguageCode === 'en' ? { Positive: 0.9 } : undefined }) }, translator: tr });
  const mr = await sentiment.analyze('छान', 'mr');
  assert.deepEqual([mr.analysedLanguage, mr.scores.positive, mr.scores.mixed], ['en', 0.9, 0]);
  assert.equal((await sentiment.analyze('hola', 'es')).scores.positive, 0);
  const speech = createAwsSpeech({ client: { send: async (c) => ({ AudioStream: { transformToByteArray: async () => new TextEncoder().encode(c.input.Text) } }) } });
  assert.equal(await speech.synthesize('x', 'zz'), null);
  const out = await speech.synthesize(`<a & 'b'> "c"`, 'en', { slow: true });
  assert.match(out.audio.toString(), /85%.*&lt;a &amp; &apos;b&apos;&gt; &quot;c&quot;/);
  assert.match((await speech.synthesize('y', 'hi')).audio.toString(), /100%/);
});

test('passwords: formats, pepper, rehash, rules and the breach check', async () => {
  configurePepper(null);
  const plain = await hashPassword('correct horse 9');
  assert.deepEqual(await verifyPassword('correct horse 9', plain), { ok: true, needsRehash: false });
  assert.deepEqual(await verifyPassword('x', 'md5$abc'), { ok: false, needsRehash: false });
  assert.deepEqual(await verifyPassword('x', undefined), { ok: false, needsRehash: false });
  const legacy = plain.split('$');
  const old = `scrypt$${legacy[2]}$${legacy[5]}$${legacy[6]}`;
  assert.deepEqual(await verifyPassword('correct horse 9', old), { ok: true, needsRehash: true });
  configurePepper('pepper-key');
  assert.deepEqual(await verifyPassword('correct horse 9', plain), { ok: true, needsRehash: true });
  const peppered = await hashPassword('correct horse 9');
  assert.ok(peppered.startsWith('scrypt2$p1$'));
  assert.equal((await verifyPassword('correct horse 9', peppered)).ok, true);
  configurePepper(async (d) => d);
  assert.equal((await verifyPassword('correct horse 9', peppered)).ok, false);
  configurePepper(null);
  assert.deepEqual(await verifyPassword('correct horse 9', peppered), { ok: false, needsRehash: false });
  await burnEqualTime('x');

  assert.match(passwordProblem(5), /10 characters/);
  assert.match(passwordProblem('a1'.repeat(101)), /200/);
  assert.match(passwordProblem('abcdefghijk'), /number/);
  assert.match(passwordProblem('Password123'), /common/);
  assert.match(passwordProblem('aaaa1111111'), /easy/);
  assert.match(passwordProblem('x meena@x.org 1', { email: 'meena@x.org' }), /email/);
  assert.match(passwordProblem('my meena 12345', { email: 'meena@x.org' }), /email/);
  assert.match(passwordProblem('my sunita 1234', { name: 'Sunita Rao' }), /name/);
  assert.equal(passwordProblem('blue kettle 42 sings'), null);

  const warns = [];
  const reply = (ok, text) => async () => ({ ok, text: async () => text });
  const { createHash } = await import('node:crypto');
  const suffix = createHash('sha1').update('pw').digest('hex').toUpperCase().slice(5);
  assert.equal(await createBreachCheck({ fetchImpl: reply(true, `AAA:1\r\n${suffix}:12`) })('pw'), 12);
  assert.equal(await createBreachCheck({ fetchImpl: reply(true, `${suffix}:x`) })('pw'), 0);
  assert.equal(await createBreachCheck({ fetchImpl: reply(true, 'AAA:1') })('pw'), 0);
  assert.equal(await createBreachCheck({ fetchImpl: reply(false, '') })('pw'), 0);
  assert.equal(await createBreachCheck({ fetchImpl: async () => { throw new Error('offline'); }, log: { warn: (m) => warns.push(m) } })('pw'), 0);
  assert.match(warns[0], /offline/);
  assert.equal(await createBreachCheck({ fetchImpl: async () => { throw new Error('offline'); }, log: silent.log })('pw'), 0);
});

test('sessions: tokens, cookies, devices, expiry and agents', async () => {
  const { createSessions, sessionSecret, describeAgent, readCookie, cookieHeader } = await import('../src/accounts/sessions.js');
  const store = createFileStore({ persist: false });
  assert.equal(await sessionSecret(store, 'given'), 'given');
  const made = await sessionSecret(store);
  assert.equal(await sessionSecret(store), made);

  let t = Date.parse('2026-01-01T00:00:00Z');
  const s = createSessions('secret', { clock: () => new Date(t) });
  const token = await s.issue({ a: 1 }, 60);
  assert.equal((await s.read(token)).a, 1);
  assert.equal(await s.read(`${token}x`), null);
  assert.equal(await s.read(undefined), null);
  const junk = 'bm90LWpzb24';
  const mac = (await s.issue({})).split('.')[1];
  assert.equal(await s.read(`${junk}.${mac}`), null);
  const tsec = createSessions('secret', { clock: () => new Date(t) });
  const { createHmac } = await import('node:crypto');
  assert.equal(await tsec.read(`${junk}.${createHmac('sha256', 'secret').update(junk).digest('base64url')}`), null);

  const user = await s.start({ email: 'a@b.c', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537' });
  const device = await s.start({ deviceId: 'd1' });
  assert.equal(user.record.agent, 'Chrome on Windows');
  assert.equal(device.record.kind, 'device');
  assert.equal((await s.resolve(user.cookie)).email, 'a@b.c');
  assert.equal(await s.resolve('s2.x.y'), null);
  assert.equal(await s.resolve(`${user.cookie}x`), null);
  t += 2 * 24 * 3600 * 1000;
  assert.ok(await s.resolve(user.cookie));
  t += 8 * 24 * 3600 * 1000;
  assert.equal(await s.resolve(user.cookie), null);
  assert.ok(await s.resolve(device.cookie));
  await s.update(device.record.id, { name: 'x' });
  assert.equal((await s.list(() => true)).length, 1);
  const again = await s.start({ email: 'a@b.c' });
  assert.equal(await s.revokeWhere((r) => r.email === 'a@b.c', { except: again.record.id }), 0);
  assert.equal(await s.revokeWhere(() => true, { except: again.record.id }), 1);
  assert.equal(await s.revoke(again.record.id), true);
  assert.equal(await s.resolve(again.cookie), null);

  const keyed = createSessions('ignored', { keyring: { hmac: async (_p, v) => Buffer.from(createHmac('sha256', 'k').update(v).digest()) } });
  assert.ok(await keyed.read(await keyed.issue({ z: 1 })));

  const agents = {
    'Edg/1': 'Edge', 'OPR/1 Android': 'Opera on Android', 'Firefox/1 iPhone': 'Firefox on iPhone or iPad', 'Safari/1 Mac OS X': 'Safari on Mac',
    'Silk/1 CrOS': 'Silk on Chromebook', 'Linux': 'A browser on Linux', '': 'A browser on an unknown system',
  };
  for (const [ua, want] of Object.entries(agents)) assert.ok(describeAgent(ua).startsWith(want), ua);
  assert.equal(describeAgent(), 'A browser on an unknown system');
  assert.equal(readCookie('a=1; b=hello%20there', 'b'), 'hello there');
  assert.equal(readCookie('a=%E0%A4%A', 'a'), null);
  assert.equal(readCookie(undefined, 'a'), null);
  assert.equal(cookieHeader('n', 'v', { maxAge: 5, secure: true }), 'n=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=5; Secure');
  assert.equal(cookieHeader('n', 'v', { maxAge: 5, sameSite: 'Strict' }), 'n=v; Path=/; HttpOnly; SameSite=Strict; Max-Age=5');
});

test('account security: TOTP, recovery codes and passkey edge cases', async () => {
  const { createAccountSecurity } = await import('../src/accounts/security.js');
  const { totpAt } = await import('../src/security/totp.js');
  const rows = new Map([['a@b.c', { email: 'a@b.c', name: 'A', passwordHash: 'h', provider: 'local' }], ['p@b.c', { email: 'p@b.c', provider: 'local', passkeys: [{ id: 'k1', name: 'K', createdAt: 'x', counter: 0 }] }]]);
  const accounts = { raw: async (e) => structuredClone(rows.get(e) ?? null), update: async (e, patch) => rows.set(e, { ...rows.get(e), ...patch }) };
  const store = createFileStore({ persist: false });
  let t = Date.parse('2026-01-01T00:00:00Z');
  const sec = createAccountSecurity({ accounts, store, sealer: plainVault, rp: { id: 'localhost', name: 'Saathi', origins: ['http://localhost'] }, clock: () => new Date(t) });

  await assert.rejects(sec.summary('none@b.c'), /log in again/);
  assert.deepEqual(await sec.summary('a@b.c'), { hasPassword: true, totp: false, recoveryLeft: 0, passkeys: [] });
  assert.equal(await sec.verifyMfa('a@b.c', '123456'), null);
  await assert.rejects(sec.confirmTotp('a@b.c', '1'), /expired/);
  const setup = await sec.startTotp('a@b.c');
  assert.match(setup.url, /^otpauth:/);
  const secret = setup.secret.replace(/ /g, '');
  const code = () => totpAt(secret, Math.floor(t / 30000));
  await assert.rejects(sec.confirmTotp('a@b.c', '000000x'), /not right/);
  const { recoveryCodes } = await sec.confirmTotp('a@b.c', code());
  assert.equal(recoveryCodes.length, 10);
  await assert.rejects(sec.startTotp('a@b.c'), /already on/);
  assert.equal(await sec.verifyMfa('a@b.c', code()), null);
  t += 60000;
  assert.deepEqual(await sec.verifyMfa('a@b.c', code()), { method: 'totp' });
  assert.equal(await sec.verifyMfa('a@b.c', 'aaaaa-aaaaa'), null);
  assert.deepEqual(await sec.verifyMfa('a@b.c', recoveryCodes[0].toUpperCase()), { method: 'recovery', left: 9 });
  assert.equal(await sec.verifyMfa('a@b.c', recoveryCodes[0]), null);
  await assert.rejects(sec.newRecoveryCodes('a@b.c', 'nope'), /not right/);
  assert.equal((await sec.newRecoveryCodes('a@b.c', recoveryCodes[1])).recoveryCodes.length, 10);
  await assert.rejects(sec.disableTotp('a@b.c', 'nope'), /not right/);
  t += 60000;
  assert.deepEqual(await sec.disableTotp('a@b.c', code()), { totp: false });

  const opts = await sec.passkeyRegistrationOptions('a@b.c');
  assert.ok(opts.challenge);
  await assert.rejects(sec.registerPasskey('a@b.c', { id: 'x', response: {} }), /could not be saved/);
  await assert.rejects(sec.registerPasskey('a@b.c', {}), /too long/);
  assert.equal(await sec.removePasskey('a@b.c', 'missing'), false);
  await assert.rejects(sec.removePasskey('p@b.c', 'k1'), /at least one way/);
  assert.ok((await sec.passkeyLoginOptions()).challenge);
  await assert.rejects(sec.verifyPasskeyLogin({}, 'c'), /not registered/);
  await store.put('passkeyIndex', { id: 'gone', email: 'p@b.c' });
  await assert.rejects(sec.verifyPasskeyLogin({ id: 'gone' }, 'c'), /was removed/);
  await store.put('passkeyIndex', { id: 'k1', email: 'p@b.c' });
  await assert.rejects(sec.verifyPasskeyLogin({ id: 'k1', rawId: 'k1', response: {}, type: 'public-key' }, 'c'), /could not be checked/);
  rows.set('p@b.c', { ...rows.get('p@b.c'), passwordHash: 'h' });
  assert.equal(await sec.removePasskey('p@b.c', 'k1'), true);
  assert.equal((await sec.summary('p@b.c')).passkeys.length, 0);
});
