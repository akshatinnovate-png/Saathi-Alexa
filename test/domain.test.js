import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServices } from './helpers.js';
import { assessConcerns } from '../src/domain/safety.js';

test('orientation speaks the day, place and next routine item in her time zone', async () => {
  const { saathi } = testServices();
  const o = await saathi.orientation();
  assert.equal(o.today, 'Friday, 23 October 2026');
  assert.equal(o.time, '11:00');
  assert.equal(o.next.time, '13:30');
  assert.match(o.say, /Kothrud/);
});

test('who_is resolves relationships, not just names', async () => {
  const { saathi } = testServices();
  const r = await saathi.whoIs('my granddaughter');
  assert.equal(r.person.name, 'Riya');
  assert.ok(r.lastMessage.text.includes('puran poli'));
  assert.deepEqual(r.regularPlans, ['Video call with Riya at 19:30 on Sunday and Wednesday']);
});

test('medication: due tablet is recorded once and double doses are prevented', async () => {
  const { saathi } = testServices();
  const before = await saathi.medicationSchedule();
  assert.equal(before.medications.find((m) => m.id === 'amlodipine').status, 'missed');
  const first = await saathi.confirmMedication('blood pressure');
  assert.equal(first.recorded, true);
  const second = await saathi.confirmMedication('blood pressure');
  assert.equal(second.recorded, false);
  assert.equal(second.alreadyTaken, true);
});

test('missed-dose sweep raises one gentle alert per tablet per day', async () => {
  const { saathi, localBus } = testServices();
  const sent = [];
  localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && sent.push(e.detail));
  assert.deepEqual(await saathi.sweepMissedDoses(), ['dose-amlodipine-2026-10-23']);
  assert.deepEqual(await saathi.sweepMissedDoses(), []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].severity, 'info');
});

test('safety screen: "blood pressure tablet" is not bleeding; Marathi fall is urgent', () => {
  assert.equal(assessConcerns('I took my blood pressure tablet').level, 'none');
  assert.deepEqual(assessConcerns('मी बाथरूममध्ये पडले').urgent, ['fall']);
  assert.deepEqual(assessConcerns('I feel so lonely today').gentle, ['loneliness']);
});

test('loneliness nudges every family member without starting an escalation', async () => {
  const { saathi, localBus, store } = testServices();
  const events = [];
  localBus.subscribe((e) => events.push(e));
  const r = await saathi.checkIn({ text: 'मला आज खूप एकटं वाटतंय', language: 'mr' });
  assert.equal(r.concerns.level, 'gentle');
  assert.equal((await store.list('alerts')).length, 0);
  const notes = events.filter((e) => e['detail-type'] === 'NotificationSent').map((e) => e.detail.recipientId);
  assert.deepEqual(notes.sort(), ['anand', 'riya']);
});

test('family messages are delivered to her translated, and her replies go out per recipient language', async () => {
  const calls = [];
  const translator = {
    kind: 'fake',
    async translate(text, { from, to }) {
      calls.push(`${from}->${to}`);
      return { text: `[${to}] ${text}`, from, to, translated: true, engine: 'fake' };
    },
  };
  const { saathi } = testServices({ translator });
  const inbox = await saathi.familyMessages();
  assert.equal(inbox.messages[0].translated.startsWith('[mr]'), true);
  assert.equal((await saathi.familyMessages()).messages.length, 0, 'messages are marked as heard');

  const out = await saathi.sendToFamily({ text: 'माझी काळजी करू नका', language: 'mr' });
  assert.deepEqual(out.deliveries.map((d) => [d.to, d.language]), [['Riya', 'English'], ['Anand', 'Hindi']]);
  assert.ok(calls.includes('mr->en') && calls.includes('mr->hi'));
});

test('stories are translated into every family language and narrated where a voice exists', async () => {
  const saved = [];
  const { saathi } = testServices({
    translator: { kind: 'fake', translate: async (text, { from, to }) => ({ text: `[${to}] ${text}`, from, to, translated: true, engine: 'fake' }) },
    speech: { kind: 'fake', synthesize: async (_t, l) => (l === 'ta' ? null : { audio: Buffer.from('mp3'), contentType: 'audio/mpeg', voice: 'Kajal' }) },
    media: { kind: 'fake', save: async (key) => { saved.push(key); return `/media/${key}`; } },
  });
  const r = await saathi.saveStory({ title: 'Monsoon wedding, 1968', text: 'आमचं लग्न पावसात झालं', language: 'mr' });
  assert.deepEqual(r.languages.sort(), ['English', 'Hindi', 'Marathi']);
  assert.equal(saved.length, 3);
});
