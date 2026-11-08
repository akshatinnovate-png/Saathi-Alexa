import { randomUUID } from 'node:crypto';
import { bad } from './media.js';
import { upiLink, LESSONS } from '../didis/didis.js';

const MEET = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const LANGS = ['en', 'hi', 'mr'];
const TZ = 'Asia/Kolkata';
const FALLBACK_TOPICS = [
  'Songs from your favourite old film',
  'The festival you loved most as a child',
  'A recipe your mother made',
  'Your first job or your school days',
  'A place you would love to visit again',
  'Bhajans and prayers you know by heart',
  'Funny stories from the family',
];

const clean = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const hhmm = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));

export function localClock(now, tz = TZ) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`, day };
}

const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export function createSangat({ store, services, llm = null, clock = () => new Date(), leadMinutes = 10 }) {
  const month = () => clock().toISOString().slice(0, 7);

  function view(c, householdId = null, didi = null) {
    const member = householdId ? c.members.find((m) => m.householdId === householdId) : null;
    return {
      id: c.id, title: c.title, language: c.language, city: c.city, time: c.time, days: c.days, fee: c.fee,
      seats: c.maxMembers - c.members.length, members: c.members.length, active: c.active,
      host: didi ? { id: didi.id, name: didi.name, rating: didi.ratings?.length ? Math.round((didi.ratings.reduce((a, r) => a + r, 0) / didi.ratings.length) * 10) / 10 : null } : null,
      joined: Boolean(member),
      paidThisMonth: Boolean(member?.paidMonths?.includes(month())),
      payLink: member && !member.paidMonths?.includes(month()) && didi?.upiId && c.fee ? upiLink({ upiId: didi.upiId, name: didi.name, amount: c.fee, note: `Saathi Sangat ${month()}` }) : null,
      meetLink: member || !householdId ? c.meetLink : null,
    };
  }

  async function circle(id) {
    const c = await store.get('circles', String(id));
    if (!c) throw bad('No such circle.', 404);
    return c;
  }

  return {
    async create(didi, input = {}) {
      if (!didi.verified || !LESSONS.every((l) => (didi.lessons ?? []).includes(l.id))) throw bad('Finish verification and the lessons before hosting a circle.', 403);
      const title = clean(input.title, 60) || 'Chai and stories';
      const language = LANGS.includes(input.language) ? input.language : didi.languages[0] ?? 'hi';
      if (!hhmm(input.time)) throw bad('Choose a time, like 17:00.');
      const meetLink = clean(input.meetLink, 80);
      if (!MEET.test(meetLink)) throw bad('Paste a Google Meet link, like https://meet.google.com/abc-defg-hij.');
      const days = Array.isArray(input.days) && input.days.length ? [...new Set(input.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [0, 1, 2, 3, 4, 5, 6];
      const fee = Math.max(0, Math.min(2000, Math.round(Number(input.fee) || 0)));
      const c = {
        id: `circle-${randomUUID().slice(0, 8)}`, didiId: didi.id, title, language, city: didi.city, time: input.time, days, meetLink, fee,
        maxMembers: Math.min(10, Math.max(3, Math.round(Number(input.maxMembers) || 8))), members: [], active: true, remindedOn: null, createdAt: clock().toISOString(),
      };
      await store.put('circles', c);
      return view(c, null, didi);
    },

    async update(didi, id, input = {}) {
      const c = await circle(id);
      if (c.didiId !== didi.id) throw bad('That circle is not yours.', 404);
      const patch = {};
      if (input.time !== undefined) { if (!hhmm(input.time)) throw bad('Choose a time, like 17:00.'); patch.time = input.time; }
      if (input.meetLink !== undefined) { if (!MEET.test(clean(input.meetLink, 80))) throw bad('Paste a Google Meet link.'); patch.meetLink = clean(input.meetLink, 80); }
      if (input.active !== undefined) patch.active = Boolean(input.active);
      return view(await store.update('circles', c.id, patch), null, didi);
    },

    async hosted(didi) {
      const mine = (await store.list('circles')).filter((c) => c.didiId === didi.id);
      return { circles: mine.map((c) => view(c, null, didi)), monthly: mine.filter((c) => c.active).reduce((s, c) => s + c.fee * c.members.length, 0) };
    },

    async topic(didi, id) {
      const c = await circle(id);
      if (c.didiId !== didi.id) throw bad('That circle is not yours.', 404);
      const { day } = localClock(clock());
      const fallback = FALLBACK_TOPICS[day % FALLBACK_TOPICS.length];
      if (!llm?.understand) return { topic: fallback, questions: [] };
      try {
        const lang = c.language === 'mr' ? 'Marathi' : c.language === 'hi' ? 'Hindi' : 'English';
        const out = await llm.understand({
          system: `You suggest a warm, gentle conversation topic for a 30-minute video circle of 5 to 8 elders in India, hosted by a caregiver. Avoid health, politics and religion debates. Reply only JSON {"topic": string, "questions": [string, string, string]} in ${lang}.`,
          prompt: `Today is ${localClock(clock()).date}. Suggest today's topic.`,
        });
        if (out?.topic) return { topic: String(out.topic).slice(0, 120), questions: (out.questions ?? []).slice(0, 3).map((q) => String(q).slice(0, 160)) };
      } catch { }
      return { topic: fallback, questions: [] };
    },

    async near(householdId) {
      const me = await services.forHousehold(householdId).elder();
      const city = String(me?.city ?? '').toLowerCase();
      const all = (await store.list('circles')).filter((c) => c.active && (!city || c.city.toLowerCase() === city || c.members.some((m) => m.householdId === householdId)));
      const out = [];
      for (const c of all) out.push(view(c, householdId, await store.get('didis', c.didiId)));
      return out.sort((a, b) => Number(b.joined) - Number(a.joined) || Number(b.language === me?.language) - Number(a.language === me?.language) || a.time.localeCompare(b.time));
    },

    async join(householdId, id) {
      const c = await circle(id);
      if (!c.active) throw bad('This circle is paused.', 409);
      if (c.members.some((m) => m.householdId === householdId)) return view(c, householdId, await store.get('didis', c.didiId));
      if (c.members.length >= c.maxMembers) throw bad('This circle is full. Try another time.', 409);
      const updated = await store.update('circles', c.id, { members: [...c.members, { householdId, joinedAt: clock().toISOString(), paidMonths: [] }] });
      return view(updated, householdId, await store.get('didis', c.didiId));
    },

    async leave(householdId, id) {
      const c = await circle(id);
      return view(await store.update('circles', c.id, { members: c.members.filter((m) => m.householdId !== householdId) }), householdId, await store.get('didis', c.didiId));
    },

    async paid(householdId, id) {
      const c = await circle(id);
      const members = c.members.map((m) => (m.householdId === householdId ? { ...m, paidMonths: [...new Set([...(m.paidMonths ?? []), month()])] } : m));
      if (!c.members.some((m) => m.householdId === householdId)) throw bad('Join the circle first.', 409);
      return view(await store.update('circles', c.id, { members }), householdId, await store.get('didis', c.didiId));
    },

    async today(householdId) {
      const { day, time } = localClock(clock());
      return (await store.list('circles'))
        .filter((c) => c.active && c.days.includes(day) && c.members.some((m) => m.householdId === householdId))
        .map((c) => ({ id: c.id, title: c.title, time: c.time, meetLink: c.meetLink, now: Math.abs(minutes(time) - minutes(c.time)) <= 30 }))
        .sort((a, b) => a.time.localeCompare(b.time));
    },

    async attend(householdId, id) {
      const c = await circle(id);
      if (!c.members.some((m) => m.householdId === householdId)) throw bad('Join the circle first.', 409);
      const { date } = localClock(clock());
      const saathi = services.forHousehold(householdId);
      const records = await saathi.featureStore('sangatAttendance');
      const key = `${c.id}-${date}`;
      if (!(await records.get(key))) {
        await records.put({ id: key, circleId: c.id, date, at: clock().toISOString() });
        const me = await saathi.elder();
        await saathi.notifyFamilyAbout({ subject: `${me.preferredName} joined today's chai circle`, english: `${me.preferredName} joined "${c.title}" on Saathi Sangat today.` });
      }
      return { meetLink: c.meetLink };
    },

    async sweep() {
      const { day, date, time } = localClock(clock());
      let sent = 0;
      for (const c of await store.list('circles')) {
        if (!c.active || !c.days.includes(day) || c.remindedOn === date) continue;
        const until = minutes(c.time) - minutes(time);
        if (until < 0 || until > leadMinutes) continue;
        await store.update('circles', c.id, { remindedOn: date });
        for (const m of c.members) {
          await services.forHousehold(m.householdId).sangatReminder?.({ circleId: c.id, title: c.title, time: c.time }).catch(() => {});
          sent += 1;
        }
      }
      return sent;
    },
  };
}
