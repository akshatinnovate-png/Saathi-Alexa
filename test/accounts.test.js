import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mockClient } from 'aws-sdk-client-mock';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createCognitoAccounts } from '../src/accounts/cognito.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier, cognitoIssuer } from '../src/auth/verifier.js';
import { testServices, testConfig } from './helpers.js';

let server;
let base;
let services;
let accounts;

before(async () => {
  services = testServices();
  accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }),
    services, accounts, sessions: createSessions('test-secret'),
    optionalVerifier: createHouseholdVerifier({ base: null, accounts }),
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function agent() {
  let cookie = '';
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: res.status, json, location: res.headers.get('location') };
  };
  return { call, get cookie() { return cookie; } };
}

const onboardingForm = {
  elder: { name: 'Shanta Kulkarni', preferredName: 'Aai', language: 'hi', city: 'Nagpur', home: 'Dharampeth, Nagpur', memorySupport: true },
  owner: { name: 'Priya', relationship: 'daughter', language: 'en', city: 'London', timezone: 'Europe/London' },
  neighbour: { name: 'Sunita', language: 'mr', email: 'sunita@example.com' },
  medications: [{ name: 'Metformin 500 mg', purpose: 'diabetes', time: '08:30', description: 'white oval tablet', withFood: true, remaining: 20 }],
};

test('pages are protected: no session means the login page', async () => {
  const a = agent();
  const page = await a.call('/family.html');
  assert.equal(page.status, 302);
  assert.equal(page.location, '/login.html?next=%2Ffamily.html');
  assert.equal((await a.call('/api/status')).status, 401);
  assert.equal((await a.call('/api/session')).json.user, null);
});

test('demo account logs in to the demo household; wrong passwords are refused', async () => {
  const a = agent();
  assert.equal((await a.call('/auth/login', { method: 'POST', body: { email: 'riya@saathi.demo', password: 'nope' } })).status, 400);
  const ok = await a.call('/auth/login', { method: 'POST', body: { email: 'Riya@Saathi.demo', password: DEMO_PASSWORD } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.next, '/family.html');
  const status = await a.call('/api/status');
  assert.equal(status.json.elder.preferredName, 'Aaji');
  assert.equal(status.json.memberId, 'riya');
  await a.call('/auth/logout', { method: 'POST' });
  assert.equal((await a.call('/api/status')).status, 401);
});

test('a new family signs up, sets up their household, and never sees anyone else\'s data', async () => {
  const a = agent();
  const weak = await a.call('/auth/signup', { method: 'POST', body: { email: 'priya@example.com', password: 'short', name: 'Priya' } });
  assert.equal(weak.status, 400);
  const signup = await a.call('/auth/signup', { method: 'POST', body: { email: 'priya@example.com', password: 'correct-horse-42', name: 'Priya' } });
  assert.equal(signup.status, 200);
  assert.equal(signup.json.next, '/welcome.html');
  assert.equal((await a.call('/family.html')).location, '/welcome.html');
  assert.match((await a.call('/api/status')).json.error, /Set up your household/);

  const bad = await a.call('/api/onboarding', { method: 'POST', body: { elder: {}, owner: {} } });
  assert.equal(bad.status, 400);
  const made = await a.call('/api/onboarding', { method: 'POST', body: onboardingForm });
  assert.equal(made.status, 200);
  assert.match(made.json.user.householdId, /^h-[0-9a-f]{12}$/);

  const status = (await a.call('/api/status')).json;
  assert.equal(status.elder.name, 'Shanta Kulkarni');
  assert.deepEqual(status.circle.map((p) => p.name).sort(), ['Priya', 'Sunita']);
  assert.equal(status.memberId, 'priya');

  await a.call('/api/family/message', { method: 'POST', body: { text: 'Hello Aai' } });
  const demo = agent();
  await demo.call('/auth/login', { method: 'POST', body: { email: 'riya@saathi.demo', password: DEMO_PASSWORD } });
  const demoMessages = (await demo.call('/api/family/messages')).json;
  assert.ok(!demoMessages.some((m) => m.text === 'Hello Aai'), 'the demo household cannot see Priya\'s messages');
  const priyaMessages = (await a.call('/api/family/messages')).json;
  assert.ok(priyaMessages.some((m) => m.text === 'Hello Aai'));
  assert.ok(!priyaMessages.some((m) => m.id === 'msg-seed-1'));

  assert.equal((await a.call('/api/demo/reset', { method: 'POST' })).status, 403, 'a real household cannot be wiped by the demo reset');

  const meds = (await a.call('/api/family/summary')).json.medications;
  assert.deepEqual(meds.map((m) => [m.name, m.time, m.daysLeft]), [['Metformin 500 mg', '08:30', 20]]);
});

test('invites: the neighbour joins the right household when she signs up', async () => {
  const sunita = agent();
  const signup = await sunita.call('/auth/signup', { method: 'POST', body: { email: 'sunita@example.com', password: 'neighbour-2026', name: 'Sunita' } });
  assert.equal(signup.json.next, '/family.html');
  const status = (await sunita.call('/api/status')).json;
  assert.equal(status.elder.name, 'Shanta Kulkarni');
  assert.equal(status.memberId, 'sunita');
  assert.equal((await sunita.call('/api/household/invite', { method: 'POST', body: { email: 'x@example.com', name: 'X', relationship: 'cousin' } })).status, 403);
});

test('a paired Alexa+ device token reaches only its own household over MCP', async () => {
  const a = agent();
  await a.call('/auth/login', { method: 'POST', body: { email: 'priya@example.com', password: 'correct-horse-42' } });
  const { token, mcpUrl } = (await a.call('/api/household/device-token', { method: 'POST', body: { label: "Aai's Echo" } })).json;
  assert.match(token, /^sth_/);
  assert.equal(mcpUrl, `${base}/mcp`);

  const client = new Client({ name: 'echo', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const profile = JSON.parse((await client.readResource({ uri: 'saathi://elder/profile' })).contents[0].text);
  assert.equal(profile.preferredName, 'Aai');
  const meds = await client.callTool({ name: 'get_medication_schedule', arguments: { language: 'en' } });
  assert.match(meds.content[0].text, /Metformin|diabetes|all caught up/);
  await client.close();

  const forged = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer sth_forged' }, body: '{}' });
  assert.equal(forged.status, 401);
});

test('sessions cannot be forged or edited', async () => {
  const forged = createSessions('someone-elses-secret').issue({ email: 'riya@saathi.demo' });
  const res = await fetch(`${base}/api/status`, { headers: { cookie: `saathi_session=${forged}` } });
  assert.equal(res.status, 401);
  const real = createSessions('test-secret').issue({ email: 'riya@saathi.demo' });
  const [payload, mac] = real.split('.');
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), email: 'priya@example.com' })).toString('base64url');
  assert.equal((await fetch(`${base}/api/status`, { headers: { cookie: `saathi_session=${edited}.${mac}` } })).status, 401);
});

test('login attempts are rate limited', async () => {
  const a = agent();
  let last;
  for (let i = 0; i < 10; i++) last = await a.call('/auth/login', { method: 'POST', body: { email: 'anand@saathi.demo', password: 'wrong' } });
  assert.equal(last.status, 429);
});

test('Amazon Cognito: sign-up asks for the emailed code; login verifies the ID token', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256' };
  const cfg = { region: 'us-east-1', userPoolId: 'us-east-1_POOL', clientId: 'web-client' };
  const idToken = await new SignJWT({ token_use: 'id', email: 'meena@example.com', email_verified: true, name: 'Meena' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuer(cognitoIssuer(cfg)).setAudience('web-client').setSubject('sub-123').setExpirationTime('1h').sign(privateKey);
  const idp = mockClient(CognitoIdentityProviderClient);
  idp.on(SignUpCommand).resolves({ UserConfirmed: false });
  idp.on(InitiateAuthCommand).resolves({ AuthenticationResult: { IdToken: idToken } });
  const cognito = createCognitoAccounts({ ...cfg, domain: 'saathi', publicUrl: 'https://saathi.example', client: new CognitoIdentityProviderClient({ region: 'us-east-1' }), jwks: createLocalJWKSet({ keys: [jwk] }) });
  const s = testServices();
  const acc = createAccounts({ store: s.store, services: s, cognito, demo: false });

  assert.deepEqual(await acc.signUp({ email: 'Meena@Example.com', password: 'long-enough-1', name: 'Meena' }), { confirm: true });
  assert.equal(idp.commandCalls(SignUpCommand)[0].args[0].input.Username, 'meena@example.com');
  const user = await acc.login({ email: 'meena@example.com', password: 'long-enough-1' });
  assert.deepEqual([user.email, user.name, user.provider, user.householdId], ['meena@example.com', 'Meena', 'cognito', null]);
  assert.equal((await acc.bySub('sub-123')).email, 'meena@example.com');

  const start = cognito.socialStart('Google');
  const url = new URL(start.url);
  assert.equal(url.hostname, 'saathi.auth.us-east-1.amazoncognito.com');
  assert.equal(url.searchParams.get('identity_provider'), 'Google');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  idp.restore();
});
