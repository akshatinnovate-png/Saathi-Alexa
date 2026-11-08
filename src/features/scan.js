import { bad, imageInput, needsModel, timesFrom } from './media.js';

export const INTERACTIONS = [
  { a: ['warfarin', 'acenocoumarol'], b: ['aspirin', 'ibuprofen', 'diclofenac', 'naproxen', 'clopidogrel'], why: 'together they raise the risk of bleeding' },
  { a: ['clopidogrel'], b: ['omeprazole', 'esomeprazole'], why: 'the second can make clopidogrel work less well' },
  { a: ['simvastatin'], b: ['amlodipine', 'diltiazem', 'verapamil', 'clarithromycin'], why: 'the simvastatin dose may need to be kept low' },
  { a: ['sildenafil', 'tadalafil'], b: ['isosorbide', 'nitroglycerin', 'glyceryl trinitrate', 'nicorandil'], why: 'together they can drop blood pressure dangerously' },
  { a: ['spironolactone', 'eplerenone'], b: ['potassium', 'ramipril', 'enalapril', 'lisinopril', 'telmisartan', 'losartan'], why: 'together they can raise potassium too high' },
  { a: ['ibuprofen', 'diclofenac', 'naproxen', 'aceclofenac', 'etoricoxib'], b: ['ibuprofen', 'diclofenac', 'naproxen', 'aceclofenac', 'etoricoxib'], why: 'two painkillers of the same kind are usually not taken together' },
  { a: ['metformin'], b: ['contrast'], why: 'metformin is often paused around scans that use contrast dye' },
];

const SYSTEM = `You read photos of Indian prescriptions, tablet strips and medicine boxes for an elder-care app.
Return only JSON: {"kind": "prescription" | "strip" | "box" | "other", "medicines": [{"name": string, "generic": string, "strength": string, "form": "tablet"|"capsule"|"syrup"|"drops"|"injection"|"inhaler"|"other", "times": ["morning"|"afternoon"|"evening"|"night"|"HH:MM"], "withFood": "before"|"after"|"with"|"any", "days": number|null, "purpose": string, "confidence": number}], "doctor": string, "notes": string}.
Read "1-0-1" as morning and night, "1-1-1" as morning, afternoon and night, "0-0-1" as night, "OD" as once a day, "BD" as twice, "TDS" as three times, "HS" as night. "AC" is before food, "PC" after food.
"generic" is the generic (salt) name in lowercase English, for example "amlodipine" for Amlong.
"purpose" is a short plain-English guess like "blood pressure", or "" if unsure. Never invent medicines that are not visible. If the photo is not a medicine, return {"kind":"other","medicines":[]}.`;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const hits = (names, list) => names.some((n) => list.some((x) => n.includes(x)));

export function checkMedicines(found, existing) {
  const names = (m) => [norm(m.generic), norm(m.name)].filter(Boolean);
  const notes = [];
  for (const f of found) {
    const fn = names(f);
    const same = existing.find((e) => names(e).some((n) => fn.some((x) => x && (n.includes(x) || x.includes(n)))));
    if (same) notes.push({ kind: 'duplicate', medicine: f.name, existing: same.name, text: `${f.name} looks like ${same.name}, which is already in Saathi. Check before adding it twice.` });
  }
  const all = [...existing.map((e) => ({ name: e.name, names: names(e), existing: true })), ...found.map((f) => ({ name: f.name, names: names(f), existing: false }))];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].existing && all[j].existing) continue;
      const x = all[i];
      const y = all[j];
      const rule = INTERACTIONS.find((r) => (hits(x.names, r.a) && hits(y.names, r.b)) || (hits(y.names, r.a) && hits(x.names, r.b)));
      if (rule && x.names.join() !== y.names.join()) notes.push({ kind: 'interaction', medicines: [x.name, y.name], text: `${x.name} and ${y.name}: ${rule.why}. Ask the doctor or pharmacist before giving them together.` });
    }
  }
  return notes;
}

export function createScan({ llm, services }) {
  return {
    async read(householdId, { image: buffer, contentType } = {}) {
      needsModel(llm, 'Reading a prescription');
      const image = imageInput(buffer, contentType);
      const out = await llm.understand({ system: SYSTEM, prompt: 'Read this photo.', media: [image], maxTokens: 2048 });
      if (!out || !Array.isArray(out.medicines)) throw bad('Saathi could not read that photo. Try again in good light, flat and in focus.', 422);
      const medicines = out.medicines.slice(0, 12).map((m) => {
        const times = timesFrom(m.times);
        return {
          name: String(m.name ?? '').trim().slice(0, 80),
          generic: norm(m.generic).slice(0, 80),
          strength: String(m.strength ?? '').trim().slice(0, 40),
          form: String(m.form ?? 'tablet'),
          times: times.length ? times : ['08:00'],
          timesGuessed: !times.length,
          withFood: m.withFood === 'after' || m.withFood === 'with',
          beforeFood: m.withFood === 'before',
          days: Number.isFinite(Number(m.days)) && Number(m.days) > 0 ? Math.round(Number(m.days)) : null,
          purpose: String(m.purpose ?? '').trim().slice(0, 60),
          confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
        };
      }).filter((m) => m.name);
      const existing = (await services.forHousehold(householdId).careSetup()).medications.map((m) => ({ id: m.id, name: m.name, generic: m.generic ?? '' }));
      return { kind: out.kind ?? 'other', doctor: String(out.doctor ?? '').slice(0, 80), notes: String(out.notes ?? '').slice(0, 300), medicines, checks: checkMedicines(medicines, existing) };
    },

    async confirm(householdId, list = []) {
      if (!Array.isArray(list) || !list.length) throw bad('Choose at least one medicine to add.');
      const saathi = services.forHousehold(householdId);
      const saved = [];
      for (const m of list.slice(0, 12)) {
        const strength = String(m.strength ?? '').trim();
        saved.push(await saathi.saveMedication({
          name: [String(m.name ?? '').trim(), strength].filter(Boolean).join(' '),
          generic: m.generic,
          times: timesFrom(m.times),
          purpose: m.purpose,
          withFood: Boolean(m.withFood),
          description: m.form,
        }));
      }
      return { saved: saved.length, medications: saved.map((m) => ({ id: m.id, name: m.name, times: m.times })) };
    },
  };
}
