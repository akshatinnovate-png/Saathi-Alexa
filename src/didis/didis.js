import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const KINDS = ['escort', 'visit', 'refill', 'tech'];
const KIND_NAME = { escort: 'Doctor escort', visit: 'Company visit', refill: 'Tablet refill', tech: 'Help with phone and forms' };
const OPEN = ['open', 'offered'];
const LANGS = ['en', 'hi', 'mr'];

export const LESSONS = [
  {
    id: 'standing',
    title: { en: 'Helping someone stand safely', hi: 'किसी को सुरक्षित खड़ा करना', mr: 'एखाद्याला सुरक्षितपणे उभं करणं' },
    text: {
      en: 'Ask before you help. Let them sit at the edge of the chair, feet flat, then rise on the count of three while you steady them at the waist, never by the arm. Wait a moment before walking, in case they feel dizzy.',
      hi: 'मदद करने से पहले पूछिए। उन्हें कुर्सी के किनारे बैठने दीजिए, पैर ज़मीन पर, फिर तीन गिनकर उठें और आप कमर से सहारा दें, बाँह से कभी नहीं। चलने से पहले एक पल रुकिए, कहीं चक्कर न आए।',
      mr: 'मदत करण्यापूर्वी विचारा. त्यांना खुर्चीच्या कडेला बसू द्या, पाय जमिनीवर, मग तीन मोजून उठू द्या आणि तुम्ही कमरेला आधार द्या, हाताला कधीच नाही. चालण्यापूर्वी क्षणभर थांबा, चक्कर येऊ नये म्हणून.',
    },
    question: { en: 'Where should you steady them?', hi: 'आपको उन्हें कहाँ से सहारा देना चाहिए?', mr: 'त्यांना कुठे आधार द्यायचा?' },
    options: { en: ['By the arm', 'At the waist', 'By the shoulders'], hi: ['बाँह से', 'कमर से', 'कंधों से'], mr: ['हाताला', 'कमरेला', 'खांद्यांना'] },
    answer: 1,
  },
  {
    id: 'doses',
    title: { en: 'Tablets and missed doses', hi: 'दवाएँ और छूटी हुई खुराक', mr: 'गोळ्या आणि चुकलेला डोस' },
    text: {
      en: 'Never give a tablet that Saathi shows as already taken, and never double a missed dose. If a dose was missed, tell the family in your visit note; they will ask the doctor.',
      hi: 'जो दवा साथी में पहले ही ली हुई दिखे, वह कभी न दें, और छूटी खुराक कभी दोगुनी न करें। अगर खुराक छूटी हो, तो विज़िट नोट में परिवार को बताइए; वे डॉक्टर से पूछेंगे।',
      mr: 'साथीमध्ये आधीच घेतलेली दिसणारी गोळी कधीही देऊ नका, आणि चुकलेला डोस कधीच दुप्पट करू नका. डोस चुकला असेल तर भेटीच्या नोंदीत घरच्यांना सांगा; ते डॉक्टरांना विचारतील.',
    },
    question: { en: 'A dose was missed this morning. What do you do?', hi: 'सुबह की खुराक छूट गई। आप क्या करेंगी?', mr: 'सकाळचा डोस चुकला. तुम्ही काय कराल?' },
    options: { en: ['Give two at lunch', 'Tell the family in the visit note', 'Skip all tablets today'], hi: ['दोपहर को दो दें', 'विज़िट नोट में परिवार को बताएँ', 'आज सारी दवाएँ छोड़ दें'], mr: ['दुपारी दोन द्या', 'भेटीच्या नोंदीत घरच्यांना सांगा', 'आज सगळ्या गोळ्या टाळा'] },
    answer: 1,
  },
  {
    id: 'scams',
    title: { en: 'Spotting a scam call', hi: 'धोखे वाले कॉल को पहचानना', mr: 'फसव्या कॉलला ओळखणं' },
    text: {
      en: 'Banks, police and companies never ask for an OTP, a PIN, an app install or money on a call, and police never arrest anyone on a video call. If someone asks, help the elder hang up and tell the family.',
      hi: 'बैंक, पुलिस या कंपनियाँ कॉल पर कभी OTP, PIN, ऐप डालना या पैसे नहीं माँगतीं, और पुलिस कभी वीडियो कॉल पर गिरफ़्तार नहीं करती। अगर कोई माँगे, तो फ़ोन रखवाइए और परिवार को बताइए।',
      mr: 'बँक, पोलीस किंवा कंपन्या कॉलवर कधीही OTP, PIN, ॲप टाकणं किंवा पैसे मागत नाहीत, आणि पोलीस व्हिडिओ कॉलवर कधीच अटक करत नाहीत. कोणी मागितलं तर फोन ठेवायला मदत करा आणि घरच्यांना सांगा.',
    },
    question: { en: 'A caller says he is from the bank and needs the OTP. What is it?', hi: 'कॉल करने वाला कहता है कि वह बैंक से है और OTP चाहिए। यह क्या है?', mr: 'कॉल करणारा म्हणतो तो बँकेतून आहे आणि OTP हवा आहे. हे काय आहे?' },
    options: { en: ['A normal bank check', 'A scam', 'Fine if he is polite'], hi: ['सामान्य बैंक जाँच', 'धोखा', 'अगर विनम्र है तो ठीक'], mr: ['सामान्य बँक तपासणी', 'फसवणूक', 'नम्र असेल तर ठीक'] },
    answer: 1,
  },
];

const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
const clean = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const langOf = (l) => (LANGS.includes(l) ? l : 'en');

const esc = (v) => String(v ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);

export function cardSvg({ name, area, skills, languages, rating, visits, verified }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
<rect width="800" height="1000" fill="#f6efe2"/><rect x="24" y="24" width="752" height="952" rx="36" fill="none" stroke="#e98a1f" stroke-width="6"/>
<circle cx="400" cy="250" r="120" fill="#fbe7cf"/><text x="400" y="290" font-size="120" text-anchor="middle" font-family="serif" fill="#7a3e06">${esc(String(name).trim().charAt(0).toUpperCase())}</text>
<text x="400" y="460" font-size="64" text-anchor="middle" font-family="serif" fill="#16181d">${esc(name)}</text>
<text x="400" y="525" font-size="34" text-anchor="middle" font-family="sans-serif" fill="#12703a">Saathi Didi${verified ? ' · Verified' : ''}</text>
<text x="400" y="610" font-size="30" text-anchor="middle" font-family="sans-serif" fill="#16181d">${esc(skills)}</text>
<text x="400" y="665" font-size="30" text-anchor="middle" font-family="sans-serif" fill="#4a4f5c">Speaks ${esc(languages)}</text>
<text x="400" y="720" font-size="30" text-anchor="middle" font-family="sans-serif" fill="#4a4f5c">${esc(area)}</text>
<text x="400" y="800" font-size="30" text-anchor="middle" font-family="sans-serif" fill="#7a3e06">${rating ? `★ ${esc(rating)} · ` : ''}${esc(visits)} visits</text>
<text x="400" y="920" font-size="26" text-anchor="middle" font-family="sans-serif" fill="#4a4f5c">Book me in the Saathi family app</text>
</svg>`;
}

export function upiLink({ upiId, name, amount, note }) {
  const params = new URLSearchParams({ pa: upiId, pn: name, cu: 'INR', ...(amount ? { am: String(amount) } : {}), ...(note ? { tn: note.slice(0, 50) } : {}) });
  return `upi://pay?${params}`;
}

export const VISIT_MINUTES = { escort: 240, visit: 150, refill: 120, tech: 120 };

export function createDidis({ store, services, translator = null, llm = null, maps = null, images = null, onEvent = async () => {}, clock = () => new Date(), partnerCodes = [], maxMinutes = 40 }) {
  const codes = new Set(partnerCodes.map((c) => String(c).trim()).filter(Boolean));
  const now = () => clock().toISOString();
  const saathiFor = (householdId) => services.forHousehold(householdId);

  const publicView = (d) => ({
    id: d.id, name: d.name, languages: d.languages, city: d.city, area: d.area ?? null, skills: d.skills, rates: d.rates,
    verified: d.verified, ready: isReady(d), visits: d.visits ?? 0,
    rating: d.ratings?.length ? Math.round((d.ratings.reduce((a, r) => a + r, 0) / d.ratings.length) * 10) / 10 : null,
    reviews: (d.reviews ?? []).slice(-3),
  });
  const isReady = (d) => Boolean(d.verified && LESSONS.every((l) => d.lessons?.includes(l.id)));

  async function translate(text, to, from = 'auto') {
    if (!text || !translator || to === from) return text;
    try { return (await translator.translate(text, { from, to })).text ?? text; } catch { return text; }
  }

  async function mine(didiId, bookingId) {
    const b = await store.get('didiBookings', String(bookingId));
    if (!b || b.didiId !== didiId) throw bad('That booking is not yours.', 404);
    return b;
  }

  async function family(householdId, bookingId) {
    const b = await store.get('didiBookings', String(bookingId));
    if (!b || b.householdId !== householdId) throw bad('No such booking.', 404);
    return b;
  }

  function bookingView(b, didi = null) {
    return {
      id: b.id, kind: b.kind, kindName: KIND_NAME[b.kind], at: b.at, status: b.status, notes: b.notes, city: b.city,
      didi: didi ? { id: didi.id, name: didi.name, upiId: didi.upiId ?? null } : null,
      fee: b.fee, note: b.visitNote ?? null, paidAt: b.paidAt ?? null, rating: b.rating ?? null,
      checkInAt: b.checkInAt ?? null, checkOutAt: b.checkOutAt ?? null, createdAt: b.createdAt,
      familyRating: b.familyRating ?? null, sos: (b.sos ?? []).length,
      payLink: didi?.upiId && b.status === 'done' && !b.paidAt ? upiLink({ upiId: didi.upiId, name: didi.name, amount: b.fee, note: `Saathi ${KIND_NAME[b.kind]}` }) : null,
    };
  }

  return {
    lessons: (language) => {
      const l = langOf(language);
      return LESSONS.map((x) => ({ id: x.id, title: x.title[l], text: x.text[l], question: x.question[l], options: x.options[l] }));
    },

    async signUp(input = {}) {
      const name = clean(input.name, 60);
      const phone = clean(input.phone, 20).replace(/[^\d+]/g, '');
      const city = clean(input.city, 60);
      const area = clean(input.area, 120);
      const contactName = clean(input.safetyContact?.name, 60);
      const contactPhone = clean(input.safetyContact?.phone, 20).replace(/[^\d+]/g, '');
      if (contactPhone && !/^\+?\d{10,14}$/.test(contactPhone)) throw bad('Check your safety contact\'s number.');
      if (!name) throw bad('Tell us your name.');
      if (!/^\+?\d{10,14}$/.test(phone)) throw bad('Enter your mobile number.');
      if (!city) throw bad('Tell us your town or city.');
      const languages = (Array.isArray(input.languages) ? input.languages : []).filter((l) => LANGS.includes(l));
      const skills = (Array.isArray(input.skills) ? input.skills : []).filter((k) => KINDS.includes(k));
      const rates = Object.fromEntries(skills.map((k) => [k, Math.max(0, Math.round(Number(input.rates?.[k]) || 0))]));
      if (!skills.length) throw bad('Choose at least one kind of help you offer.');
      if (skills.some((k) => !rates[k])) throw bad('Set your fee for each kind of help you offer.');
      const upiId = clean(input.upiId, 60);
      if (upiId && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) throw bad('That UPI ID does not look right (it looks like name@bank).');
      if ((await store.list('didis')).some((d) => d.phone === phone)) throw bad('This number already has a Saathi Didi account.');
      const token = `didi_${randomBytes(24).toString('base64url')}`;
      const didi = {
        id: `didi-${randomUUID().slice(0, 8)}`, name, phone, city, area: area || null, languages: languages.length ? languages : ['hi'], skills, rates, upiId: upiId || null,
        safetyContact: contactPhone ? { name: contactName || null, phone: contactPhone } : null,
        phoneVerified: Boolean(input.verifiedPhone && input.verifiedPhone === phone), blockedHouseholds: [],
        verified: codes.has(clean(input.partnerCode, 40)), lessons: [], visits: 0, ratings: [], reviews: [], createdAt: now(),
      };
      await store.put('didis', didi);
      await store.put('didiTokens', { id: hash(token), didiId: didi.id, createdAt: now() });
      return { didi: { ...publicView(didi), phone, upiId: didi.upiId }, token };
    },

    async byToken(token) {
      if (!token) return null;
      const t = await store.get('didiTokens', hash(token));
      return t ? store.get('didis', t.didiId) : null;
    },

    me: (didi) => ({ ...publicView(didi), phone: didi.phone, upiId: didi.upiId, lessonsDone: didi.lessons ?? [], safetyContact: didi.safetyContact ?? null, phoneVerified: Boolean(didi.phoneVerified) }),

    async byPhone(phone) {
      const p = String(phone ?? '').replace(/[^\d+]/g, '');
      if (!p) return null;
      const tail = p.slice(-10);
      return (await store.list('didis')).find((d) => d.phone === p || d.phone.slice(-10) === tail) ?? null;
    },

    async newToken(didi) {
      const token = `didi_${randomBytes(24).toString('base64url')}`;
      await store.put('didiTokens', { id: hash(token), didiId: didi.id, createdAt: now() });
      if (!didi.phoneVerified) await store.update('didis', didi.id, { phoneVerified: true });
      return token;
    },

    async updateSafety(didi, { name, phone } = {}) {
      const p = clean(phone, 20).replace(/[^\d+]/g, '');
      if (p && !/^\+?\d{10,14}$/.test(p)) throw bad('Check your safety contact\'s number.');
      await store.update('didis', didi.id, { safetyContact: p ? { name: clean(name, 60) || null, phone: p } : null });
      return { safetyContact: p ? { name: clean(name, 60) || null, phone: p } : null };
    },

    async answerLesson(didi, lessonId, answer) {
      const lesson = LESSONS.find((l) => l.id === lessonId);
      if (!lesson) throw bad('No such lesson.', 404);
      const correct = Number(answer) === lesson.answer;
      const current = await store.get('didis', didi.id);
      if (correct && !current.lessons.includes(lesson.id)) await store.update('didis', didi.id, { lessons: [...current.lessons, lesson.id] });
      const fresh = await store.get('didis', didi.id);
      return { correct, ready: isReady(fresh), lessonsDone: fresh.lessons };
    },

    async search(householdId) {
      const me = await saathiFor(householdId).elder();
      const city = String(me?.city ?? '').toLowerCase();
      const ready = (await store.list('didis')).filter(isReady);
      const byRating = (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.visits - a.visits;
      if (maps && me?.home) {
        try {
          const minutes = await maps.travelMinutes(ready.map((d) => [d.area, d.city].filter(Boolean).join(', ')), [me.home, me.city].filter(Boolean).join(', '));
          return ready
            .map((d, i) => ({ ...publicView(d), minutesAway: minutes[i] }))
            .filter((d) => d.minutesAway !== null && d.minutesAway <= maxMinutes)
            .sort((a, b) => a.minutesAway - b.minutesAway || byRating(a, b));
        } catch { }
      }
      return ready
        .filter((d) => !city || d.city.toLowerCase() === city)
        .map(publicView)
        .sort(byRating);
    },

    async book(householdId, input = {}, by = null) {
      const kind = KINDS.includes(input.kind) ? input.kind : null;
      if (!kind) throw bad('Choose what you need: a doctor escort, a visit, a refill or help with the phone.');
      const at = clean(input.at, 16);
      if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw bad('Choose a date and time.');
      const me = await saathiFor(householdId).elder();
      let didi = null;
      if (input.didiId) {
        didi = await store.get('didis', String(input.didiId));
        if (!didi || !isReady(didi)) throw bad('That Didi is not available.', 404);
        if (!didi.skills.includes(kind)) throw bad(`${didi.name} does not offer this kind of help.`);
      }
      const booking = {
        id: `book-${randomUUID().slice(0, 8)}`, householdId, kind, at, city: me?.city ?? '', notes: clean(input.notes, 300),
        appointmentId: input.appointmentId ? String(input.appointmentId) : null,
        share: { medicines: input.share?.medicines !== false, mood: Boolean(input.share?.mood) },
        didiId: didi?.id ?? null, status: didi ? 'offered' : 'open', fee: didi ? didi.rates[kind] : null,
        bookedBy: by, createdAt: now(),
      };
      await store.put('didiBookings', booking);
      const nearby = didi ? [didi.id] : (await store.list('didis')).filter((d) => isReady(d) && d.skills.includes(kind) && d.city.toLowerCase() === String(booking.city).toLowerCase() && !(d.blockedHouseholds ?? []).includes(householdId)).map((d) => d.id);
      await onEvent('offer', { booking: bookingView(booking, didi), didiIds: nearby }).catch(() => {});
      return bookingView(booking, didi);
    },

    async bookings(householdId) {
      const list = (await store.list('didiBookings')).filter((b) => b.householdId === householdId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return Promise.all(list.map(async (b) => bookingView(b, b.didiId ? await store.get('didis', b.didiId) : null)));
    },

    async offers(didi) {
      if (!isReady(didi)) return [];
      const all = await store.list('didiBookings');
      const blocked = didi.blockedHouseholds ?? [];
      const list = all.filter((b) => !blocked.includes(b.householdId) && ((b.status === 'offered' && b.didiId === didi.id)
        || (b.status === 'open' && b.city.toLowerCase() === didi.city.toLowerCase() && didi.skills.includes(b.kind))));
      const familyRating = (householdId) => {
        const r = all.filter((b) => b.householdId === householdId && b.familyRating).map((b) => b.familyRating.stars);
        return r.length ? { stars: Math.round((r.reduce((a, x) => a + x, 0) / r.length) * 10) / 10, count: r.length } : null;
      };
      return list.sort((a, b) => a.at.localeCompare(b.at)).map((b) => ({ ...bookingView(b), fee: b.fee ?? didi.rates[b.kind], familyRating: familyRating(b.householdId) }));
    },

    async accept(didi, bookingId) {
      if (!isReady(didi)) throw bad('Finish verification and the three lessons first.', 403);
      const b = await store.get('didiBookings', String(bookingId));
      if (!b || !OPEN.includes(b.status) || (b.didiId && b.didiId !== didi.id)) throw bad('This booking is no longer available.', 409);
      if (!didi.skills.includes(b.kind)) throw bad('You do not offer this kind of help.');
      const accepted = await store.update('didiBookings', b.id, { status: 'accepted', didiId: didi.id, fee: b.fee ?? didi.rates[b.kind], acceptedAt: now() });
      await saathiFor(b.householdId).didiUpdate({ stage: 'accepted', didiName: didi.name, kind: b.kind, at: b.at });
      return bookingView(accepted, didi);
    },

    async myBookings(didi) {
      return (await store.list('didiBookings')).filter((b) => b.didiId === didi.id && !OPEN.includes(b.status)).sort((a, b) => b.at.localeCompare(a.at)).map((b) => bookingView(b));
    },

    async briefing(didi, bookingId) {
      const b = await mine(didi.id, bookingId);
      const facts = await saathiFor(b.householdId).didiBriefingFacts({ share: b.share, appointmentId: b.appointmentId });
      const lang = langOf(didi.languages[0]);
      const lines = [
        `${KIND_NAME[b.kind]} for ${facts.name}, ${String(b.at).replace('T', ' at ')}.`,
        `Address: ${facts.home}.`,
        facts.appointment ? `Doctor: ${facts.appointment.with}, ${facts.appointment.place}, ${String(facts.appointment.at).replace('T', ' at ')}.` : null,
        facts.medicines?.length ? `Tablets: ${facts.medicines.map((m) => `${m.name} (${m.purpose}) at ${m.times.join(' and ')}${m.withFood ? ', with food' : ''}`).join('; ')}. Never give a tablet twice.` : null,
        facts.mood ? `Latest check-in: ${String(facts.mood.sentiment).toLowerCase()}${facts.mood.concerns.length ? ` (${facts.mood.concerns.join(', ')})` : ''}.` : null,
        facts.accessibility?.hearing === 'mild-loss' ? 'She hears a little less: speak slowly and face her.' : null,
        facts.accessibility?.memorySupport ? 'Her memory needs support: introduce yourself every time, gently.' : null,
        b.notes ? `From the family: ${b.notes}` : null,
        `Emergency number: ${facts.emergencyNumber ?? '112'}.`,
      ].filter(Boolean);
      let text = lines.join('\n');
      if (llm) {
        try {
          const r = await llm.create({ max_tokens: 500, system: `Rewrite this visit briefing for a caregiver as short, warm, practical points in ${lang === 'mr' ? 'Marathi' : lang === 'hi' ? 'Hindi' : 'English'}. Keep every fact exactly; add nothing.`, messages: [{ role: 'user', content: text }] });
          const out = r.content.filter((x) => x.type === 'text').map((x) => x.text).join('').trim();
          if (out) return { language: lang, text: out, facts };
        } catch { }
      }
      text = await translate(text, lang, 'en');
      return { language: lang, text, facts };
    },

    async checkIn(didi, bookingId) {
      const b = await mine(didi.id, bookingId);
      if (b.status !== 'accepted') throw bad('Check in when you arrive for an accepted booking.', 409);
      const updated = await store.update('didiBookings', b.id, { status: 'in-progress', checkInAt: now() });
      await saathiFor(b.householdId).didiUpdate({ stage: 'arrived', didiName: didi.name, kind: b.kind });
      return bookingView(updated);
    },

    async checkOut(didi, bookingId, { note, language } = {}) {
      const b = await mine(didi.id, bookingId);
      if (b.status !== 'in-progress') throw bad('Check in before you finish the visit.', 409);
      const text = clean(note, 600);
      const lang = langOf(language ?? didi.languages[0]);
      const out = await saathiFor(b.householdId).didiUpdate({ stage: 'done', didiName: didi.name, kind: b.kind, note: text || null, noteLanguage: lang });
      const updated = await store.update('didiBookings', b.id, { status: 'done', checkOutAt: now(), visitNote: text ? { text, language: lang, english: out.english } : null });
      await store.update('didis', didi.id, { visits: (didi.visits ?? 0) + 1 });
      return bookingView(updated);
    },

    async sos(didi, bookingId, { note, language } = {}) {
      const b = await mine(didi.id, bookingId);
      if (!['accepted', 'in-progress'].includes(b.status)) throw bad('SOS works during an accepted visit. In an emergency call 112.', 409);
      const text = clean(note, 300);
      const lang = langOf(language ?? didi.languages[0]);
      await saathiFor(b.householdId).didiUpdate({ stage: 'sos', didiName: didi.name, kind: b.kind, note: text || null, noteLanguage: lang, safetyContact: didi.safetyContact });
      await store.update('didiBookings', b.id, { sos: [...(b.sos ?? []), { at: now(), note: text || null }] });
      await onEvent('sos', { didi: { id: didi.id, name: didi.name, phone: didi.phone, safetyContact: didi.safetyContact ?? null }, bookingId: b.id, householdId: b.householdId }).catch(() => {});
      return { sent: true, call: [{ label: 'Emergency', number: '112' }, ...(didi.safetyContact?.phone ? [{ label: didi.safetyContact.name ?? 'Safety contact', number: didi.safetyContact.phone }] : [])] };
    },

    async rateFamily(didi, bookingId, { stars, note, block = false } = {}) {
      const b = await mine(didi.id, bookingId);
      if (b.status !== 'done') throw bad('Rate the family after the visit.', 409);
      if (b.familyRating) throw bad('You already rated this visit.', 409);
      const n = Math.round(Number(stars));
      if (!(n >= 1 && n <= 5)) throw bad('Choose 1 to 5 stars.');
      await store.update('didiBookings', b.id, { familyRating: { stars: n, note: clean(note, 200) || null } });
      if (block) await store.update('didis', didi.id, { blockedHouseholds: [...new Set([...(didi.blockedHouseholds ?? []), b.householdId])] });
      return { rated: n, blocked: Boolean(block) };
    },

    async sweepOverdue() {
      const late = (await store.list('didiBookings')).filter((b) => b.status === 'in-progress' && !b.overdueAlertedAt && b.checkInAt
        && clock().getTime() - Date.parse(b.checkInAt) > (VISIT_MINUTES[b.kind] ?? 150) * 60_000);
      for (const b of late) {
        const didi = await store.get('didis', b.didiId);
        await saathiFor(b.householdId).didiUpdate({ stage: 'overdue', didiName: didi?.name ?? 'The Didi', kind: b.kind });
        await store.update('didiBookings', b.id, { overdueAlertedAt: now() });
        await onEvent('overdue', { didiIds: [b.didiId], bookingId: b.id }).catch(() => {});
      }
      return late.length;
    },

    async card(didi) {
      const view = publicView(didi);
      const skills = didi.skills.map((k) => KIND_NAME[k]).join(', ');
      const langNames = { en: 'English', hi: 'Hindi', mr: 'Marathi' };
      const lines = { name: didi.name, area: [didi.area, didi.city].filter(Boolean).join(', '), skills, languages: didi.languages.map((l) => langNames[l] ?? l).join(', '), rating: view.rating, visits: view.visits, verified: didi.verified };
      if (images) {
        try {
          const img = await images.generate(`A warm, dignified illustrated profile card (4:5) for a woman caregiver in India named ${lines.name}, a verified "Saathi Didi". Folk-art style border with marigolds and jasmine, cream background, no photo of a real person: an abstract illustration of caring hands and a teacup. Large readable text: "${lines.name}", "Saathi Didi${lines.verified ? ' · Verified' : ''}", "${lines.skills}", "Speaks ${lines.languages}", "${lines.area}". Keep all text exactly as written.`);
          if (img) return { ...img, lines };
        } catch { }
      }
      return { data: Buffer.from(cardSvg(lines)), contentType: 'image/svg+xml', lines };
    },

    async cancel(householdId, bookingId) {
      const b = await family(householdId, bookingId);
      if (['done', 'cancelled', 'in-progress'].includes(b.status)) throw bad('This booking cannot be cancelled now.', 409);
      return bookingView(await store.update('didiBookings', b.id, { status: 'cancelled', cancelledAt: now() }));
    },

    async markPaid(householdId, bookingId) {
      const b = await family(householdId, bookingId);
      if (b.status !== 'done') throw bad('Pay after the visit is done.', 409);
      return bookingView(await store.update('didiBookings', b.id, { paidAt: b.paidAt ?? now() }), await store.get('didis', b.didiId));
    },

    async rate(householdId, bookingId, { stars, review } = {}) {
      const b = await family(householdId, bookingId);
      if (b.status !== 'done') throw bad('Rate after the visit is done.', 409);
      if (b.rating) throw bad('This visit is already rated.', 409);
      const n = Math.round(Number(stars));
      if (!(n >= 1 && n <= 5)) throw bad('Choose 1 to 5 stars.');
      const didi = await store.get('didis', b.didiId);
      const words = clean(review, 200);
      await store.update('didis', didi.id, { ratings: [...(didi.ratings ?? []), n], reviews: words ? [...(didi.reviews ?? []), words].slice(-20) : didi.reviews ?? [] });
      return bookingView(await store.update('didiBookings', b.id, { rating: n }), didi);
    },

    async earnings(didi, month = now().slice(0, 7)) {
      const done = (await store.list('didiBookings')).filter((b) => b.didiId === didi.id && b.status === 'done');
      const inMonth = done.filter((b) => String(b.checkOutAt ?? '').startsWith(month));
      const paid = inMonth.filter((b) => b.paidAt);
      return {
        month, visits: inMonth.length, earned: inMonth.reduce((s, b) => s + (b.fee ?? 0), 0), paid: paid.reduce((s, b) => s + (b.fee ?? 0), 0),
        allTimeVisits: done.length, rating: publicView(didi).rating, reviews: (didi.reviews ?? []).slice(-5),
        byKind: Object.fromEntries(KINDS.map((k) => [k, inMonth.filter((b) => b.kind === k).length])),
      };
    },
  };
}
