import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { testServices, testConfig } from './helpers.js';

let server;
let base;
let services;

before(async () => {
  services = testServices();
  const accounts = createAccounts({ store: services.store, services, demo: true });
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

async function login(email, password, signup) {
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
    return { status: res.status, json, text, type: res.headers.get('content-type'), location: res.headers.get('location') };
  };
  await call(signup ? '/auth/signup' : '/auth/login', { method: 'POST', body: { email, password, name: 'Test' } });
  return call;
}

test('the house map: six rooms with areas, devices and things she looks for', async () => {
  const call = await login('riya@saathi.demo', DEMO_PASSWORD);
  const map = (await call('/api/home')).json;
  assert.deepEqual(map.rooms.map((r) => r.id), ['living', 'kitchen', 'passage', 'bedroom', 'puja', 'bathroom']);
  assert.equal(map.rooms.find((r) => r.id === 'living').areaM2, 20);
  assert.equal(map.totalAreaM2, 65.3);
  assert.ok(map.items.some((i) => i.id === 'glasses' && i.roomId === 'bedroom'));
  assert.deepEqual(map.devices.map((d) => d.kind).sort(), ['alexa', 'ring']);
});

test('a phone walkaround replaces the rooms; bad shapes are refused with a plain reason', async () => {
  const call = await login('riya@saathi.demo', DEMO_PASSWORD);
  assert.equal((await call('/api/home/rooms', { method: 'PUT', body: { rooms: [] } })).status, 400);
  const twoCorners = await call('/api/home/rooms', { method: 'PUT', body: { rooms: [{ name: 'Hall', polygon: [[0, 0], [1, 1]] }] } });
  assert.equal(twoCorners.status, 400);
  assert.match(twoCorners.json.error, /three corners/);
  const huge = await call('/api/home/rooms', { method: 'PUT', body: { rooms: [{ name: 'Hall', polygon: [[0, 0], [500, 0], [0, 3]] }] } });
  assert.equal(huge.status, 400);

  const walked = await call('/api/home/rooms', { method: 'PUT', body: { source: 'webxr', rooms: [
    { name: 'Living room', type: 'living', polygon: [[0, 0], [4.123, 0], [4.123, 3.5], [0, 3.5]] },
    { name: 'Kitchen', type: 'kitchen', polygon: [[4.123, 0], [7, 0], [7, 3.5], [4.123, 3.5]] },
  ] } });
  assert.equal(walked.status, 200);
  assert.equal(walked.json.source, 'webxr');
  assert.deepEqual(walked.json.rooms.map((r) => r.id), ['living-room-1', 'kitchen-2']);
  assert.equal(walked.json.rooms[0].polygon[1][0], 4.12);
  assert.equal(walked.json.rooms[0].areaM2, 14.4);

  const placed = await call('/api/home/items', { method: 'POST', body: { name: 'walking stick', roomId: 'living-room-1', x: 1, z: 1, note: 'behind the door' } });
  assert.equal(placed.status, 200);
  const found = await services.forHousehold().whereIs('Where is my walking stick?', { language: 'en' });
  assert.equal(found.found, true);
  assert.equal(found.room, 'Living room');
  assert.match(found.say, /behind the door/);

  assert.equal((await call('/api/home/items', { method: 'POST', body: { name: 'umbrella', roomId: 'garage' } })).status, 400);
  assert.equal((await call(`/api/home/items/${placed.json.id}`, { method: 'DELETE' })).json.removed, true);
  assert.equal((await services.forHousehold().whereIs('walking stick')).found, false);
});

test('another household never sees this house', async () => {
  const call = await login('meera@example.com', 'another-house-1', true);
  const status = await call('/api/home');
  assert.equal(status.status, 401);
});

test('the walkaround page is behind login and three.js is served locally', async () => {
  const anon = await fetch(`${base}/scan.html`, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  const call = await login('riya@saathi.demo', DEMO_PASSWORD);
  const page = await call('/scan.html');
  assert.equal(page.status, 200);
  assert.match(page.text, /immersive|Walk around the house/);
  const three = await call('/vendor/three/build/three.module.js');
  assert.equal(three.status, 200);
  assert.match(three.type, /javascript/);
});
