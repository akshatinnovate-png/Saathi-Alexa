import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { testServices, testConfig } from './helpers.js';

const clip = Buffer.from('fake-webm-audio');

test('a family member\'s recorded voice plays before the tablet reminder it was made for', async () => {
  const { saathi, localBus } = testServices();
  const heard = [];
  localBus.subscribe((e) => e['detail-type'] === 'TabletReminder' && heard.push(e.detail));
  await assert.rejects(saathi.saveReminderVoice({ fromId: 'nobody', audio: clip }), /Unknown family member/);
  await assert.rejects(saathi.saveReminderVoice({ fromId: 'riya', audio: clip, medicationId: 'nope' }), /no longer exists/);
  await assert.rejects(saathi.saveReminderVoice({ fromId: 'riya', audio: clip, contentType: 'text/plain' }), /as audio/);
  const med = await saathi.saveMedication({ name: 'Metformin', purpose: 'sugar', times: ['11:00'] });
  await saathi.saveReminderVoice({ fromId: 'anand', audio: clip });
  const saved = await saathi.saveReminderVoice({ fromId: 'riya', audio: clip, contentType: 'audio/ogg; codecs=opus', medicationId: med.id });
  assert.equal(saved.id, `riya:${med.id}`);
  const list = await saathi.reminderVoices();
  assert.deepEqual(list.map((v) => v.from).sort(), ['Anand', 'Riya']);
  assert.ok(list.every((v) => v.url));

  await saathi.sweepReminders();
  const reminder = heard.find((d) => d.medications.some((m) => m.startsWith(med.id)));
  assert.ok(reminder, 'the Metformin reminder was sent');
  assert.equal(reminder.voice.from, 'Riya');
  assert.ok(reminder.voice.url);

  assert.equal(await saathi.removeReminderVoice({ fromId: 'riya', medicationId: med.id }), true);
  assert.equal((await saathi.reminderVoices()).length, 1);
});

test('the Living Legacy book has every story as a chapter in each family language, oldest first', async () => {
  const { saathi } = testServices();
  const empty = await saathi.legacyBook();
  const before = empty.chapters.length;
  await saathi.saveStory({ title: 'The mango tree', text: 'When I was small we climbed the mango tree every summer.', language: 'en' });
  const book = await saathi.legacyBook();
  assert.equal(book.chapters.length, before + 1);
  assert.equal(book.chapters.at(-1).title, 'The mango tree');
  assert.equal(book.chapters.at(-1).number, before + 1);
  assert.ok(book.languages.includes(book.elder.language));
  assert.ok(book.languages.length >= 2);
});

test('family voice and the legacy book over HTTP need a signed-in family member', async () => {
  const services = testServices();
  const accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const app = createApp({ config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }), services, accounts, sessions: createSessions('s'), optionalVerifier: createHouseholdVerifier({ base: null, accounts }) });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/family/legacy`)).status, 401);
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'riya@saathi.demo', password: DEMO_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const saved = await fetch(`${base}/api/family/reminder-voice`, { method: 'POST', headers: { cookie, 'content-type': 'audio/webm' }, body: clip });
    assert.equal(saved.status, 200);
    assert.equal((await fetch(`${base}/api/family/reminder-voice`, { method: 'POST', headers: { cookie, 'content-type': 'audio/webm' }, body: Buffer.alloc(0) })).status, 400);
    const list = await (await fetch(`${base}/api/family/reminder-voices`, { headers: { cookie } })).json();
    assert.equal(list.voices[0].from, 'Riya');
    const removed = await (await fetch(`${base}/api/family/reminder-voice`, { method: 'DELETE', headers: { cookie } })).json();
    assert.equal(removed.removed, true);
    const book = await (await fetch(`${base}/api/family/legacy`, { headers: { cookie } })).json();
    assert.ok(Array.isArray(book.chapters));
    assert.equal((await fetch(`${base}/legacy.html`, { headers: { cookie } })).status, 200);
  } finally {
    server.close();
  }
});
