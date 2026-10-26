import { randomBytes } from 'node:crypto';
import { SEED_VERSION } from '../domain/seed.js';

const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

export function newHouseholdId() {
  return `h-${randomBytes(6).toString('hex')}`;
}

function uniqueId(base, taken) {
  let id = slug(base) || 'member';
  if (id === 'elder') id = 'member';
  let n = 2;
  const root = id;
  while (taken.has(id)) id = `${root}-${n++}`;
  taken.add(id);
  return id;
}

const clean = (value, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function validateOnboarding(form) {
  const problems = [];
  if (!clean(form?.elder?.name)) problems.push('Tell us the name of the person you care for.');
  if (!clean(form?.elder?.language, 5)) problems.push('Choose the language they speak.');
  if (!clean(form?.owner?.name)) problems.push('Tell us your name.');
  if (!clean(form?.owner?.relationship, 40)) problems.push('Tell us how you are related.');
  for (const [i, m] of (form?.medications ?? []).entries()) {
    if (!clean(m.name) || !/^\d{2}:\d{2}$/.test(m.time ?? '')) problems.push(`Medicine ${i + 1} needs a name and a time.`);
  }
  return problems;
}

export async function buildHousehold(form, { ownerEmail, translate, now = new Date() }) {
  const taken = new Set(['elder']);
  const e = form.elder;
  const language = clean(e.language, 5);
  const localize = async (text) => {
    if (!translate || language === 'en') return {};
    const t = await translate(text, language);
    return t && t !== text ? { [language]: t } : {};
  };

  const owner = {
    id: uniqueId(form.owner.name, taken), name: clean(form.owner.name), relationship: clean(form.owner.relationship, 40).toLowerCase(),
    role: 'family', language: clean(form.owner.language, 5) || 'en', city: clean(form.owner.city), timezone: clean(form.owner.timezone, 60) || 'UTC',
    email: ownerEmail, aliases: [], escalationOrder: 1,
    aboutForElder: `${clean(form.owner.name)} is your ${clean(form.owner.relationship, 40).toLowerCase()}.`,
  };
  const circle = [owner];
  if (clean(form.neighbour?.name)) {
    circle.push({
      id: uniqueId(form.neighbour.name, taken), name: clean(form.neighbour.name), relationship: 'neighbour', role: 'neighbour',
      language: clean(form.neighbour.language, 5) || language, city: clean(e.city), timezone: clean(form.elder.timezone, 60) || 'Asia/Kolkata',
      email: clean(form.neighbour.email).toLowerCase() || null, aliases: [], escalationOrder: 2,
      aboutForElder: `${clean(form.neighbour.name)} is your neighbour.`,
    });
  }

  const medications = [];
  for (const m of form.medications ?? []) {
    const phrase = `${clean(m.description) || 'tablet'} for ${clean(m.purpose) || clean(m.name)}`;
    const short = `${clean(m.purpose) || clean(m.name)} tablet`;
    const i18nPhrase = await localize(phrase);
    const i18nShort = await localize(short);
    medications.push({
      id: uniqueId(m.name, taken), name: clean(m.name), purpose: clean(m.purpose) || clean(m.name), time: m.time,
      withFood: Boolean(m.withFood), description: clean(m.description) || 'tablet', phrase, short,
      supply: { remaining: Math.max(0, Number(m.remaining) || 30), perDay: 1, lowAtDays: 5 },
      i18n: i18nPhrase[language] || i18nShort[language] ? { [language]: { phrase: i18nPhrase[language] ?? phrase, short: i18nShort[language] ?? short } } : {},
    });
  }

  return {
    meta: [{ id: 'schema', version: SEED_VERSION }],
    profile: [{
      id: 'elder', name: clean(e.name), preferredName: clean(e.preferredName) || clean(e.name).split(' ')[0], language,
      secondaryLanguage: clean(e.secondaryLanguage, 5) || null, city: clean(e.city), home: clean(e.home) || clean(e.city),
      accessibility: {
        memorySupport: Boolean(e.memorySupport), hearing: e.hearingLoss ? 'mild-loss' : 'typical', vision: e.lowVision ? 'low-vision' : 'typical',
        preferredPace: e.memorySupport || e.hearingLoss ? 'slow' : 'normal', largeText: Boolean(e.lowVision),
      },
      privacy: { shareMoodWords: form.privacy?.shareMoodWords !== false },
      pharmacy: clean(form.pharmacy?.name) ? { name: clean(form.pharmacy.name), phone: clean(form.pharmacy.phone, 30) } : null,
      devices: [], routine: medications.map((m) => ({ time: m.time, activity: `${m.short} (${m.name})` })),
      createdAt: now.toISOString(),
    }],
    circle, medications, doses: [], checkins: [], stories: [], messages: [], alerts: [], door: [], appointments: [], letters: [],
    ownerMemberId: owner.id,
  };
}
