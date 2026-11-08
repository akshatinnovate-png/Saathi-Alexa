import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createScan, checkMedicines } from '../src/features/scan.js';
import { createDoctorNotes, cleanNote } from '../src/features/doctorNotes.js';
import { createHaq, benefitsFor } from '../src/features/haq.js';
import { createSangat, localClock } from '../src/features/sangat.js';
import { createRaksha } from '../src/features/raksha.js';
import { createDidis, LESSONS } from '../src/didis/didis.js';
import { imageInput, audioInput, timesFrom, needsModel } from '../src/features/media.js';
import { testServices, testConfig, fixedClock } from './helpers.js';

const llmReturning = (...answers) => {
  const seen = [];
  return { seen, understand: async (req) => { seen.push(req); const a = answers.length > 1 ? answers.shift() : answers[0]; return typeof a === 'function' ? a(req) : a; } };
};
const jpeg = Buffer.from('fake-jpeg-bytes');

test('media helpers check photos, recordings and times', () => {
  assert.deepEqual(imageInput(jpeg, 'image/jpeg; q=1'), { mimeType: 'image/jpeg', data: jpeg.toString('base64') });
  assert.throws(() => imageInput(jpeg, 'application/pdf'), /photo/);
  assert.throws(() => imageInput(Buffer.alloc(0), 'image/png'), /empty/);
  assert.throws(() => imageInput(Buffer.alloc(10), 'image/png', { maxBytes: 5 }), /too large/);
  assert.equal(audioInput(Buffer.from('x'), 'audio/webm;codecs=opus').mimeType, 'audio/webm');
  assert.throws(() => audioInput(Buffer.from('x'), 'video/mp4'), /not supported/);
  assert.throws(() => audioInput(Buffer.alloc(0), 'audio/ogg'), /empty/);
  assert.throws(() => audioInput(Buffer.alloc(10), 'audio/ogg', { maxBytes: 5 }), /too long/);
  assert.deepEqual(timesFrom(['night', 'morning', '13:30', 'soon', 'morning']), ['08:00', '13:30', '21:00']);
  assert.deepEqual(timesFrom('afternoon'), ['14:00']);
  assert.throws(() => needsModel(null, 'X'), (e) => e.status === 503 && /X needs an AI model/.test(e.message));
});

test('Saathi Scan reads a prescription, warns about duplicates and risky pairs, and adds what the family confirms', async () => {
  const services = testServices();
  const llm = llmReturning({
    kind: 'prescription', doctor: 'Dr. Mehta',
    medicines: [
      { name: 'Amlong 5', generic: 'Amlodipine', strength: '5 mg', form: 'tablet', times: ['morning'], withFood: 'after', purpose: 'blood pressure', confidence: 0.9 },
      { name: 'Ecosprin', generic: 'aspirin', strength: '75 mg', times: ['night'], withFood: 'after', purpose: 'heart', confidence: 0.8 },
      { name: 'Warf', generic: 'warfarin', strength: '2 mg', times: [], withFood: 'any', confidence: 0.6 },
      { name: '', generic: 'nothing' },
    ],
  });
  const scan = createScan({ llm, services });
  const out = await scan.read('default', { image: jpeg, contentType: 'image/jpeg' });
  assert.equal(llm.seen[0].media[0].mimeType, 'image/jpeg');
  assert.deepEqual(out.medicines.map((m) => m.name), ['Amlong 5', 'Ecosprin', 'Warf']);
  assert.deepEqual(out.medicines[2].times, ['08:00']);
  assert.equal(out.medicines[2].timesGuessed, true);
  assert.equal(out.medicines[0].withFood, true);
  assert.ok(out.checks.some((c) => c.kind === 'duplicate' && /Amlong 5/.test(c.text)), 'Amlodipine is already in the demo family');
  assert.ok(out.checks.some((c) => c.kind === 'interaction' && /bleeding/.test(c.text)));
  const saved = await scan.confirm('default', [{ ...out.medicines[1], times: ['21:00'] }]);
  assert.equal(saved.saved, 1);
  const meds = (await services.saathi.careSetup()).medications;
  const added = meds.find((m) => m.name === 'Ecosprin 75 mg');
  assert.equal(added.generic, 'aspirin');
  assert.deepEqual(added.times, ['21:00']);
  await assert.rejects(scan.confirm('default', []), /at least one/);
  await assert.rejects(createScan({ llm: llmReturning(null), services }).read('default', { image: jpeg, contentType: 'image/png' }), (e) => e.status === 422);
  await assert.rejects(createScan({ llm: null, services }).read('default', { image: jpeg, contentType: 'image/png' }), (e) => e.status === 503);
  assert.deepEqual(checkMedicines([{ name: 'Brufen', generic: 'ibuprofen' }], [{ name: 'Voveran', generic: 'diclofenac' }]).map((c) => c.kind), ['interaction']);
  assert.deepEqual(checkMedicines([{ name: 'Glycomet', generic: 'metformin' }], []), []);
});

test('Doctor Notes need consent, summarise the visit, tell the family and apply only what is confirmed', async () => {
  const services = testServices();
  const notes = [];
  services.localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && notes.push(e.detail));
  const llm = llmReturning({
    summary: 'Her blood pressure is a little high. The doctor added a new tablet and wants a sugar test.', plain: 'Blood pressure is slightly high.', doctor: 'Dr. Kulkarni',
    medicineChanges: [{ action: 'start', name: 'Telma', generic: 'Telmisartan', dose: '40 mg', times: ['morning'], withFood: false, reason: 'blood pressure' }, { action: 'stop', name: 'Calcium' }, { action: 'weird', name: 'Something' }, { name: '' }],
    tests: ['HbA1c'], nextVisit: { when: 'in 4 weeks', with: 'Dr. Kulkarni', why: 'review BP' }, warnings: ['Dizziness when standing'], questions: ['Is the new tablet safe with amlodipine?'],
  });
  const translator = { translate: async (text, { to }) => ({ text: `[${to}] ${text}` }) };
  const dn = createDoctorNotes({ llm, services, translator, clock: fixedClock });
  await assert.rejects(dn.record('default', { audio: Buffer.from('x'), contentType: 'audio/webm', consent: false }), /Ask the doctor first/);
  const note = await dn.record('default', { audio: Buffer.from('opus'), contentType: 'audio/webm', consent: true, by: 'Sunita' });
  assert.equal(llm.seen[0].media[0].mimeType, 'audio/webm');
  assert.equal(note.medicineChanges.length, 3);
  assert.equal(note.medicineChanges[2].action, 'continue');
  assert.equal(note.translations.mr.summary.startsWith('[mr]'), true);
  assert.ok(notes.some((n) => /What the doctor said about Aaji/.test(n.subject) && /Sunita recorded/.test(n.message)));
  const toAaji = (await services.saathi.messages()).find((m) => m.to === 'elder' && /doctor/.test(m.text));
  assert.ok(toAaji, 'Aaji hears it in her language');
  const calcium = (await services.saathi.careSetup()).medications.find((m) => /Calcium/.test(m.name));
  const done = await dn.apply('default', note.id, { start: [note.medicineChanges[0]], stop: [calcium.id], appointment: { at: '2026-11-20T10:00' } });
  assert.equal(done.started.length, 1);
  assert.deepEqual(done.stopped, [calcium.id]);
  assert.ok(done.appointment);
  const meds = (await services.saathi.careSetup()).medications;
  assert.ok(meds.some((m) => m.name === 'Telma 40 mg' && m.generic === 'telmisartan'));
  assert.ok(!meds.some((m) => m.id === calcium.id));
  await assert.rejects(dn.apply('default', note.id, {}), /already applied/);
  await assert.rejects(dn.apply('default', 'nope', {}), /No such note/);
  assert.equal((await dn.list('default'))[0].status, 'applied');
  await assert.rejects(createDoctorNotes({ llm: llmReturning({ summary: '' }), services }).record('default', { audio: Buffer.from('x'), contentType: 'audio/ogg', consent: true }), (e) => e.status === 422);
  assert.equal(cleanNote({}).nextVisit, null);
});

test('Saathi Haq knows the life-certificate window, Ayushman for 70+, pensions, and explains letters', async () => {
  const nov = new Date('2026-11-10T06:00:00Z');
  const sept = new Date('2026-09-10T06:00:00Z');
  const dec = new Date('2026-12-05T06:00:00Z');
  const base = { pensioner: true, birthYear: 1947, ayushmanCard: false, bplCard: true, state: 'Maharashtra' };
  const ids = (list) => list.map((b) => `${b.id}:${b.status}`);
  assert.deepEqual(ids(benefitsFor(base, nov)), ['life-certificate:due', 'ayushman-vay-vandana:eligible', 'old-age-pension:check', 'shravanbal:check']);
  assert.equal(benefitsFor(base, sept)[0].status, 'upcoming');
  assert.equal(benefitsFor({ ...base, birthYear: 1944 }, new Date('2026-10-05T06:00:00Z'))[0].status, 'due', '80+ can submit from October');
  assert.equal(benefitsFor(base, dec)[0].status, 'late');
  assert.equal(benefitsFor({ ...base, lifeCertificateYear: 2026 }, nov)[0].status, 'done');
  assert.equal(benefitsFor({ ...base, ayushmanCard: true }, nov)[1].status, 'done');
  assert.deepEqual(ids(benefitsFor({}, nov)), ['tell-us:check']);
  assert.deepEqual(benefitsFor(base, nov, 'CA'), []);

  const services = testServices();
  await services.saathi.updateProfile({ haq: { ...base, pensionFrom: 'central', birthYear: 3000, lifeCertificateYear: 1990 } });
  assert.equal((await services.saathi.elder()).haq.birthYear, null);
  await services.saathi.updateProfile({ haq: base });
  const notes = [];
  services.localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && notes.push(e.detail));
  let now = nov;
  const llm = llmReturning(
    { title: 'Electricity bill', plain: 'This is your electricity bill for October.', whatToDo: ['Pay by 20 November.'], deadline: '20 November', money: '₹640', scamRisk: 'none', scamSigns: [] },
    { title: 'Urgent: power cut tonight', plain: 'A message says your power will be cut tonight unless you pay now.', whatToDo: [], scamRisk: 'likely', scamSigns: ['Threat of disconnection', 'Asks to pay a personal UPI ID'] },
  );
  const haq = createHaq({ llm, services, translator: { translate: async (t) => ({ text: `मराठी: ${t}` }) }, clock: () => now });
  const view = await haq.view('default');
  assert.equal(view.benefits[0].status, 'due');
  const bill = await haq.explain('default', { image: jpeg, contentType: 'image/jpeg' });
  assert.equal(bill.scamRisk, 'none');
  assert.match(bill.forElder.text, /^मराठी: This is your electricity bill/);
  const scam = await haq.explain('default', { image: jpeg, contentType: 'image/jpeg' });
  assert.match(scam.forElder.text, /looks like a scam/);
  assert.ok((await services.saathi.scamIncidents()).length >= 1, 'a likely scam becomes a Scam Guard incident');
  assert.equal(await haq.sweep('default'), 'due');
  assert.ok(notes.some((n) => /life certificate is due/.test(n.subject)));
  assert.equal(await haq.sweep('default'), null, 'reminded at most once a week');
  now = new Date(nov.getTime() + 8 * 24 * 3600 * 1000);
  assert.equal(await haq.sweep('default'), 'due');
  await services.saathi.updateProfile({ haq: { ...base, lifeCertificateYear: 2026 } });
  assert.equal(await haq.sweep('default'), null);
  await assert.rejects(createHaq({ llm: llmReturning({}), services }).explain('default', { image: jpeg, contentType: 'image/png' }), (e) => e.status === 422);
});

test('Saathi Sangat: a ready Didi hosts a circle, families join and pay, elders get reminded and join', async () => {
  const services = testServices();
  let now = new Date('2026-11-09T11:22:00Z');
  const didis = createDidis({ store: services.store, services, clock: () => now, partnerCodes: ['SEWA-PUNE'] });
  const { token } = await didis.signUp({ name: 'Sunita Pawar', phone: '9822011111', city: 'Pune', languages: ['mr'], skills: ['visit'], rates: { visit: 250 }, upiId: 'sunita@okaxis', partnerCode: 'SEWA-PUNE' });
  const sangat = createSangat({ store: services.store, services, clock: () => now, llm: llmReturning({ topic: 'आवडती गाणी', questions: ['a', 'b', 'c', 'd'] }) });
  await assert.rejects(sangat.create(await didis.byToken(token), {}), /Finish verification/);
  for (const l of LESSONS) await didis.answerLesson(await didis.byToken(token), l.id, l.answer);
  const me = await didis.byToken(token);
  await assert.rejects(sangat.create(me, { time: '5pm' }), /time/);
  await assert.rejects(sangat.create(me, { time: '17:00', meetLink: 'https://zoom.us/j/1' }), /Google Meet/);
  const c = await sangat.create(me, { title: 'Chai and songs', time: '17:00', meetLink: 'https://meet.google.com/abc-defg-hij', fee: 300, maxMembers: 3 });
  assert.deepEqual([c.language, c.city, c.seats, c.fee], ['mr', 'Pune', 3, 300]);
  assert.deepEqual(await sangat.topic(me, c.id), { topic: 'आवडती गाणी', questions: ['a', 'b', 'c'] });
  assert.equal((await createSangat({ store: services.store, services, clock: () => now }).topic(me, c.id)).questions.length, 0);

  const near = await sangat.near('default');
  assert.equal(near[0].meetLink, null, 'the link is only for members');
  const joined = await sangat.join('default', c.id);
  assert.equal(joined.joined, true);
  assert.match(joined.payLink, /^upi:\/\/pay\?pa=sunita%40okaxis.*am=300/);
  assert.equal((await sangat.join('default', c.id)).members, 1, 'joining twice is harmless');
  const paid = await sangat.paid('default', c.id);
  assert.equal(paid.paidThisMonth, true);
  assert.equal(paid.payLink, null);
  assert.deepEqual((await sangat.hosted(me)).monthly, 300);

  const events = [];
  services.localBus.subscribe((e) => events.push(e));
  assert.equal(await sangat.sweep(), 1, '10 minutes before 17:00 IST');
  assert.ok(events.some((e) => e['detail-type'] === 'SangatReminder'));
  assert.equal(await sangat.sweep(), 0, 'reminded once a day');
  const today = await sangat.today('default');
  assert.equal(today[0].now, true);
  assert.equal((await sangat.attend('default', c.id)).meetLink, 'https://meet.google.com/abc-defg-hij');
  await sangat.attend('default', c.id);
  assert.equal(events.filter((e) => e['detail-type'] === 'NotificationSent' && /joined today's chai circle/.test(e.detail.subject)).length, 2, 'Riya and Anand are told once each, not twice');

  await assert.rejects(sangat.update(me, c.id, { time: 'x' }), /time/);
  await assert.rejects(sangat.update(me, c.id, { meetLink: 'x' }), /Google Meet/);
  assert.equal((await sangat.update(me, c.id, { time: '18:00', active: false })).active, false);
  await assert.rejects(sangat.join('default', c.id), /paused/);
  await sangat.update(me, c.id, { active: true });
  await sangat.leave('default', c.id);
  await assert.rejects(sangat.attend('default', c.id), /Join the circle/);
  await assert.rejects(sangat.paid('default', c.id), /Join the circle/);
  await assert.rejects(sangat.join('default', 'nope'), /No such circle/);
  const other = (await didis.signUp({ name: 'Asha', phone: '9822033333', city: 'Pune', skills: ['visit'], rates: { visit: 1 } })).didi;
  await assert.rejects(sangat.update({ ...other, id: other.id }, c.id, {}), /not yours/);
  now = new Date('2026-11-09T18:30:00Z');
  assert.deepEqual(localClock(now), { date: '2026-11-10', time: '00:00', day: 2 });
});

test('Saathi Raksha asks first, stands down when she is fine, and escalates with her location when she is not', async () => {
  const services = testServices();
  const events = [];
  services.localBus.subscribe((e) => events.push(e));
  const timers = [];
  let now = fixedClock();
  const raksha = createRaksha({ services, clock: () => now, setTimer: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; } });
  await assert.rejects(raksha.check('default', { kind: 'fall' }), /switched off/);
  await services.saathi.updateProfile({ raksha: { enabled: true, stillness: false, stillHours: 99, from: 'x' } });
  assert.deepEqual(await raksha.settings('default'), { enabled: true, stillness: false, stillHours: 8, from: '08:00', to: '20:00' });
  await assert.rejects(raksha.check('default', { kind: 'still' }), /Stillness checks/);
  await assert.rejects(raksha.check('default', { kind: 'nap' }), /Unknown/);

  const first = await raksha.check('default', { kind: 'fall', lat: 18.50745, lng: 73.80765, accuracy: 12.4 });
  assert.equal(first.seconds, 45);
  assert.equal(timers[0].ms, 45000);
  const ask = events.find((e) => e['detail-type'] === 'RakshaCheck');
  assert.equal(ask.detail.checkId, first.id);
  assert.equal((await raksha.check('default', { kind: 'fall' })).duplicate, true);
  assert.deepEqual(await raksha.answer('default', first.id, { fine: true }), { status: 'fine' });
  await timers[0].fn();
  assert.ok(!events.some((e) => e['detail-type'] === 'HelpRequested'), 'no alarm when she said she was fine');

  const second = await raksha.check('default', { kind: 'fall', lat: 18.5, lng: 73.8 });
  now = new Date(now.getTime() + 46000);
  assert.equal(await raksha.sweep('default'), 1);
  const help = events.find((e) => e['detail-type'] === 'HelpRequested');
  assert.match(help.detail.escalation.familyMessage, /possible fall/);
  assert.match(help.detail.escalation.familyMessage, /google\.com\/maps\/search\/\?api=1&query=18\.5,73\.8/);
  assert.equal((await raksha.answer('default', second.id, { fine: true })).status, 'escalated');
  assert.equal((await raksha.recent('default')).find((r) => r.id === second.id).status, 'escalated');
  await assert.rejects(raksha.answer('default', 'nope', {}), /No such check/);

  const s2 = testServices();
  await s2.saathi.updateProfile({ raksha: { enabled: true, stillness: true } });
  const r2 = createRaksha({ services: s2, setTimer: () => null });
  const still = await r2.check('default', { kind: 'still', lat: 'x' });
  const out = await r2.answer('default', still.id, { fine: false, location: { lat: 1, lng: 2 } });
  assert.equal(out.status, 'escalated');
});

let server;
let base;
let services;
let cookie = '';

before(async () => {
  services = testServices();
  const llm = llmReturning((req) => (req.media?.[0]?.mimeType?.startsWith('audio') ? { summary: 'All is well.', medicineChanges: [] } : { kind: 'strip', medicines: [{ name: 'Glycomet', generic: 'metformin', times: ['morning'] }], plain: 'A bill.', scamRisk: 'none' }));
  const accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }), services,
    accounts, sessions: createSessions('test-secret'), optionalVerifier: createHouseholdVerifier({ base: null, accounts }),
    scan: createScan({ llm, services }), doctorNotes: createDoctorNotes({ llm, services }), haq: createHaq({ llm, services }),
    sangat: createSangat({ store: services.store, services }), raksha: createRaksha({ services, setTimer: () => null }),
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'riya@saathi.demo', password: DEMO_PASSWORD }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => server?.close());

const call = async (method, path, body, type = 'application/json') => {
  const res = await fetch(`${base}${path}`, { method, headers: { cookie, ...(body ? { 'content-type': type } : {}) }, body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('over HTTP: photos and recordings go up as raw bytes, and every feature answers', async () => {
  const scanned = await call('POST', '/api/scan', jpeg, 'image/jpeg');
  assert.equal(scanned.body.medicines[0].name, 'Glycomet');
  assert.equal((await call('POST', '/api/scan', Buffer.from('%PDF'), 'application/pdf')).status, 400);
  assert.equal((await call('GET', '/api/doctor-notes')).body.notes.length, 0);
  assert.equal((await call('GET', '/api/haq')).status, 200);
  assert.equal((await call('GET', '/api/sangat')).body.circles.length, 0);
  assert.equal((await call('GET', '/api/sangat/today')).body.circles.length, 0);
  assert.equal((await call('GET', '/api/raksha')).body.settings.enabled, false);
  assert.equal((await call('POST', '/api/raksha/check', { kind: 'fall' })).status, 409);
  assert.equal((await call('PUT', '/api/raksha', { enabled: true })).body.settings.enabled, true);
  const check = await call('POST', '/api/raksha/check', { kind: 'fall' });
  assert.equal((await call('POST', `/api/raksha/${check.body.id}/answer`, { fine: true })).body.status, 'fine');
  assert.equal((await call('PUT', '/api/haq', { pensioner: true, birthYear: 1950 })).body.benefits[0].id, 'life-certificate');
  assert.equal((await call('POST', '/api/haq/explain', jpeg, 'image/png')).body.plain, 'A bill.');
  assert.equal((await call('POST', '/api/doctor-notes', Buffer.from('opus'), 'audio/webm')).status, 400, 'needs consent');
  const note = await call('POST', '/api/doctor-notes?consent=yes', Buffer.from('opus'), 'audio/webm');
  assert.equal(note.body.summary, 'All is well.');
  assert.deepEqual((await call('POST', `/api/doctor-notes/${note.body.id}/apply`, {})).body, { started: [], stopped: [], appointment: null });
  assert.equal((await call('POST', '/api/scan/confirm', { medicines: [{ name: 'Glycomet', times: ['08:00'] }] })).body.saved, 1);
  assert.equal((await call('POST', '/api/sangat/nope/join')).status, 404);
});

test('photos go to Claude as image blocks, JSON mode stays Gemini-only, and recordings ask for Gemini', async () => {
  const { withHelpers } = await import('../src/agent/llm.js');
  const seen = [];
  const create = async (params) => { seen.push(params); return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }] }; };
  const claude = withHelpers({ provider: 'amazon-bedrock', model: 'm', create });
  assert.deepEqual(await claude.understand({ system: 's', prompt: 'p', media: [{ mimeType: 'image/jpeg', data: 'AAAA' }] }), { ok: true });
  assert.deepEqual(seen[0].messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  assert.equal(seen[0].json, undefined);
  await assert.rejects(claude.understand({ system: 's', prompt: 'p', media: [{ mimeType: 'audio/webm', data: 'AAAA' }] }), (e) => e.status === 503 && /Gemini/.test(e.message));
  const groq = withHelpers({ provider: 'groq', model: 'm', create });
  await assert.rejects(groq.understand({ system: 's', prompt: 'p', media: [{ mimeType: 'image/png', data: 'AAAA' }] }), (e) => e.status === 503);
  const gemini = withHelpers({ provider: 'gemini', model: 'm', create });
  await gemini.understand({ system: 's', prompt: 'p', media: [{ mimeType: 'audio/webm', data: 'AAAA' }] });
  assert.equal(seen.at(-1).json, true);
  assert.equal(seen.at(-1).messages[0].content[0].type, 'media');
});
