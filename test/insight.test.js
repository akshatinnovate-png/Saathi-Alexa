import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInsight, localDate } from '../src/domain/insight.js';
import { testServices } from './helpers.js';

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-10-28T12:00:00Z');
const tz = 'Asia/Kolkata';
const medications = [
  { id: 'bp', name: 'Amlodipine', purpose: 'blood pressure', times: ['09:00'] },
  { id: 'mem', name: 'Donepezil', purpose: 'memory', times: ['21:00'] },
  { id: 'vit', name: 'Vitamin D', purpose: 'bones', time: '13:00', days: [0] },
];

function month({ hardWeek }) {
  const doses = [];
  const checkins = [];
  const door = [];
  const orientations = [];
  const alerts = [];
  for (let d = 0; d < 28; d++) {
    const ms = now - d * DAY;
    const date = localDate(ms, tz);
    const thisWeek = d < 7;
    const bad = hardWeek && thisWeek;
    doses.push({ medicationId: 'bp', slot: 0, date });
    if (!bad || d % 3 === 0) doses.push({ medicationId: 'mem', slot: 0, date });
    if (!bad) door.push({ at: new Date(ms).toISOString() });
    if (d % 3 === 0) checkins.push({ at: new Date(ms).toISOString(), sentiment: bad ? 'NEGATIVE' : 'POSITIVE', concerns: [], private: d === 0 });
    const asks = bad ? 2 : d % 7 === 0 ? 1 : 0;
    for (let i = 0; i < asks; i++) orientations.push({ at: new Date(ms).toISOString() });
  }
  if (hardWeek) alerts.push({ type: 'help', createdAt: new Date(now - DAY).toISOString() }, { type: 'scam-guard', createdAt: new Date(now).toISOString() });
  return { doses, checkins, door, orientations, alerts };
}

test('a hard week is described in plain, non-medical words against her own usual week', () => {
  const out = computeInsight({ now, timeZone: tz, name: 'Aaji', medications, ...month({ hardWeek: true }) });
  const keys = out.changes.map((c) => c.key);
  for (const k of ['tablets', 'evening', 'orientation', 'mood', 'door', 'help']) assert.ok(keys.includes(k), k);
  assert.match(out.summary, /does not diagnose/);
  assert.equal(out.weeks.length, 4);
  assert.ok(out.current.adherence < out.usual.adherence);
  assert.equal(out.current.scams, 1);
  assert.equal(out.current.privateCheckins, 1);
  assert.ok(out.changes.every((c) => !/dementia|depress|disease|diagnos/i.test(c.text)));
});

test('an ordinary week raises nothing, and silence after usual check-ins is noticed', () => {
  const calm = computeInsight({ now, timeZone: tz, name: 'Aaji', medications, ...month({ hardWeek: false }) });
  assert.deepEqual(calm.changes, []);
  assert.match(calm.summary, /No unusual changes/);
  const data = month({ hardWeek: false });
  data.checkins = data.checkins.filter((c) => now - Date.parse(c.at) >= 7 * DAY);
  const quiet = computeInsight({ now, timeZone: tz, name: 'Aaji', medications, ...data });
  assert.ok(quiet.changes.some((c) => c.key === 'quiet'));
  const first = computeInsight({ now, timeZone: tz, name: 'Aaji', medications: [], doses: [], checkins: [], door: [], orientations: [], alerts: [], weeks: 2 });
  assert.equal(first.current.adherence, null);
  assert.deepEqual(first.changes, []);
});

test('the domain counts "what day is it" questions and builds the report from real data', async () => {
  const { saathi } = testServices();
  for (let i = 0; i < 6; i++) await saathi.orientation({ language: 'en' });
  const out = await saathi.insight({ weeks: 99 });
  assert.equal(out.weeks.length, 12);
  assert.equal(out.current.askedTime, 6);
  assert.ok(out.changes.some((c) => c.key === 'orientation'));
  assert.equal(out.elder.preferredName, 'Aaji');
  assert.ok(out.medications.length >= 2);
  assert.ok(out.medications.every((m) => Array.isArray(m.times)));
});
