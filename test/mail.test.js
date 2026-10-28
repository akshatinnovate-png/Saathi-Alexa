import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockClient } from 'aws-sdk-client-mock';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createGoogle, createVault } from '../src/accounts/google.js';
import { createMailer, rfc822 } from '../src/mail/mailer.js';
import { createFamilyMail } from '../src/mail/familyMail.js';
import { inviteEmail } from '../src/mail/templates.js';
import { testServices, testConfig } from './helpers.js';

const sent = [];
const fakeTransport = { kind: 'fake', from: 'care@saathi.test', async send(m) { sent.push(m); return `m-${sent.length}`; } };
const google = {
  authUrl: ({ redirectUri, state, gmail }) => `https://accounts.google.test/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&gmail=${gmail}`,
  identities: new Map(),
  async finish({ code }) {
    const identity = this.identities.get(code);
    if (!identity) throw new Error('bad code');
    return { identity, refreshToken: identity.refreshToken ?? null, scopes: identity.scopes ?? ['openid'] };
  },
  gmailSender: ({ email }) => ({ kind: 'gmail-api', from: email, async send(m) { sent.push({ ...m, via: 'gmail-api', from: email }); return 'g-1'; } }),
};

let server;
let base;
let services;

before(async () => {
  services = testServices();
  const mailer = createMailer({ transport: fakeTransport });
  const familyMail = createFamilyMail({ store: services.store, mailer, google, vault: createVault('test-secret'), publicUrl: 'https://saathi.test' });
  services.attachMail(familyMail);
  const accounts = createAccounts({ store: services.store, services, demo: true, onInvite: (i) => familyMail.sendInvite(i) });
  await accounts.ensureDemo();
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }),
    services, accounts, sessions: createSessions('test-secret'), google, familyMail,
    optionalVerifier: createHouseholdVerifier({ base: null, accounts }),
  });
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
    for (const set of res.headers.getSetCookie()) {
      const [pair] = set.split(';');
      const [name] = pair.split('=');
      cookie = [...cookie.split('; ').filter((c) => c && !c.startsWith(`${name}=`)), pair].join('; ');
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: res.status, json, text, location: res.headers.get('location') };
  };
  return { call };
}

async function riya() {
  const a = agent();
  await a.call('/auth/login', { method: 'POST', body: { email: 'riya@saathi.demo', password: DEMO_PASSWORD } });
  return a;
}

test('mail transports: SES, Gmail SMTP, and a printed outbox when nothing is set up', async () => {
  const ses = mockClient(SESv2Client);
  ses.on(SendEmailCommand).resolves({ MessageId: 'ses-1' });
  const viaSes = createMailer({ mail: { provider: 'ses', from: 'care@saathi.care' }, region: 'us-east-1', sesClient: new SESv2Client({}) });
  assert.equal(viaSes.kind, 'amazon-ses');
  const out = await viaSes.send({ to: 'kabir@family.test', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi', fromName: 'Riya via Saathi' });
  assert.deepEqual(out, { id: 'ses-1', kind: 'amazon-ses' });
  const input = ses.commandCalls(SendEmailCommand)[0].args[0].input;
  assert.equal(input.FromEmailAddress, '"Riya via Saathi" <care@saathi.care>');
  assert.deepEqual(input.Destination.ToAddresses, ['kabir@family.test']);
  assert.equal(input.Content.Simple.Body.Text.Data, 'Hi');
  ses.restore();

  assert.equal(createMailer({ mail: { gmailUser: 'riya@gmail.com', gmailAppPassword: 'abcd efgh ijkl mnop' } }).kind, 'gmail-smtp');

  const dir = await mkdtemp(join(tmpdir(), 'saathi-outbox-'));
  const lines = [];
  const outbox = createMailer({ outboxDir: dir, log: (l) => lines.push(l) });
  assert.equal(outbox.real, false);
  await outbox.send({ to: 'kabir@family.test', subject: 'Join', html: '<p>x</p>', text: 'Open https://saathi.test/join.html?invite=abc' });
  assert.match(lines[0], /Link: https:\/\/saathi\.test\/join\.html\?invite=abc/);
  assert.equal((await readdir(dir)).length, 1);
  assert.deepEqual(await outbox.send({ to: 'riya@saathi.demo', subject: 'x', html: 'x', text: 'x' }), { id: null, skipped: true, kind: 'skipped' });
});

test('emails are proper MIME with UTF-8 subjects, and invites speak the invitee\'s language', () => {
  const mail = inviteEmail({ inviter: 'Riya', elder: 'Aaji', link: 'https://saathi.test/join.html?invite=t', language: 'mr' });
  assert.match(mail.subject, /Saathi वर Aaji/);
  assert.match(mail.html, /lang="mr"/);
  assert.match(mail.text, /https:\/\/saathi\.test\/join\.html\?invite=t/);
  const raw = rfc822({ from: 'riya@gmail.com', to: 'kabir@family.test', ...mail });
  const subject = raw.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)[1];
  assert.equal(Buffer.from(subject, 'base64').toString('utf8'), mail.subject);
  assert.match(raw, /Content-Type: multipart\/alternative/);
});

test('Google: ID tokens are verified, and Gmail sends as the family member', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
  const idToken = (aud) => new SignJWT({ email: 'Kabir@Gmail.com', email_verified: true, name: 'Kabir' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer('https://accounts.google.com').setAudience(aud).setSubject('123').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const calls = [];
  let audience = 'client-1';
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('oauth2.googleapis.com/token')) {
      const params = new URLSearchParams(init.body);
      if (params.get('grant_type') === 'refresh_token') return Response.json({ access_token: 'access-2', expires_in: 3600 });
      return Response.json({ id_token: await idToken(audience), refresh_token: 'refresh-1', scope: 'openid email https://www.googleapis.com/auth/gmail.send' });
    }
    return Response.json({ id: 'gmail-1' });
  };
  const g = createGoogle({ clientId: 'client-1', clientSecret: 'secret', fetchImpl, jwks });
  const url = new URL(g.authUrl({ redirectUri: 'https://saathi.test/auth/google/callback', state: 's', challenge: 'c', gmail: true }));
  assert.match(url.searchParams.get('scope'), /gmail\.send/);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');

  const done = await g.finish({ code: 'c', verifier: 'v', redirectUri: 'https://saathi.test/auth/google/callback' });
  assert.deepEqual(done.identity, { email: 'kabir@gmail.com', name: 'Kabir', sub: 'google:123', picture: null });
  assert.equal(done.refreshToken, 'refresh-1');
  assert.equal(new URLSearchParams(calls[0].init.body).get('code_verifier'), 'v');

  audience = 'someone-else';
  await assert.rejects(g.finish({ code: 'c', verifier: 'v', redirectUri: 'x' }));

  const id = await g.gmailSender({ email: 'kabir@gmail.com', name: 'Kabir', refreshToken: 'refresh-1' }).send({ to: 'aaji@family.test', subject: 'नमस्ते', html: '<p>hi</p>', text: 'hi' });
  assert.equal(id, 'gmail-1');
  const send = calls.at(-1);
  assert.equal(send.init.headers.authorization, 'Bearer access-2');
  const raw = Buffer.from(JSON.parse(send.init.body).raw, 'base64url').toString('utf8');
  assert.match(raw, /^From: "Kabir" <kabir@gmail\.com>/m);
  assert.match(raw, /^To: aaji@family\.test/m);

  const vault = createVault('k');
  const sealed = vault.seal('refresh-1');
  assert.notEqual(sealed, 'refresh-1');
  assert.equal(vault.open(sealed), 'refresh-1');
  assert.throws(() => createVault('other').open(sealed));
});

test('invites: a real email with a one-time link that joins whoever opens it', async () => {
  const owner = await riya();
  const before = sent.length;
  const res = await owner.call('/api/household/invite', { method: 'POST', body: { name: 'Kabir', relationship: 'grandson', email: 'kabir@family.test', language: 'hi' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.invite.emailed, true);
  const mail = sent[before];
  assert.equal(mail.to, 'kabir@family.test');
  assert.equal(mail.fromName, 'Riya via Saathi');
  assert.match(mail.subject, /Riya ने आपको Saathi पर Aaji/);
  const link = mail.text.match(/https:\/\/saathi\.test\/join\.html\?invite=(\S+)/);
  assert.ok(link, 'the email carries the join link');
  assert.equal(res.json.invite.link, link[0]);
  const token = decodeURIComponent(link[1]);

  const again = await owner.call('/api/household/invite', { method: 'POST', body: { name: 'Kabir', relationship: 'grandson', email: 'Kabir@family.test' } });
  assert.equal(again.status, 400);
  assert.match(again.json.error, /already in the circle/);

  const kabir = agent();
  const preview = await kabir.call(`/api/invite/${encodeURIComponent(token)}`);
  assert.deepEqual([preview.json.elderName, preview.json.inviterName, preview.json.email, preview.json.google], ['Aaji', 'Riya', 'kabir@family.test', true]);
  const signup = await kabir.call('/auth/signup', { method: 'POST', body: { email: 'kabir.personal@family.test', password: 'grandson-visits-7', name: 'Kabir', invite: token } });
  assert.equal(signup.status, 200);
  assert.equal(signup.json.next, '/family.html');
  const status = (await kabir.call('/api/status')).json;
  assert.equal(status.elder.preferredName, 'Aaji');
  assert.equal(status.me.role, 'member');
  assert.equal(status.circle.find((p) => p.id === status.memberId).email, 'kabir.personal@family.test');
  assert.equal((await kabir.call(`/api/invite/${encodeURIComponent(token)}`)).status, 404, 'the link works once');
  assert.deepEqual((await owner.call('/api/household/invites')).json, []);
});

test('alerts email the right people, and Gmail sends them from the family\'s own address', async () => {
  const owner = await riya();
  await owner.call('/api/household/invite', { method: 'POST', body: { name: 'Sunita', relationship: 'neighbour', email: 'sunita@family.test', role: 'neighbour' } });
  sent.length = 0;
  await services.notifier.notify({ householdId: 'default', audience: 'family', severity: 'high', subject: 'Aaji asked for help', message: 'She said she fell.' });
  assert.deepEqual(sent.map((m) => m.to).sort(), ['kabir.personal@family.test']);
  assert.match(sent[0].subject, /^Urgent: Aaji asked for help/);
  assert.match(sent[0].text, /https:\/\/saathi\.test\/family\.html/);

  sent.length = 0;
  await services.notifier.notify({ householdId: 'default', audience: 'neighbour', severity: 'high', subject: 'Please check on Aaji', message: 'Nobody has answered.' });
  assert.deepEqual(sent.map((m) => m.to), ['sunita@family.test']);

  const start = await owner.call('/auth/google?gmail=1');
  assert.equal(start.status, 302);
  const state = new URL(start.location).searchParams.get('state');
  google.identities.set('gmail-code', { email: 'riya.sharma@gmail.com', name: 'Riya', sub: 'google:9', refreshToken: 'r-9', scopes: ['openid', 'https://www.googleapis.com/auth/gmail.send'] });
  const back = await owner.call(`/auth/google/callback?state=${state}&code=gmail-code`);
  assert.equal(back.location, '/family.html?gmail=connected');
  const mail = (await owner.call('/api/mail')).json;
  assert.equal(mail.gmail.email, 'riya.sharma@gmail.com');
  const stored = await services.store.get('mailConnections', 'default');
  assert.ok(!JSON.stringify(stored).includes('r-9'), 'the Gmail refresh token is stored encrypted');

  sent.length = 0;
  await services.notifier.notify({ householdId: 'default', audience: 'everyone', severity: 'info', subject: 'Aaji\'s week', message: 'A good week.' });
  assert.deepEqual(sent.map((m) => [m.to, m.via, m.from]).sort(), [['kabir.personal@family.test', 'gmail-api', 'riya.sharma@gmail.com'], ['sunita@family.test', 'gmail-api', 'riya.sharma@gmail.com']]);

  const anand = agent();
  await anand.call('/auth/login', { method: 'POST', body: { email: 'anand@saathi.demo', password: DEMO_PASSWORD } });
  assert.equal((await anand.call('/auth/google?gmail=1')).location, '/family.html?gmail=owner-only');
  assert.equal((await anand.call('/api/mail/gmail', { method: 'DELETE' })).status, 403);
  assert.equal((await owner.call('/api/mail/gmail', { method: 'DELETE' })).json.removed, true);
});

test('Sign in with Google: new people land in setup; invited people join their family', async () => {
  const a = agent();
  const start = await a.call('/auth/google?next=/family.html%23care');
  assert.match(start.location, /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fauth%2Fgoogle%2Fcallback/);
  google.identities.set('new-person', { email: 'meenal@gmail.test', name: 'Meenal', sub: 'google:1' });
  assert.equal((await a.call(`/auth/google/callback?state=wrong&code=new-person`)).location, '/login.html?error=social-failed');
  const again = await a.call('/auth/google');
  const callback = await a.call(`/auth/google/callback?state=${new URL(again.location).searchParams.get('state')}&code=new-person`);
  assert.equal(callback.location, '/welcome.html');
  assert.equal((await a.call('/api/session')).json.user.email, 'meenal@gmail.test');

  const owner = await riya();
  const invite = await owner.call('/api/household/invite', { method: 'POST', body: { name: 'Dev', relationship: 'nephew', email: 'dev@family.test' } });
  const token = new URL(invite.json.invite.link).searchParams.get('invite');
  const dev = agent();
  const go = await dev.call(`/auth/google?invite=${encodeURIComponent(token)}`);
  google.identities.set('dev-code', { email: 'dev.personal@gmail.test', name: 'Dev', sub: 'google:2' });
  const landed = await dev.call(`/auth/google/callback?state=${new URL(go.location).searchParams.get('state')}&code=dev-code`);
  assert.equal(landed.location, '/family.html');
  assert.equal((await dev.call('/api/status')).json.elder.preferredName, 'Aaji');
  const pw = await agent().call('/auth/login', { method: 'POST', body: { email: 'dev.personal@gmail.test', password: 'whatever-1' } });
  assert.match(pw.json.error, /signs in with Google/);
});

test('pairing Aaji\'s tablet: six digits, no passwords, and it only opens her screen', async () => {
  const owner = await riya();
  const { json: pairing } = await owner.call('/api/devices/pairing-code', { method: 'POST', body: {} });
  assert.match(pairing.code, /^\d{6}$/);
  assert.match(pairing.qr, /^<svg/);
  assert.match(pairing.url, /\/device\.html$/);

  const tablet = agent();
  assert.equal((await tablet.call('/auth/device', { method: 'POST', body: { code: '000000' === pairing.code ? '111111' : '000000' } })).status, 400);
  const asked = await tablet.call('/auth/device', { method: 'POST', body: { code: `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}` } });
  assert.equal(asked.status, 200);
  assert.equal(asked.json.status, 'pending');
  assert.equal(asked.json.emoji.length, 3);
  assert.equal((await agent().call('/auth/device', { method: 'POST', body: { code: pairing.code } })).status, 400, 'codes work once');
  assert.equal((await tablet.call('/auth/device/status')).json.status, 'pending');
  assert.equal((await tablet.call('/alexa.html')).status, 302, 'a correct code alone opens nothing');

  const requests = (await owner.call('/api/devices/requests')).json;
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].emoji, asked.json.emoji, 'the family sees the same three pictures as the tablet');
  assert.equal(requests[0].secretHash, undefined);
  assert.equal((await owner.call(`/api/devices/requests/${requests[0].id}`, { method: 'POST', body: { approve: true } })).json.status, 'approved');
  const paired = await tablet.call('/auth/device/status');
  assert.equal(paired.json.status, 'approved');
  assert.equal(paired.json.next, '/alexa.html');
  assert.equal(paired.json.device.label, "Aaji's Saathi");
  assert.equal((await tablet.call('/auth/device/status')).json.status, 'unknown', 'the approval can be collected only once');

  const { json: second } = await owner.call('/api/devices/pairing-code', { method: 'POST', body: {} });
  const stranger = agent();
  await stranger.call('/auth/device', { method: 'POST', body: { code: second.code } });
  const strangerRequest = (await owner.call('/api/devices/requests')).json[0];
  assert.equal((await owner.call(`/api/devices/requests/${strangerRequest.id}`, { method: 'POST', body: { approve: false } })).json.status, 'denied');
  assert.equal((await stranger.call('/auth/device/status')).json.status, 'denied');
  assert.equal((await stranger.call('/api/status')).status, 401, 'a refused device gets nothing');

  assert.equal((await tablet.call('/alexa.html')).status, 200);
  assert.equal((await tablet.call('/family.html')).location, '/alexa.html');
  const status = (await tablet.call('/api/status')).json;
  assert.equal(status.elder.preferredName, 'Aaji');
  assert.equal(status.device.label, "Aaji's Saathi");
  assert.equal(status.me, null);
  assert.equal((await tablet.call('/api/household/invite', { method: 'POST', body: { email: 'x@family.test', name: 'X', relationship: 'x' } })).status, 403);
  assert.equal((await tablet.call('/api/devices/pairing-code', { method: 'POST', body: {} })).status, 403);

  const devices = (await owner.call('/api/devices')).json;
  assert.equal(devices.length, 1);
  assert.equal((await owner.call(`/api/devices/${devices[0].id}`, { method: 'DELETE' })).json.removed, true);
  assert.equal((await tablet.call('/api/status')).status, 401, 'a removed device loses access at once');
  assert.match((await tablet.call('/alexa.html')).location, /^\/login\.html/);
});
