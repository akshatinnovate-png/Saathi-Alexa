import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalls, twilioSignature, isDue, twiml } from '../src/calls/calls.js';
import { createApp } from '../src/http/app.js';
import { testServices, testConfig } from './helpers.js';

const PUBLIC = 'https://saathi.example.org';

function setup({ retryAfterMs = 5 } = {}) {
  const services = testServices();
  const posts = [];
  const notes = [];
  services.localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && notes.push(e.detail));
  const calls = createCalls({
    provider: 'twilio', accountSid: 'AC1', authToken: 'tok', from: '+15550001111', whatsappFrom: '+15550002222', publicUrl: PUBLIC, services, retryAfterMs,
    fetchImpl: async (url, init) => { posts.push({ url, form: Object.fromEntries(new URLSearchParams(init.body)) }); return { ok: true, json: async () => ({ sid: `CA${posts.length}` }) }; },
    log: { error() {} },
  });
  const tokenOf = (post) => new URL(post.form.Url).searchParams.get('t');
  return { services, calls, posts, notes, tokenOf };
}

test('calls are off unless Twilio and a public address are set, and settings are checked', async () => {
  const { saathi } = testServices();
  assert.equal(createCalls({ services: {} }).enabled, false);
  assert.equal(createCalls({ provider: 'twilio', accountSid: 'a', authToken: 'b', from: '+1', services: {} }).enabled, false);
  await assert.rejects(createCalls({ services: {} }).place('default'), /not set up/);
  await assert.rejects(saathi.updateProfile({ calls: { enabled: true, phone: '12345' } }), /country code/);
  await assert.rejects(saathi.updateProfile({ calls: { enabled: false, time: '25:00' } }), /like 10:00/);
  await saathi.updateProfile({ calls: { enabled: true, phone: '+91 98123 45678', time: '10:00', summaryTo: ['+91 98000 00000', 'bad'] } });
  const me = await saathi.elder();
  assert.deepEqual(me.calls, { enabled: true, phone: '+919812345678', time: '10:00', summaryTo: ['+919800000000'] });
  assert.ok(isDue(me.calls, { date: '2026-10-23', time: '10:00' }, null));
  assert.ok(!isDue(me.calls, { date: '2026-10-23', time: '10:00' }, '2026-10-23'));
  assert.ok(!isDue(me.calls, { date: '2026-10-23', time: '10:01' }, null));
  assert.ok(!isDue({ ...me.calls, enabled: false }, { date: 'x', time: '10:00' }, null));
});

test('a daily call asks about tablets and feelings in Marathi, records them and sends the family a summary', async () => {
  const { services, calls, posts, notes, tokenOf } = setup();
  await assert.rejects(calls.place('default'), /phone number/);
  await services.saathi.updateProfile({ calls: { enabled: true, phone: '+919812345678', time: '11:00', summaryTo: ['+919800000000'] } });
  const placed = await calls.place('default');
  assert.equal(placed.sid, 'CA1');
  assert.equal(posts[0].form.To, '+919812345678');
  assert.match(posts[0].form.StatusCallback, /\/calls\/status\?t=/);
  const token = tokenOf(posts[0]);

  const start = await calls.step('start', token);
  assert.match(start, /<Gather input="speech" language="mr-IN"/);
  assert.match(start, /नमस्कार Aaji/);
  const meds = await calls.step('meds', token, { SpeechResult: 'हो, घेतल्या' });
  assert.match(meds, /धन्यवाद/);
  const feel = await calls.step('feel', token, { SpeechResult: 'मला बरं वाटतंय' });
  assert.match(feel, /<Hangup\/>/);
  const summary = notes.find((n) => /talked with Saathi/.test(n.subject));
  assert.ok(summary, 'family got the summary');
  const whatsapp = posts.find((p) => p.url.endsWith('/Messages.json'));
  assert.equal(whatsapp.form.To, 'whatsapp:+919800000000');
  assert.match(whatsapp.form.Body, /answered Saathi's call/);
  assert.match(await calls.step('start', 'unknown-token'), /<Hangup\/>/);
});

test('"not yet" is answered kindly, silence moves on, and goodbye still sends the summary', async () => {
  const { services, calls, posts, notes, tokenOf } = setup();
  await services.saathi.updateProfile({ calls: { enabled: true, phone: '+919812345678' } });
  await calls.place('default');
  const token = tokenOf(posts[0]);
  assert.match(await calls.step('meds', token, { SpeechResult: 'नाही अजून' }), /कृपया आत्ता/);
  assert.match(await calls.step('meds', token, {}), /माफ करा/);
  assert.match(await calls.step('feel-ask', token), /Gather/);
  assert.match(await calls.step('bye', token), /<Hangup\/>/);
  const once = notes.filter((n) => /talked with Saathi/.test(n.subject)).length;
  assert.ok(once >= 1);
  assert.match(await calls.step('bye', token), /<Hangup\/>/);
  assert.equal(notes.filter((n) => /talked with Saathi/.test(n.subject)).length, once, 'a second goodbye sends nothing more');
  assert.match(await calls.step('weird', token), /<Hangup\/>/);
});

test('an unanswered call is retried once, then the family is alerted', async () => {
  const { services, calls, posts, tokenOf, notes } = setup({ retryAfterMs: 5 });
  await services.saathi.updateProfile({ calls: { enabled: true, phone: '+919812345678' } });
  await calls.place('default');
  assert.deepEqual(await calls.status(tokenOf(posts[0]), { CallStatus: 'no-answer' }), { status: 'no-answer', retrying: true });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(posts.length, 2, 'retried');
  assert.deepEqual(await calls.status(tokenOf(posts[1]), { CallStatus: 'busy' }), { status: 'busy', alerted: true });
  assert.ok(notes.some((n) => /did not answer/.test(n.subject)));
  const alerts = (await services.saathi.familySummary({ forMemberId: 'riya' })).alerts;
  assert.ok(alerts.some((a) => a.type === 'call-missed'));
  assert.deepEqual(await calls.status('gone', {}), { ignored: true });
  await calls.place('default');
  assert.deepEqual(await calls.status(tokenOf(posts.at(-1)), { CallStatus: 'completed' }), { status: 'completed' });
});

test('the daily sweep calls once at the chosen time; Twilio failures are reported', async () => {
  const { services, calls, posts } = setup();
  const now = await services.saathi.localNow();
  await services.saathi.updateProfile({ calls: { enabled: true, phone: '+919812345678', time: now.time } });
  assert.equal((await calls.sweep(['default'])).length, 1);
  assert.equal((await calls.sweep(['default'])).length, 0);
  assert.equal(posts.length, 1);
  assert.deepEqual(await createCalls({ services }).sweep(['default']), []);
  const broken = createCalls({ provider: 'twilio', accountSid: 'a', authToken: 'b', from: '+1', publicUrl: PUBLIC, services, fetchImpl: async () => { throw new Error('down'); }, log: { error() {} } });
  await assert.rejects(broken.place('default'), /could not be reached/);
  const refused = createCalls({ provider: 'twilio', accountSid: 'a', authToken: 'b', from: '+1', publicUrl: PUBLIC, services, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ message: 'Unverified number' }) }), log: { error() {} } });
  await assert.rejects(refused.place('default'), /Unverified number/);
  assert.equal(twiml(['<Hangup/>']), '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
});

test('Twilio webhooks must carry a valid signature', async () => {
  const { services, calls, posts, tokenOf } = setup();
  await services.saathi.updateProfile({ calls: { enabled: true, phone: '+919812345678' } });
  await calls.place('default');
  const token = tokenOf(posts[0]);
  const app = createApp({ config: testConfig({ host: '127.0.0.1', auth: { ...testConfig().auth, publicUrl: PUBLIC }, web: { requireLogin: false } }), services, calls });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const local = `http://127.0.0.1:${server.address().port}`;
  try {
    const path = `/calls/start?t=${token}`;
    const params = { CallSid: 'CA1' };
    const body = new URLSearchParams(params).toString();
    const bad = await fetch(local + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'nope' }, body });
    assert.equal(bad.status, 403);
    const good = await fetch(local + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature('tok', PUBLIC + path, params) }, body });
    assert.equal(good.status, 200);
    assert.match(good.headers.get('content-type'), /xml/);
    assert.match(await good.text(), /<Gather/);
    const statusPath = `/calls/status?t=${token}`;
    const done = await fetch(local + statusPath, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature('tok', PUBLIC + statusPath, { CallStatus: 'completed' }) }, body: 'CallStatus=completed' });
    assert.deepEqual(await done.json(), { status: 'completed' });
    assert.equal(calls.verify(PUBLIC, {}, undefined), false);
  } finally {
    server.close();
  }
});
