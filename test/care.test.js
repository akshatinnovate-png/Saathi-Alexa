import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServices } from './helpers.js';

const noteSent = (bus) => {
  const sent = [];
  bus.subscribe((e) => e['detail-type'] === 'NotificationSent' && sent.push(e.detail));
  return sent;
};

test('refills: each dose counts down the supply; low supply alerts the family once per cycle', async () => {
  const { saathi, store, localBus } = testServices();
  const sent = noteSent(localBus);
  assert.equal((await saathi.medicationStatus()).find((m) => m.id === 'amlodipine').daysLeft, 5);
  assert.deepEqual(await saathi.sweepSupplies(), ['refill-amlodipine-0']);
  assert.equal((await store.get('alerts', 'refill-amlodipine-0')).daysLeft, 5);
  assert.ok(sent.some((n) => /running low on Amlodipine/.test(n.subject)));

  await saathi.confirmMedication('blood pressure');
  assert.equal((await store.get('medications', 'amlodipine')).supply.remaining, 4);
  assert.deepEqual(await saathi.sweepSupplies(), [], 'no duplicate alert in the same cycle');

  const r = await saathi.recordRefill({ medicationId: 'amlodipine', quantity: 30, by: 'anand' });
  assert.equal(r.daysLeft, 34);
  assert.equal((await store.get('alerts', 'refill-amlodipine-0')).acknowledgedBy, 'anand');
  const inbox = await saathi.familyMessages();
  assert.match(inbox.messages.at(-1).original, /आनंद यांनी तुमची रक्तदाबाची गोळी आणखी मागवली/);
});

test('appointments: she hears about tomorrow in her language, and the family is asked who will take her', async () => {
  const { saathi, store, localBus } = testServices();
  const sent = noteSent(localBus);
  const mr = await saathi.upcomingAppointments();
  assert.equal(mr.appointments.length, 2);
  assert.match(mr.say, /उद्या ११:०० वाजता/);
  assert.match(mr.say, /डॉ\. कुलकर्णी/);

  const orientation = await saathi.orientation({ language: 'en' });
  assert.match(orientation.say, /Tomorrow at 11:00 you see Dr\. Kulkarni/);

  assert.deepEqual(await saathi.sweepAppointments(), ['escort-appt-memory-clinic']);
  assert.deepEqual(await saathi.sweepAppointments(), []);
  assert.ok(sent.some((n) => /Who can take Aaji to Dr. Kulkarni/.test(n.subject)));

  await saathi.claimEscort({ appointmentId: 'appt-memory-clinic', member: 'anand' });
  assert.equal((await store.get('alerts', 'escort-appt-memory-clinic')).acknowledged, true);
  const en = await saathi.upcomingAppointments({ language: 'en' });
  assert.match(en.say, /Anand will take you/);
  const inbox = await saathi.familyMessages();
  assert.match(inbox.messages.at(-1).original, /आनंद उद्या तुम्हाला मेमरी क्लिनिकमध्ये तपासणीसाठी घेऊन जातील/);
});

test('voice notes: Riya records her voice and Aaji hears it, announced in Marathi', async () => {
  const saved = [];
  const { saathi } = testServices({
    media: { kind: 'fake', save: async (key, body) => { saved.push([key, body.length]); return `s3://bucket/${key}`; }, playbackUrl: async (ref) => `https://signed.example/${ref.slice(5)}` },
  });
  await saathi.addVoiceNote({ fromId: 'riya', audio: Buffer.from('opus-audio'), contentType: 'audio/webm;codecs=opus', durationSec: 7 });
  assert.match(saved[0][0], /^voice\/voice-.*\.webm$/);
  const inbox = await saathi.familyMessages();
  assert.equal(inbox.voiceNotes.length, 1);
  assert.match(inbox.voiceNotes[0].url, /^https:\/\/signed\.example\/bucket\/voice\//);
  assert.match(inbox.say, /रिया यांनी तुम्हाला आवाजात निरोप पाठवला आहे/);
  await assert.rejects(saathi.addVoiceNote({ fromId: 'stranger', audio: Buffer.from('x') }), /Unknown family member/);
});

test('weekly letter: one per family member, in their language, counting private check-ins without quoting them', async () => {
  const translator = { kind: 'fake', translate: async (text, { from, to }) => ({ text: to === 'en' ? text : `[${to}] ${text}`, from, to, translated: to !== 'en', engine: 'fake' }) };
  const { saathi, localBus } = testServices({ translator });
  const sent = noteSent(localBus);
  await saathi.confirmMedication('blood pressure');
  await saathi.checkIn({ text: 'I feel happy today', language: 'en' });
  await saathi.checkIn({ text: 'I miss my husband, keep it between us', language: 'en', keepPrivate: true });
  await saathi.saveStory({ title: 'The bicycle', text: 'Grandpa taught me to ride', language: 'en' });
  await saathi.doorEvent({ kind: 'motion' });

  const letters = await saathi.weeklyLetters();
  assert.deepEqual(letters.map((l) => [l.memberId, l.language]).sort(), [['anand', 'hi'], ['riya', 'en']]);
  const riya = letters.find((l) => l.memberId === 'riya');
  assert.match(riya.english, /Tablets: 1 of 21 taken \(5%\)/);
  assert.match(riya.english, /checked in 2 times, mostly positive \(1 kept private, by her choice\)/);
  assert.match(riya.english, /1 new story: "The bicycle"/);
  assert.match(riya.english, /Front door: activity on 1 of 7 days/);
  assert.match(riya.english, /Memory clinic check-up with Dr\. Kulkarni on 2026-10-24 at 11:00 \(nobody is taking her yet\)/);
  assert.doesNotMatch(riya.english, /husband/);
  assert.match(letters.find((l) => l.memberId === 'anand').text, /^\[hi\] Dear Anand/);
  assert.equal(sent.filter((n) => n.subject === "Aaji's week").length, 2);
});
