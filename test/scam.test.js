import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServices } from './helpers.js';
import { assessScam } from '../src/domain/safety.js';
import { planOffline } from '../src/agent/offlinePlanner.js';

const SCAMS = [
  'Someone called and asked for my OTP',
  'A man from CBI said I am under digital arrest',
  'He said install AnyDesk so he can fix my bank',
  'I won a lottery, they want a fee first',
  'The bank called, my KYC will be blocked',
  'Someone called asking me to send money to my grandson in hospital',
  'A caller asked for my ATM pin',
  'मुझे कोई फोन पर ओटीपी माँग रहा था',
  'कोणीतरी फोन करून केवाईसी अपडेट करायला सांगितलं',
  'koi phone pe otp maang raha tha',
];

const ORDINARY = [
  'Kabir sent me money for my birthday',
  'I feel lonely today',
  'The pin of my saree broke',
  'I fed the birds this morning',
  'Riya called, she is coming on Sunday',
  'What day is it today?',
];

test('scam shield: the common scams are caught, ordinary days are not', () => {
  for (const s of SCAMS) assert.equal(assessScam(s).suspected, true, s);
  for (const s of ORDINARY) assert.equal(assessScam(s).suspected, false, s);
});

test('scam shield: she is told calmly what not to do, and the family is alerted once', async () => {
  const { saathi, localBus, store } = testServices();
  const sent = [];
  localBus.subscribe((e) => e['detail-type'] === 'NotificationSent' && sent.push(e.detail));
  const first = await saathi.reportSuspiciousCall({ words: 'Someone called and asked for my OTP', language: 'en' });
  assert.match(first.say, /do not share any code/i);
  assert.match(first.say, /hang up/i);
  assert.deepEqual(first.kinds, ['code']);
  const again = await saathi.reportSuspiciousCall({ words: 'They called again about the OTP', language: 'en' });
  assert.equal(again.alertId, first.alertId);
  assert.equal(again.deduplicated, true);
  const alerts = (await store.list('alerts')).filter((a) => a.type === 'scam');
  assert.equal(alerts.length, 1);
  assert.ok(sent.some((n) => n.audience === 'family'));
  assert.ok(!sent.some((n) => n.audience === 'neighbour'), 'a scam is not broadcast to the neighbour');
});

test('scam shield: a check-in that mentions a scam alerts the family even when she asks to keep it private', async () => {
  const { saathi, store } = testServices();
  const out = await saathi.checkIn({ text: 'Keep this between us, a man from customs said digital arrest and wants money', language: 'en', keepPrivate: true });
  assert.equal(out.scam, true);
  assert.match(out.say, /do not send money/i);
  assert.ok((await store.list('alerts')).some((a) => a.type === 'scam' && !a.acknowledged));
  const hindi = await saathi.checkIn({ text: 'मुझे कोई फोन पर ओटीपी माँग रहा था', language: 'hi' });
  assert.equal(hindi.sayLanguage, 'hi');
  assert.match(hindi.say, /पैसे न भेजें/);
});

test('scam shield: a fall still comes first, and Alexa+ routes scam talk to the right tool', async () => {
  const { saathi, store } = testServices();
  const out = await saathi.checkIn({ text: 'I fell, and someone called asking for my OTP', language: 'en' });
  assert.ok(out.alertId);
  assert.ok((await store.list('alerts')).some((a) => a.type === 'help'));
  assert.equal(planOffline('Someone called and asked for my OTP', 'en').tool, 'report_suspicious_call');
  assert.equal(planOffline('Help, someone called asking for my OTP', 'en').tool, 'ask_family_for_help');
  assert.equal(planOffline('I feel lonely today', 'en').tool, 'daily_check_in');
});
