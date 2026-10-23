import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServices } from './helpers.js';
import { assessConcerns } from '../src/domain/safety.js';

test('orientation speaks the day, place and next routine item in her time zone', async () => {
  const { saathi } = testServices();
  const o = await saathi.orientation({ language: 'en' });
  assert.equal(o.today, 'Friday, 23 October 2026');
  assert.equal(o.time, '11:00');
  assert.equal(o.next.time, '13:30');
  assert.match(o.say, /Kothrud/);
});

test('she hears her own language by default, with no translation service at all', async () => {
  const { saathi } = testServices();
  const o = await saathi.orientation();
  assert.equal(o.sayLanguage, 'mr');
  assert.match(o.say, /शुक्रवार/);
  assert.match(o.say, /कोथरूड/);
  assert.match(o.say, /कॅल्शियमची गोळी/);

  const hi = await saathi.medicationSchedule({ language: 'hi' });
  assert.match(hi.say, /ब्लड प्रेशर की छोटी सफ़ेद गोल गोली/);
  const who = await saathi.whoIs('नात');
  assert.match(who.say, /रिया/);
  const ta = await saathi.orientation({ language: 'ta' });
  assert.equal(ta.sayLanguage, 'en', 'unsupported languages fall back to English for the translator');
});

test('tablets can be named in Marathi or Hindi', async () => {
  const { saathi } = testServices();
  const r = await saathi.confirmMedication('रक्तदाबाची गोळी');
  assert.equal(r.medication, 'Amlodipine 5 mg');
  assert.match(r.say, /रक्तदाबाची गोळी नोंदवली/);
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
  assert.match(inbox.messages[0].translated, /सुप्रभात आजी/);
  assert.equal((await saathi.familyMessages()).messages.length, 0, 'messages are marked as heard');

  const out = await saathi.sendToFamily({ text: 'माझी काळजी करू नका', language: 'mr' });
  assert.deepEqual(out.deliveries.map((d) => [d.to, d.language]), [['Riya', 'English'], ['Anand', 'Hindi']]);
  assert.ok(calls.includes('mr->en') && calls.includes('mr->hi'));
});

test('translations are cached: each message is translated once per language', async () => {
  let calls = 0;
  const translator = { kind: 'fake', translate: async (text, { from, to }) => { calls++; return { text: `[${to}] ${text}`, from, to, translated: true, engine: 'fake' }; } };
  const { saathi } = testServices({ translator });
  await saathi.messageFromFamily({ fromId: 'riya', text: 'Love you' });
  const first = await saathi.familyMessages({ unreadOnly: false, markRead: false, language: 'hi' });
  const second = await saathi.familyMessages({ unreadOnly: false, markRead: false, language: 'hi' });
  assert.equal(calls, 1, 'the seeded message is pre-translated, the new one is translated once');
  assert.equal(second.messages.at(-1).translationEngine, 'cache');
  assert.equal(first.messages[0].translationEngine, 'cache');
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
