import { randomUUID } from 'node:crypto';
import { bad, audioInput, needsModel, timesFrom } from './media.js';

const SYSTEM = `You listen to a recording of an elderly patient's visit to an Indian doctor, made with consent, for the patient's family.
The conversation may be in Marathi, Hindi, English or a mix. Write everything in simple English that a worried grandchild can follow.
Return only JSON: {"summary": string (3 to 5 short sentences), "plain": string (the problem in everyday words, no jargon), "doctor": string,
"medicineChanges": [{"action": "start"|"stop"|"change"|"continue", "name": string, "generic": string, "dose": string, "times": ["morning"|"afternoon"|"evening"|"night"|"HH:MM"], "withFood": boolean, "days": number|null, "reason": string}],
"tests": [string], "nextVisit": {"when": string, "with": string, "why": string} | null, "warnings": [string], "questions": [string]}.
"warnings" are danger signs the doctor said to watch for. "questions" are things the family may want to ask next time.
Only include what was actually said. If something is unclear, leave it out rather than guess. If the recording is not a doctor visit, return {"summary": "", "medicineChanges": []}.`;

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const list = (v, n, each) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => clip(x, each)).filter(Boolean);

export function cleanNote(out) {
  const changes = (Array.isArray(out?.medicineChanges) ? out.medicineChanges : []).slice(0, 15).map((c) => ({
    action: ['start', 'stop', 'change', 'continue'].includes(c.action) ? c.action : 'continue',
    name: clip(c.name, 80), generic: clip(c.generic, 80).toLowerCase(), dose: clip(c.dose, 40),
    times: timesFrom(c.times), withFood: Boolean(c.withFood),
    days: Number.isFinite(Number(c.days)) && Number(c.days) > 0 ? Math.round(Number(c.days)) : null, reason: clip(c.reason, 160),
  })).filter((c) => c.name);
  const next = out?.nextVisit && typeof out.nextVisit === 'object' ? { when: clip(out.nextVisit.when, 60), with: clip(out.nextVisit.with, 80), why: clip(out.nextVisit.why, 160) } : null;
  return {
    summary: clip(out?.summary, 1200), plain: clip(out?.plain, 600), doctor: clip(out?.doctor, 80), medicineChanges: changes,
    tests: list(out?.tests, 10, 160), nextVisit: next?.when || next?.with ? next : null, warnings: list(out?.warnings, 8, 200), questions: list(out?.questions, 8, 200),
  };
}

export function createDoctorNotes({ llm, services, translator = null, clock = () => new Date() }) {
  const recordsFor = (householdId) => services.forHousehold(householdId).featureStore('doctorNotes');

  async function translations(text, languages) {
    const out = {};
    for (const lang of languages) {
      if (lang === 'en' || !text || !translator) continue;
      try { out[lang] = { summary: (await translator.translate(text, { from: 'en', to: lang })).text }; } catch { }
    }
    return out;
  }

  return {
    async record(householdId, { audio, contentType, consent, by = null, bookingId = null }) {
      if (consent !== true) throw bad('Ask the doctor first, then tick that they agreed to the recording.');
      needsModel(llm, 'Doctor Notes');
      const media = audioInput(audio, contentType);
      const out = await llm.understand({ system: SYSTEM, prompt: 'Summarise this doctor visit.', media: [media], maxTokens: 3000 });
      const note = cleanNote(out ?? {});
      if (!note.summary) throw bad('Saathi could not hear a doctor visit in that recording. Try recording closer to the doctor.', 422);
      const saathi = services.forHousehold(householdId);
      const me = await saathi.elder();
      const circle = await saathi.circle();
      const languages = [...new Set([me?.language, ...circle.map((p) => p.language)].filter(Boolean))];
      const item = {
        id: `note-${randomUUID().slice(0, 8)}`, at: clock().toISOString(), by, bookingId, ...note,
        translations: await translations(note.summary, languages), status: 'new', appliedAt: null,
      };
      await (await recordsFor(householdId)).put(item);
      await saathi.shareDoctorNote({ summary: note.summary, by });
      return item;
    },

    async list(householdId) {
      return (await (await recordsFor(householdId)).list()).sort((a, b) => b.at.localeCompare(a.at));
    },

    async apply(householdId, noteId, { start = [], stop = [], appointment = null } = {}) {
      const records = await recordsFor(householdId);
      const note = await records.get(String(noteId));
      if (!note) throw bad('No such note.', 404);
      if (note.status === 'applied') throw bad('These changes were already applied.', 409);
      const saathi = services.forHousehold(householdId);
      const done = { started: [], stopped: [], appointment: null };
      for (const m of (Array.isArray(start) ? start : []).slice(0, 10)) {
        const med = await saathi.saveMedication({ name: [clip(m.name, 80), clip(m.dose, 40)].filter(Boolean).join(' '), generic: m.generic, times: timesFrom(m.times), withFood: Boolean(m.withFood), purpose: clip(m.reason, 60) });
        done.started.push(med.id);
      }
      for (const id of (Array.isArray(stop) ? stop : []).slice(0, 10)) {
        if (await saathi.removeMedication(String(id))) done.stopped.push(String(id));
      }
      if (appointment?.at) done.appointment = (await saathi.saveAppointment({ title: appointment.title || 'Follow-up visit', with: appointment.with || note.doctor || 'Doctor', at: appointment.at, place: appointment.place })).id;
      await records.update(note.id, { status: 'applied', appliedAt: clock().toISOString(), applied: done });
      return done;
    },
  };
}
