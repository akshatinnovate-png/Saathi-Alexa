import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createDidis, upiLink, LESSONS } from '../src/didis/didis.js';
import { testServices, testConfig, fixedClock } from './helpers.js';

const ready = async (didis, input) => {
  const { didi, token } = await didis.signUp(input);
  let me = await didis.byToken(token);
  for (const l of LESSONS) await didis.answerLesson(me, l.id, l.answer);
  me = await didis.byToken(token);
  return { didi, token, me };
};
const sunita = { name: 'Sunita Pawar', phone: '+91 98220 11111', city: 'Pune', languages: ['mr', 'hi'], skills: ['escort', 'visit'], rates: { escort: 400, visit: 250 }, upiId: 'sunita@okaxis', partnerCode: 'SEWA-PUNE' };

test('a Didi signs up, is verified by a partner code and becomes ready only after all three lessons', async () => {
  const services = testServices();
  const didis = createDidis({ store: services.store, services, clock: fixedClock, partnerCodes: ['SEWA-PUNE', ' '] });
  await assert.rejects(didis.signUp({}), /name/);
  await assert.rejects(didis.signUp({ name: 'A', phone: '12' }), /mobile/);
  await assert.rejects(didis.signUp({ name: 'A', phone: '9822011111' }), /town/);
  await assert.rejects(didis.signUp({ name: 'A', phone: '9822011111', city: 'Pune' }), /at least one/);
  await assert.rejects(didis.signUp({ name: 'A', phone: '9822011111', city: 'Pune', skills: ['visit'] }), /fee/);
  await assert.rejects(didis.signUp({ ...sunita, upiId: 'nope' }), /UPI/);
  const { didi, token } = await didis.signUp(sunita);
  assert.equal(didi.verified, true);
  assert.equal(didi.ready, false);
  assert.match(token, /^didi_/);
  await assert.rejects(didis.signUp(sunita), /already/);
  const me = await didis.byToken(token);
  assert.equal(await didis.byToken('nope'), null);
  assert.equal(await didis.byToken(''), null);
  assert.deepEqual(await didis.offers(me), []);
  assert.equal((await didis.answerLesson(me, 'standing', 0)).correct, false);
  await assert.rejects(didis.answerLesson(me, 'nope', 0), /No such lesson/);
  let out;
  for (const l of LESSONS) out = await didis.answerLesson(await didis.byToken(token), l.id, l.answer);
  assert.equal(out.ready, true);
  assert.equal(didis.lessons('mr')[0].title, LESSONS[0].title.mr);
  assert.equal(didis.lessons('xx')[0].title, LESSONS[0].title.en);
  const unverified = await didis.signUp({ ...sunita, phone: '9822022222', partnerCode: 'WRONG' });
  assert.equal(unverified.didi.verified, false);
});

test('a family books a Didi; she accepts, gets a briefing, checks in and out; Aaji, the family and payment all follow', async () => {
  const services = testServices();
  const events = [];
  services.localBus.subscribe((e) => events.push(e));
  const didis = createDidis({ store: services.store, services, clock: fixedClock, partnerCodes: ['SEWA-PUNE'] });
  const { me } = await ready(didis, sunita);
  await ready(didis, { ...sunita, name: 'Asha', phone: '9822033333', city: 'Mumbai' });
  const found = await didis.search('default');
  assert.deepEqual(found.map((d) => d.name), ['Sunita Pawar']);

  await assert.rejects(didis.book('default', { kind: 'nope' }), /Choose what/);
  await assert.rejects(didis.book('default', { kind: 'escort', at: 'tomorrow' }), /date/);
  await assert.rejects(didis.book('default', { kind: 'refill', at: '2026-10-24T10:00', didiId: me.id }), /does not offer/);
  await assert.rejects(didis.book('default', { kind: 'escort', at: '2026-10-24T10:00', didiId: 'didi-none' }), /not available/);
  const appointmentId = (await services.saathi.careSetup()).appointments[0].id;
  const booked = await didis.book('default', { kind: 'escort', at: '2026-10-24T10:00', didiId: me.id, notes: 'She likes to sit by the window.', appointmentId }, 'riya');
  assert.equal(booked.status, 'offered');
  assert.equal(booked.fee, 400);
  const open = await didis.book('default', { kind: 'visit', at: '2026-10-25T16:00' }, 'riya');
  assert.equal(open.status, 'open');
  assert.equal(open.fee, null);

  const offers = await didis.offers(me);
  assert.deepEqual(offers.map((o) => o.id), [booked.id, open.id]);
  assert.equal(offers[1].fee, 250);
  await assert.rejects(didis.checkIn(me, booked.id), /accepted booking/);
  const accepted = await didis.accept(me, booked.id);
  assert.equal(accepted.status, 'accepted');
  await assert.rejects(didis.accept(me, booked.id), /no longer available/);
  const toAaji = (await services.saathi.messages()).filter((m) => m.to === 'elder' && m.system);
  assert.ok(toAaji.some((m) => /Sunita/.test(m.text)), 'Aaji is told who is coming');

  const brief = await didis.briefing(me, booked.id);
  assert.equal(brief.language, 'mr');
  assert.match(brief.facts.name, /Aaji|Kamala/);
  assert.ok(brief.facts.medicines.length > 0, 'medicines are shared by default');
  assert.equal(brief.facts.mood, undefined, 'mood is not shared unless the family says so');
  assert.ok(appointmentId && brief.facts.appointment, 'the doctor visit is in the briefing');
  assert.match(brief.text, /112|Emergency|आपत्कालीन|\d/);

  const stranger = (await ready(didis, { ...sunita, name: 'Other', phone: '9822044444' })).me;
  await assert.rejects(didis.briefing(stranger, booked.id), /not yours/);

  await assert.rejects(didis.checkOut(me, booked.id), /Check in/);
  const inside = await didis.checkIn(me, booked.id);
  assert.equal(inside.status, 'in-progress');
  assert.ok(events.some((e) => e['detail-type'] === 'DidiArrived'));
  await assert.rejects(didis.cancel('default', booked.id), /cannot be cancelled/);
  await assert.rejects(didis.rate('default', booked.id, { stars: 5 }), /after the visit/);
  await assert.rejects(didis.markPaid('default', booked.id), /after the visit/);
  const done = await didis.checkOut(me, booked.id, { note: 'Doctor said BP is fine. She ate lunch.', language: 'en' });
  assert.equal(done.status, 'done');
  assert.equal(done.note.english, 'Doctor said BP is fine. She ate lunch.');

  const listed = (await didis.bookings('default')).find((b) => b.id === booked.id);
  assert.equal(listed.payLink, upiLink({ upiId: 'sunita@okaxis', name: 'Sunita Pawar', amount: 400, note: 'Saathi Doctor escort' }));
  assert.match(listed.payLink, /^upi:\/\/pay\?pa=sunita%40okaxis&pn=Sunita\+Pawar&cu=INR&am=400&tn=/);
  const paid = await didis.markPaid('default', booked.id);
  assert.ok(paid.paidAt);
  assert.equal(paid.payLink, null);
  await assert.rejects(didis.rate('default', booked.id, { stars: 9 }), /1 to 5/);
  const rated = await didis.rate('default', booked.id, { stars: 5, review: 'Kind and on time.' });
  assert.equal(rated.rating, 5);
  await assert.rejects(didis.rate('default', booked.id, { stars: 4 }), /already rated/);
  await assert.rejects(didis.rate('other', booked.id, { stars: 4 }), /No such booking/);

  const fresh = await services.store.get('didis', me.id);
  const money = await didis.earnings(fresh, '2026-10');
  assert.deepEqual({ visits: money.visits, earned: money.earned, paid: money.paid, rating: money.rating }, { visits: 1, earned: 400, paid: 400, rating: 5 });
  assert.equal(money.byKind.escort, 1);
  assert.deepEqual(await didis.myBookings(fresh).then((l) => l.map((b) => b.id)), [booked.id]);
  assert.equal((await didis.search('default'))[0].rating, 5);

  const cancelled = await didis.cancel('default', open.id);
  assert.equal(cancelled.status, 'cancelled');
});

test('the briefing is rewritten by the model when one is set, and falls back when it fails', async () => {
  const services = testServices();
  let calls = 0;
  const llm = { create: async ({ messages }) => { calls += 1; if (calls > 1) throw new Error('down'); return { content: [{ type: 'text', text: `• ${messages[0].content.split('\n')[0]}` }] }; } };
  const didis = createDidis({ store: services.store, services, llm, clock: fixedClock, partnerCodes: ['SEWA-PUNE'] });
  const { me } = await ready(didis, { ...sunita, languages: ['en'] });
  const b = await didis.book('default', { kind: 'visit', at: '2026-10-24T10:00', share: { medicines: false, mood: true } });
  await didis.accept(me, b.id);
  const first = await didis.briefing(me, b.id);
  assert.match(first.text, /^• Company visit/);
  assert.equal(first.facts.medicines, undefined);
  const second = await didis.briefing(me, b.id);
  assert.match(second.text, /Emergency number/);
});

let server;
let base;
let cookie = '';

before(async () => {
  const services = testServices();
  const accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const didis = createDidis({ store: services.store, services, clock: fixedClock, partnerCodes: ['SEWA-PUNE'] });
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }), services, didis,
    accounts, sessions: createSessions('test-secret'), optionalVerifier: createHouseholdVerifier({ base: null, accounts }),
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'riya@saathi.demo', password: DEMO_PASSWORD }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => server?.close());

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), setCookie: res.headers.get('set-cookie') };
};

test('the Didi app and the family app talk to each other over HTTP', async () => {
  assert.equal((await call('GET', '/didi-api/me')).status, 401);
  assert.equal((await call('GET', '/api/didis')).status, 401);
  const lessons = await call('GET', '/didi-api/lessons?language=hi');
  assert.equal(lessons.body.lessons.length, 3);
  assert.equal((await call('POST', '/didi-api/signup', { name: 'x' })).status, 400);
  const signed = await call('POST', '/didi-api/signup', sunita);
  assert.equal(signed.status, 200);
  assert.match(signed.setCookie, /saathi_didi=.*HttpOnly.*SameSite=Strict/);
  const didi = { cookie: signed.setCookie.split(';')[0] };
  const key = signed.body.link.split('#key=')[1];
  assert.equal((await call('POST', '/didi-api/login', { key: 'bad' })).status, 401);
  const relogin = await call('POST', '/didi-api/login', { key });
  assert.equal(relogin.body.name, 'Sunita Pawar');
  assert.equal((await call('POST', '/didi-api/bookings/x/accept', null, didi)).status, 403);
  for (const l of LESSONS) await call('POST', `/didi-api/lessons/${l.id}`, { answer: l.answer }, didi);
  assert.equal((await call('GET', '/didi-api/me', null, didi)).body.ready, true);
  assert.equal((await call('POST', '/didi-api/signup', sunita, { origin: 'https://evil.example' })).status, 403);

  const fam = { cookie };
  const list = await call('GET', '/api/didis', null, fam);
  assert.equal(list.body.didis[0].name, 'Sunita Pawar');
  const booked = await call('POST', '/api/didis/bookings', { kind: 'escort', at: '2026-10-24T10:00', didiId: list.body.didis[0].id }, fam);
  assert.equal(booked.body.status, 'offered');
  assert.equal((await call('POST', '/api/didis/bookings', { kind: 'nope' }, fam)).status, 400);
  const offers = await call('GET', '/didi-api/offers', null, didi);
  assert.equal(offers.body.offers.length, 1);
  assert.equal((await call('POST', `/didi-api/bookings/${booked.body.id}/accept`, null, didi)).body.status, 'accepted');
  assert.match((await call('GET', `/didi-api/bookings/${booked.body.id}/briefing`, null, didi)).body.text, /\S/);
  assert.equal((await call('POST', `/didi-api/bookings/${booked.body.id}/check-in`, null, didi)).body.status, 'in-progress');
  assert.equal((await call('POST', `/didi-api/bookings/${booked.body.id}/check-out`, { note: 'All well.' }, didi)).body.status, 'done');
  assert.equal((await call('GET', '/didi-api/bookings', null, didi)).body.bookings.length, 1);
  const famList = await call('GET', '/api/didis/bookings', null, fam);
  assert.match(famList.body.bookings[0].payLink, /^upi:/);
  assert.ok((await call('POST', `/api/didis/bookings/${booked.body.id}/paid`, null, fam)).body.paidAt);
  assert.equal((await call('POST', `/api/didis/bookings/${booked.body.id}/rate`, { stars: 4 }, fam)).body.rating, 4);
  assert.equal((await call('POST', `/api/didis/bookings/${booked.body.id}/cancel`, null, fam)).status, 409);
  const money = await call('GET', `/didi-api/earnings?month=${fixedClock().toISOString().slice(0, 7)}`, null, didi);
  assert.equal(money.body.earned, 400);
  assert.equal((await call('POST', '/didi-api/logout', null, didi)).status, 200);
});

test('with Google Maps, families see ready Didis within 40 minutes, nearest first, and fall back to the city when Maps fails', async () => {
  const services = testServices();
  let down = false;
  const asked = [];
  const maps = { travelMinutes: async (origins, destination) => { asked.push({ origins, destination }); if (down) throw new Error('quota'); return origins.map((o) => ({ 'Kothrud, Pune': 12, 'Baner, Pune': 25, 'Thane, Mumbai': 180 })[o] ?? null); } };
  const didis = createDidis({ store: services.store, services, maps, clock: fixedClock, partnerCodes: ['SEWA-PUNE'] });
  await ready(didis, { ...sunita, area: 'Baner' });
  await ready(didis, { ...sunita, name: 'Asha', phone: '9822033333', area: 'Kothrud' });
  await ready(didis, { ...sunita, name: 'Far', phone: '9822055555', city: 'Mumbai', area: 'Thane' });
  const near = await didis.search('default');
  assert.deepEqual(near.map((d) => [d.name, d.minutesAway]), [['Asha', 12], ['Sunita Pawar', 25]]);
  assert.match(asked[0].destination, /Kothrud, Pune/);
  down = true;
  assert.deepEqual((await didis.search('default')).map((d) => d.name).sort(), ['Asha', 'Sunita Pawar']);
});
