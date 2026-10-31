import { assessConcerns } from './safety.js';
import { DEFAULT_HOUSEHOLD, collectionFor } from '../households/scope.js';
import { languageName, LANGUAGES } from './languages.js';
import { t, spokenLanguage, partOfDayName, joinNames, localized, localDigits } from './i18n.js';
import { pronounsOf, emergencyNumberFor, isTimeZone, PRONOUNS, COUNTRIES } from './people.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

export function createSaathi(deps) {
  const { store, translator, sentiment, speech, events, notifier, media, metrics, config } = deps;
  const clock = deps.clock ?? (() => new Date());
  let tz = config.timezone;

  function localParts(date = clock()) {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long',
    });
    const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      time: `${p.hour}:${p.minute}`,
      minutes: Number(p.hour) * 60 + Number(p.minute),
      weekday: p.weekday,
      dayIndex: DAY_NAMES.indexOf(p.weekday),
    };
  }
  const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const partOfDay = (m) => (m < 720 ? 'morning' : m < 1020 ? 'afternoon' : m < 1260 ? 'evening' : 'night');
  const id = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  async function elder() {
    const me = await store.get('profile', 'elder');
    tz = me?.timezone && isTimeZone(me.timezone) ? me.timezone : config.timezone;
    return me;
  }

  async function voice(language) {
    const me = await elder();
    return { me, lang: spokenLanguage(language ?? me.language) };
  }

  async function translateTo(text, to, from = 'auto') {
    try {
      return await translator.translate(text, { from, to });
    } catch (err) {
      metrics.emit('TranslationFailure', 1, { engine: translator.kind });
      return { text, from, to, translated: false, engine: 'error', error: err.message };
    }
  }

  const timesOf = (m) => [...new Set((Array.isArray(m.times) && m.times.length ? m.times : [m.time]).filter((x) => /^\d{2}:\d{2}$/.test(x ?? '')))].sort();
  const takesOn = (m, dayIndex) => !Array.isArray(m.days) || !m.days.length || m.days.includes(dayIndex);
  const perDay = (m) => timesOf(m).length * (Array.isArray(m.days) && m.days.length ? m.days.length / 7 : 1) || 1;
  const daysLeftOf = (m) => (m.supply ? Math.floor(m.supply.remaining / perDay(m)) : null);
  const dayIndexOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

  async function schedule(dayIndex) {
    const me = await elder();
    const meds = await store.list('medications');
    const tablets = meds.filter((m) => takesOn(m, dayIndex)).flatMap((m) => timesOf(m).map((time) => ({
      time, activity: m.short ?? `${m.purpose} tablet`, medicationId: m.id,
      i18n: Object.fromEntries(Object.entries(m.i18n ?? {}).filter(([, v]) => v.short).map(([l, v]) => [l, { activity: v.short }])),
    })));
    return [...tablets, ...(me?.routine ?? []).filter((r) => !r.medicationId)];
  }

  async function orientation({ language } = {}) {
    const { me, lang } = await voice(language);
    const now = localParts();
    const upcoming = (await schedule(now.dayIndex))
      .filter((r) => (!r.days || r.days.includes(now.dayIndex)) && toMinutes(r.time) >= now.minutes)
      .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
    const longDate = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(clock());
    const spokenDate = lang === 'en' ? longDate
      : new Intl.DateTimeFormat(LANGUAGES[lang].bcp47, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(clock());
    const next = upcoming[0];
    const soon = await upcomingAppointments({ language: lang, days: 1 });
    return {
      greetingName: me.preferredName,
      today: longDate,
      time: now.time,
      partOfDay: partOfDay(now.minutes),
      place: me.home,
      next: upcoming[0] ?? null,
      laterToday: upcoming.slice(1, 4),
      sayLanguage: lang,
      say: localDigits(lang, t(lang, 'orient', { date: spokenDate, time: now.time, part: partOfDayName(lang, partOfDay(now.minutes)), home: localized(me, 'home', lang) })
        + (next ? t(lang, 'orientNext', { activity: localized(next, 'activity', lang), time: next.time }) : t(lang, 'orientRest')))
        + (soon.appointments.some((a) => a.daysAway <= 1) ? ` ${soon.say}` : ''),
    };
  }

  async function whoIs(query, { language } = {}) {
    const { lang } = await voice(language);
    const q = query.toLowerCase().trim();
    const circle = await store.list('circle');
    const person = circle.find((p) => [p.name, p.relationship, ...(p.aliases ?? [])].some((n) => q.includes(n.toLowerCase())) || p.name.toLowerCase().includes(q));
    if (!person) {
      return { found: false, sayLanguage: lang, say: t(lang, 'whoNotFound', { query }), circle: circle.map((p) => `${p.name} (${p.relationship})`) };
    }
    const messages = (await store.list('messages')).filter((m) => m.from === person.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const routine = ((await elder()).routine ?? []).filter((r) => r.activity.includes(person.name));
    return {
      found: true,
      person: { name: person.name, relationship: person.relationship, city: person.city },
      sayLanguage: lang,
      say: localized(person, 'aboutForElder', lang),
      lastMessage: messages[0] ? { text: messages[0].text, at: messages[0].createdAt } : null,
      regularPlans: routine.map((r) => `${r.activity} at ${r.time}${r.days ? ` on ${r.days.map((d) => DAY_NAMES[d]).join(' and ')}` : ''}`),
    };
  }

  const doseFor = (doses, m, date, time) => doses.find((d) => d.medicationId === m.id && d.date === date && (d.slot ? d.slot === time : time === timesOf(m)[0]));

  async function medicationStatus() {
    const now = localParts();
    const meds = await store.list('medications');
    const doses = (await store.list('doses')).filter((d) => d.date === now.date);
    return meds.filter((m) => takesOn(m, now.dayIndex)).flatMap((m) => timesOf(m).map((time) => {
      const taken = doseFor(doses, m, now.date, time);
      const diff = now.minutes - toMinutes(time);
      const status = taken ? 'taken' : diff > 90 ? 'missed' : diff >= -30 ? 'due' : 'upcoming';
      return { ...m, time, times: timesOf(m), slot: time, slotId: `${m.id}@${time}`, status, takenAt: taken?.takenAt ?? null, daysLeft: daysLeftOf(m) };
    })).sort((a, b) => a.time.localeCompare(b.time));
  }

  async function medicationSchedule({ language } = {}) {
    const { lang } = await voice(language);
    const meds = await medicationStatus();
    const due = meds.filter((m) => m.status === 'due' || m.status === 'missed');
    const upcoming = meds.filter((m) => m.status === 'upcoming').map((m) => ({ short: localized(m, 'short', lang), time: m.time }));
    return {
      medications: meds.map(({ i18n, ...m }) => m),
      sayLanguage: lang,
      say: due.length
        ? t(lang, 'medsDue', { list: due.map((m) => localized(m, 'phrase', lang)).join(t(lang, 'medsDueJoin')), withFood: due.some((m) => m.withFood) })
        : t(lang, 'medsCaughtUp', { upcoming }),
    };
  }

  async function confirmMedication(medicationQuery, { language } = {}) {
    const { lang } = await voice(language);
    const meds = await medicationStatus();
    const q = (medicationQuery ?? '').toLowerCase();
    const names = (m) => [m.id, m.name.toLowerCase(), m.purpose, ...Object.values(m.i18n ?? {}).flatMap((v) => [v.short, v.phrase])].filter(Boolean);
    const named = meds.filter((m) => q && names(m).some((n) => n.includes(q) || q.includes(n)));
    const pool = named.length ? named : meds;
    const open = pool.filter((m) => m.status !== 'taken');
    const med = open.find((m) => m.status === 'due') ?? [...open].reverse().find((m) => m.status === 'missed')
      ?? (named.length ? open.find((m) => m.status === 'upcoming') : null) ?? (named.length ? named[named.length - 1] : null);
    if (!med) return { recorded: false, sayLanguage: lang, say: t(lang, 'medNotFound') };
    if (med.status === 'taken') return { recorded: false, alreadyTaken: true, medication: med.name, sayLanguage: lang, say: t(lang, 'medAlreadyTaken', { short: localized(med, 'short', lang), time: med.takenAt.slice(11, 16) }) };
    const now = localParts();
    const dose = { id: `${med.id}-${now.date}-${med.slot}`, medicationId: med.id, slot: med.slot, date: now.date, takenAt: `${now.date}T${now.time}`, late: med.status === 'missed' };
    await store.put('doses', dose);
    if (med.supply) {
      const supply = { ...med.supply, remaining: Math.max(0, med.supply.remaining - 1) };
      await store.update('medications', med.id, { supply });
      await checkSupply({ ...(await store.get('medications', med.id)), supply });
    }
    await events.publish('DoseTaken', { medicationId: med.id, medication: med.name, late: dose.late });
    metrics.emit('DoseTaken', 1, { late: String(dose.late) });
    return { recorded: true, medication: med.name, sayLanguage: lang, say: t(lang, 'medRecorded', { short: localized(med, 'short', lang) }) };
  }

  async function sweepMissedDoses() {
    const meds = await medicationStatus();
    const now = localParts();
    const me = await elder();
    const raised = [];
    for (const med of meds.filter((m) => m.status === 'missed')) {
      const alertId = timesOf(med).length > 1 ? `dose-${med.id}-${now.date}-${med.slot}` : `dose-${med.id}-${now.date}`;
      if (await store.get('alerts', alertId)) continue;
      const p = pronounsOf(me);
      await store.put('alerts', { id: alertId, type: 'dose-missed', severity: 'info', createdAt: clock().toISOString(), summary: `${me.preferredName} hasn't confirmed ${p.possessive} ${med.purpose} tablet (${med.time}).`, acknowledged: false });
      await events.publish('DoseMissed', { alertId, medicationId: med.id, medication: med.name });
      await notifier.notify({ audience: 'family', severity: 'info', subject: `${me.preferredName}: ${med.purpose} tablet not confirmed`, message: `${me.preferredName} hasn't confirmed ${p.possessive} ${med.name} (${med.time}). A gentle call might help.` });
      metrics.emit('DoseMissed', 1);
      raised.push(alertId);
    }
    return raised;
  }

  async function checkIn({ text, language, keepPrivate = false }) {
    const me = await elder();
    const lang = language ?? me.language;
    const say = (key) => ({ sayLanguage: spokenLanguage(lang), say: t(lang, key) });
    const mood = await sentiment.analyze(text, lang);
    const concerns = assessConcerns(text, mood);
    const english = lang === 'en' ? { text } : await translateTo(text, 'en', lang);
    const entry = { id: id('checkin'), at: clock().toISOString(), text, language: lang, english: english.text, sentiment: mood.sentiment, scores: mood.scores, concerns, private: keepPrivate };
    await store.put('checkins', entry);
    metrics.emit('CheckIn', 1, { sentiment: mood.sentiment });
    await events.publish('CheckInRecorded', { id: entry.id, sentiment: mood.sentiment, level: concerns.level });

    if (concerns.level === 'urgent') {
      const alert = (await openHelpAlert()) ?? await raiseAlert({ reason: concerns.urgent.join(', '), words: english.text, severity: 'critical', source: 'check-in' });
      return { ...entry, alertId: alert.id, ...say('checkUrgent') };
    }
    if (concerns.level === 'gentle' && keepPrivate) {
      return { ...entry, ...say('checkPrivate') };
    }
    if (concerns.level === 'gentle') {
      await events.publish('WellbeingConcern', { checkinId: entry.id, kinds: concerns.gentle, severity: 'gentle' });
      const quote = me.privacy?.shareMoodWords === false ? '' : ` ${me.preferredName} said: "${english.text}".`;
      await notifyCircle({
        audience: 'family', severity: 'gentle',
        subject: `${me.preferredName} could use a call today`,
        english: `${quote} ${pronounsOf(me).Subject} may be feeling ${concerns.gentle.join(' and ').replace('-', ' ')}. A call or a voice note from you would mean a lot.`.trim(),
      });
      const lonely = concerns.gentle.includes('loneliness') || concerns.gentle.includes('missing-family');
      return { ...entry, ...say(lonely ? 'checkLonely' : 'checkGentle') };
    }
    return { ...entry, ...say('checkFine') };
  }

  async function openHelpAlert(withinMs = 10 * 60 * 1000) {
    const now = clock().getTime();
    return (await store.list('alerts')).find((a) => a.type === 'help' && !a.acknowledged && now - new Date(a.createdAt).getTime() < withinMs) ?? null;
  }

  async function requestHelp({ reason, urgency = 'high', language }) {
    const { lang } = await voice(language);
    const existing = await openHelpAlert();
    if (existing) {
      metrics.emit('HelpRequestDeduplicated', 1);
      return { alertId: existing.id, deduplicated: true, sayLanguage: lang, say: t(lang, 'helpAlready') };
    }
    const alert = await raiseAlert({ reason, words: reason, severity: urgency === 'critical' ? 'critical' : 'high', source: 'asked-for-help' });
    return { alertId: alert.id, sayLanguage: lang, say: t(lang, 'helpStarted') };
  }

  async function raiseAlert({ reason, words, severity, source }) {
    const me = await elder();
    const circle = await store.list('circle');
    const neighbour = circle.find((p) => p.role === 'neighbour');
    const p = pronounsOf(me);
    const number = emergencyNumberFor(me);
    const alert = {
      id: id('alert'), type: 'help', source, severity, reason, words, createdAt: clock().toISOString(),
      acknowledged: false, escalationStage: 'starting',
    };
    await store.put('alerts', alert);
    const escalation = {
      alertId: alert.id,
      householdId: deps.householdId ?? DEFAULT_HOUSEHOLD,
      alertsKey: collectionFor(deps.householdId, 'alerts'),
      severity,
      subject: `Saathi: ${me.preferredName} needs you now`,
      familyMessage: `${me.preferredName} (${me.name}) needs help: ${reason}. ${p.Subject} said: "${words}". Please call ${p.object} now and press "I'm on it" in the Saathi family app.`,
      neighbourMessage: `${neighbour?.name ?? 'Neighbour'}, ${me.preferredName} in ${me.home} needs help (${reason}) and ${p.possessive} family hasn't responded yet. Please check on ${p.object}.`,
      emergencyMessage: `No one has acknowledged ${me.preferredName}'s alert (${reason}). If you cannot reach ${p.object}, call emergency services${number ? ` on ${number}` : ''}. Address: ${me.home}.`,
      familyWait: config.escalation.familyAckWaitSeconds,
      neighbourWait: config.escalation.neighbourAckWaitSeconds,
    };
    await events.publish('HelpRequested', { alertId: alert.id, severity, reason, escalation });
    metrics.emit('HelpRequested', 1, { severity, source });
    return alert;
  }

  async function acknowledgeAlert({ alertId, by }) {
    const circle = await store.list('circle');
    const member = circle.find((p) => p.id === by);
    const alert = await store.update('alerts', alertId, { acknowledged: true, acknowledgedBy: by, acknowledgedAt: clock().toISOString() });
    if (!alert) return null;
    await events.publish('AlertAcknowledged', { alertId, by });
    if (member && alert.type === 'help') {
      const { lang } = await voice();
      await deliverToElder({ fromId: member.id, text: t(lang, 'helperComing', { name: localized(member, 'name', lang) }), language: lang, system: true });
    }
    return alert;
  }

  async function deliverToElder({ fromId, text, language, system = false, extra = {} }) {
    const msg = { id: id('msg'), from: fromId, to: 'elder', language, text, createdAt: clock().toISOString(), read: false, system, ...extra };
    await store.put('messages', msg);
    await events.publish('MessageForElder', { id: msg.id, from: fromId });
    return msg;
  }

  async function familyMessages({ unreadOnly = true, markRead = true, language } = {}) {
    const { lang } = await voice(language);
    const circle = await store.list('circle');
    const all = (await store.list('messages')).filter((m) => m.to === 'elder' && (!unreadOnly || !m.read))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const out = [];
    const voiceNotes = [];
    const privateNotes = [];
    for (const m of all) {
      const sender = circle.find((p) => p.id === m.from);
      if (m.kind === 'private') {
        privateNotes.push({ id: m.id, fromId: m.from, from: localized(sender, 'name', lang) ?? m.from, language: m.language, e2e: m.e2e, at: m.createdAt });
        if (markRead && !m.read) await store.update('messages', m.id, { read: true });
        continue;
      }
      if (m.kind === 'voice') {
        voiceNotes.push({ id: m.id, from: localized(sender, 'name', lang) ?? m.from, url: await (media.playbackUrl?.(m.audio) ?? m.audio), durationSec: m.durationSec, at: m.createdAt, e2e: m.e2e ?? null });
        if (markRead && !m.read) await store.update('messages', m.id, { read: true });
        continue;
      }
      const cached = m.language === lang ? m.text : m.translations?.[lang];
      const tr = cached ? { text: cached, engine: m.language === lang ? 'none' : 'cache' } : await translateTo(m.text, lang, m.language);
      if (!cached && tr.engine !== 'passthrough' && tr.engine !== 'error' && tr.engine !== 'none') {
        await store.update('messages', m.id, { translations: { ...(m.translations ?? {}), [lang]: tr.text } });
      }
      out.push({
        id: m.id, from: sender?.name ?? m.from, relationship: sender?.relationship,
        spokenFrom: localized(sender, 'name', lang) ?? m.from, spokenRelationship: localized(sender, 'relationship', lang),
        original: m.text, originalLanguage: languageName(m.language), translated: tr.text, translatedTo: languageName(lang), translationEngine: tr.engine, at: m.createdAt, system: Boolean(m.system),
      });
      if (markRead && !m.read) await store.update('messages', m.id, { read: true });
    }
    const lines = [
      ...out.map((m) => (m.system ? m.translated : t(lang, 'messageLine', { from: m.spokenFrom, relationship: m.spokenRelationship, text: m.translated }))),
      ...voiceNotes.map((v) => t(lang, 'voiceNote', { from: v.from })),
      ...privateNotes.map((p) => t(lang, 'privateMessage', { from: p.from })),
    ];
    return {
      messages: out,
      voiceNotes,
      privateMessages: privateNotes,
      sayLanguage: lang,
      say: lines.length ? lines.join(' ') : t(lang, 'noMessages'),
    };
  }

  async function sendToFamily({ text, language, to }) {
    const me = await elder();
    const lang = language ?? me.language;
    const speak = spokenLanguage(lang);
    const circle = await store.list('circle');
    const matches = (p) => [p.name, p.relationship, ...(p.aliases ?? [])].some((n) => to.toLowerCase().includes(n.toLowerCase()));
    const recipients = to ? circle.filter(matches) : circle.filter((p) => p.role === 'family');
    if (!recipients.length) return { sent: false, sayLanguage: speak, say: t(speak, 'recipientNotFound', { to }) };
    const deliveries = [];
    for (const r of recipients) {
      const tr = await translateTo(text, r.language, lang);
      const msg = { id: id('msg'), from: 'elder', to: r.id, language: lang, text, translated: tr.text, translatedTo: r.language, createdAt: clock().toISOString() };
      await store.put('messages', msg);
      await notifier.notify({ audience: 'family', recipientId: r.id, severity: 'info', subject: `A message from ${me.preferredName}`, message: tr.text });
      deliveries.push({ to: r.name, language: languageName(r.language), text: tr.text, engine: tr.engine });
    }
    await events.publish('MessageFromElder', { recipients: recipients.map((r) => r.id) });
    metrics.emit('MessageSent', deliveries.length);
    const translated = deliveries.some((d) => d.engine !== 'none' && d.engine !== 'passthrough');
    return { sent: true, deliveries, sayLanguage: speak, say: t(speak, 'sent', { names: joinNames(speak, recipients.map((r) => localized(r, 'name', speak))), translated }) };
  }

  async function messageFromFamily({ fromId, text, language, e2e = null }) {
    const circle = await store.list('circle');
    const sender = circle.find((p) => p.id === fromId);
    if (!sender) throw invalid(`Unknown family member ${fromId}`);
    if (e2e) {
      if (!/^[A-Za-z0-9_-]{8,48}$/.test(String(e2e.itemId ?? '')) || typeof e2e.blob !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(e2e.blob) || e2e.blob.length > 200000) throw invalid('That private message is not valid.');
      return deliverToElder({ fromId, text: '🔒', language: language ?? sender.language, extra: { kind: 'private', e2e: { itemId: e2e.itemId, blob: e2e.blob } } });
    }
    return deliverToElder({ fromId, text, language: language ?? sender.language });
  }

  async function saveStory({ title, text, language, onProgress = async () => {} }) {
    const me = await elder();
    const lang = language ?? me.language;
    const circle = await store.list('circle');
    const targets = [...new Set(['en', ...circle.map((p) => p.language)])].filter((l) => l !== lang);
    const translations = { [lang]: { text, engine: 'original' } };
    const total = targets.length * 2 + 2;
    let step = 0;
    for (const l of targets) {
      await onProgress(++step, total, `Translating into ${languageName(l)}`);
      const tr = await translateTo(text, l, lang);
      translations[l] = { text: tr.text, engine: tr.engine };
    }
    const storyId = id('story');
    const audio = {};
    for (const [l, version] of Object.entries(translations)) {
      await onProgress(Math.min(++step, total - 1), total, `Narrating in ${languageName(l)}`);
      try {
        const spoken = await speech.synthesize(version.text, l, { slow: true });
        if (spoken) audio[l] = await media.save(`stories/${storyId}/${l}.mp3`, spoken.audio, spoken.contentType);
      } catch (err) {
        metrics.emit('SpeechFailure', 1, { language: l });
      }
    }
    const story = { id: storyId, title: title || `A story from ${me.preferredName}`, language: lang, text, translations, audio, createdAt: clock().toISOString() };
    await store.put('stories', story);
    await onProgress(total, total, 'Shared with the family');
    await events.publish('StoryShared', { id: story.id, title: story.title });
    await notifyCircle({ audience: 'family', severity: 'info', subject: `${me.preferredName} told a new story: ${story.title}`, english: translations.en?.text ?? text, perMember: (p) => translations[p.language]?.text });
    metrics.emit('StorySaved', 1, { language: lang });
    const speak = spokenLanguage(lang);
    return { id: story.id, title: story.title, languages: Object.keys(translations).map(languageName), sayLanguage: speak, say: t(speak, 'storySaved', { title: story.title }) };
  }

  async function listStories() {
    return (await store.list('stories')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function withPlayableAudio(story) {
    const entries = await Promise.all(Object.entries(story.audio ?? {}).map(async ([l, ref]) => [l, await (media.playbackUrl?.(ref) ?? ref)]));
    return { ...story, audio: Object.fromEntries(entries) };
  }

  async function notifyCircle({ audience, severity, subject, english, perMember }) {
    const circle = await store.list('circle');
    for (const p of circle.filter((m) => audience === 'everyone' || m.role === audience)) {
      const text = perMember?.(p) ?? (await translateTo(english, p.language, 'en')).text;
      await notifier.notify({ audience, severity, subject, message: text, recipientId: p.id });
    }
  }

  async function doorEvent({ kind, deviceId = 'front-door', at }) {
    const event = { id: id('door'), kind, deviceId, at: at ?? clock().toISOString() };
    await store.put('door', event);
    await events.publish('DoorActivity', { kind, deviceId });
    metrics.emit('DoorActivity', 1, { kind });

    const alert = kind === 'ding' ? await openHelpAlert(60 * 60 * 1000) : null;
    if (!alert) return { event, say: null };

    const neighbourDispatched = ['neighbour-notified', 'emergency-guidance-sent'].includes(alert.escalationStage);
    await store.update('alerts', alert.id, {
      doorbellAt: event.at,
      ...(neighbourDispatched ? { acknowledged: true, acknowledgedBy: 'front-door', acknowledgedAt: event.at } : {}),
    });
    const me = await elder();
    const p = pronounsOf(me);
    const neighbour = (await store.list('circle')).find((m) => m.role === 'neighbour');
    await notifyCircle({
      audience: 'family', severity: 'high',
      subject: `Someone is at ${me.preferredName}'s door`,
      english: `The doorbell at ${me.preferredName}'s front door just rang during ${p.possessive} alert (${alert.reason}).${neighbourDispatched ? ` ${neighbour?.name ?? 'The neighbour'} was asked to come, so the alert is now marked as answered.` : ` Please confirm someone is with ${p.object}.`}`,
    });
    if (neighbourDispatched) await events.publish('AlertAcknowledged', { alertId: alert.id, by: 'front-door' });
    const { lang } = await voice();
    const say = t(lang, 'doorDuringAlert');
    await deliverToElder({ fromId: neighbour?.id ?? 'front-door', text: say, language: lang, system: true });
    return { event, alertId: alert.id, resolved: neighbourDispatched, sayLanguage: lang, say };
  }

  async function sweepQuietDay() {
    await elder();
    const now = localParts();
    if (now.minutes < 11 * 60) return null;
    const alertId = `quiet-${now.date}`;
    if (await store.get('alerts', alertId)) return null;
    const today = (iso) => iso && localParts(new Date(iso)).date === now.date;
    const [door, checkins, doses] = await Promise.all([store.list('door'), store.list('checkins'), store.list('doses')]);
    if (door.some((d) => today(d.at)) || checkins.some((c) => today(c.at)) || doses.some((d) => d.date === now.date)) return null;
    const me = await elder();
    await store.put('alerts', { id: alertId, type: 'quiet-day', severity: 'info', createdAt: clock().toISOString(), summary: `It's been a quiet morning for ${me.preferredName}: no front-door activity, check-in or tablets yet.`, acknowledged: false });
    await events.publish('QuietDay', { alertId });
    await notifyCircle({ audience: 'family', severity: 'gentle', subject: `A quiet morning for ${me.preferredName}`, english: `${me.preferredName} hasn't been active yet today (no door activity, check-in or tablets). It's probably nothing, but a quick call would be kind.` });
    return alertId;
  }

  async function checkSupply(med) {
    if (!med.supply) return null;
    const daysLeft = daysLeftOf(med);
    if (daysLeft > (med.supply.lowAtDays ?? 5)) return null;
    const alertId = `refill-${med.id}-${med.supply.cycle ?? 0}`;
    if (await store.get('alerts', alertId)) return null;
    const me = await elder();
    const pharmacy = me.pharmacy ? ` ${me.pharmacy.name} (${me.pharmacy.phone}) can deliver.` : '';
    await store.put('alerts', {
      id: alertId, type: 'refill', severity: 'info', medicationId: med.id, daysLeft, createdAt: clock().toISOString(), acknowledged: false,
      summary: `${me.preferredName} has ${daysLeft} day${daysLeft === 1 ? '' : 's'} of ${med.name} left.`,
    });
    await events.publish('RefillNeeded', { alertId, medicationId: med.id, daysLeft });
    await notifyCircle({ audience: 'family', severity: 'info', subject: `${me.preferredName} is running low on ${med.name}`, english: `${me.preferredName} has ${daysLeft} day${daysLeft === 1 ? '' : 's'} of ${med.name} (${med.purpose}) left.${pharmacy} Tap "Refilled" in the Saathi app once it's sorted.` });
    metrics.emit('RefillNeeded', 1);
    return alertId;
  }

  async function sweepSupplies() {
    const raised = [];
    for (const med of await store.list('medications')) {
      const alertId = await checkSupply(med);
      if (alertId) raised.push(alertId);
    }
    return raised;
  }

  async function recordRefill({ medicationId, quantity = 30, by }) {
    const med = await store.get('medications', medicationId);
    if (!med?.supply) return null;
    const cycle = med.supply.cycle ?? 0;
    const supply = { ...med.supply, remaining: med.supply.remaining + quantity, cycle: cycle + 1, refilledAt: clock().toISOString(), refilledBy: by };
    await store.update('medications', medicationId, { supply });
    await store.update('alerts', `refill-${medicationId}-${cycle}`, { acknowledged: true, acknowledgedBy: by, acknowledgedAt: clock().toISOString() });
    const member = (await store.list('circle')).find((p) => p.id === by);
    const { lang } = await voice();
    if (member) await deliverToElder({ fromId: member.id, text: t(lang, 'refillArranged', { name: localized(member, 'name', lang), short: localized(med, 'short', lang) }), language: lang, system: true });
    await events.publish('RefillRecorded', { medicationId, by, quantity });
    return { medicationId, remaining: supply.remaining, daysLeft: daysLeftOf({ ...med, supply }) };
  }

  const dayDiff = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400e3);

  async function upcomingAppointments({ language, days = 14 } = {}) {
    const { lang } = await voice(language);
    const today = localParts().date;
    const circle = await store.list('circle');
    const items = (await store.list('appointments'))
      .map((a) => ({ ...a, daysAway: dayDiff(today, a.at.slice(0, 10)) }))
      .filter((a) => a.daysAway >= 0 && a.daysAway <= days)
      .sort((a, b) => a.at.localeCompare(b.at));
    const describe = (a) => {
      const kind = a.daysAway === 0 ? 'today' : a.daysAway === 1 ? 'tomorrow' : 'later';
      const date = new Intl.DateTimeFormat(LANGUAGES[lang].bcp47, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${a.at.slice(0, 10)}T00:00:00Z`));
      const escort = a.escort ? localized(circle.find((p) => p.id === a.escort), 'name', lang) ?? a.escort : null;
      return t(lang, 'apptLine', { when: t(lang, 'apptWhen', { kind, date }), time: a.at.slice(11, 16), with: localized(a, 'with', lang), place: localized(a, 'place', lang), escort });
    };
    return {
      appointments: items.map(({ i18n, ...a }) => ({ ...a, escortName: circle.find((p) => p.id === a.escort)?.name ?? null })),
      sayLanguage: lang,
      say: items.length ? localDigits(lang, items.slice(0, 2).map(describe).join(' ')) : t(lang, 'apptNone'),
    };
  }

  async function sweepAppointments() {
    const raised = [];
    const me = await elder();
    const p = pronounsOf(me);
    for (const a of (await upcomingAppointments({ language: 'en', days: 1 })).appointments) {
      if (a.escort || a.daysAway > 1) continue;
      const alertId = `escort-${a.id}`;
      if (await store.get('alerts', alertId)) continue;
      await store.put('alerts', {
        id: alertId, type: 'appointment-escort', severity: 'info', appointmentId: a.id, createdAt: clock().toISOString(), acknowledged: false,
        summary: `${me.preferredName} has ${p.possessive} ${a.title.toLowerCase()} with ${a.with} ${a.daysAway === 0 ? 'today' : 'tomorrow'} at ${a.at.slice(11, 16)} (${a.place}). Who can take ${p.object}?`,
      });
      await events.publish('EscortNeeded', { alertId, appointmentId: a.id });
      await notifyCircle({ audience: 'family', severity: 'info', subject: `Who can take ${me.preferredName} to ${a.with}?`, english: `${me.preferredName} has ${p.possessive} ${a.title.toLowerCase()} with ${a.with} ${a.daysAway === 0 ? 'today' : 'tomorrow'} at ${a.at.slice(11, 16)}, at ${a.place}. Tap "I'll take ${p.object}" in the Saathi app.` });
      raised.push(alertId);
    }
    return raised;
  }

  async function claimEscort({ appointmentId, member }) {
    const appt = await store.get('appointments', appointmentId);
    const person = (await store.list('circle')).find((p) => p.id === member);
    if (!appt || !person) return null;
    await store.update('appointments', appointmentId, { escort: member });
    await store.update('alerts', `escort-${appointmentId}`, { acknowledged: true, acknowledgedBy: member, acknowledgedAt: clock().toISOString() });
    const { lang } = await voice();
    const daysAway = dayDiff(localParts().date, appt.at.slice(0, 10));
    const kind = daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : 'later';
    const date = new Intl.DateTimeFormat(LANGUAGES[lang].bcp47, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${appt.at.slice(0, 10)}T00:00:00Z`));
    await deliverToElder({
      fromId: member,
      text: t(lang, 'escortComing', { name: localized(person, 'name', lang), title: localized(appt, 'title', lang), when: t(lang, 'apptWhen', { kind, date, lower: true }) }),
      language: lang,
      system: true,
    });
    await events.publish('EscortClaimed', { appointmentId, member });
    return { ...appt, escort: member };
  }

  async function addVoiceNote({ fromId, audio, contentType = 'audio/webm', durationSec, e2e = null }) {
    const sender = (await store.list('circle')).find((p) => p.id === fromId);
    if (!sender) throw invalid(`Unknown family member ${fromId}`);
    if (e2e) {
      if (!/^[A-Za-z0-9_-]{8,48}$/.test(String(e2e.itemId ?? '')) || !/^audio\/[\w.+-]+$/.test(String(e2e.mediaType ?? ''))) throw invalid('That private voice note is not valid.');
      const ref = await media.save(`voice/e2e-${e2e.itemId}.bin`, audio, 'application/octet-stream');
      metrics.emit('VoiceNote', 1);
      return deliverToElder({ fromId, text: '🎤', language: sender.language, extra: { kind: 'voice', audio: ref, durationSec: durationSec ?? null, e2e: { itemId: e2e.itemId, mediaType: e2e.mediaType } } });
    }
    const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[contentType.split(';')[0]] ?? 'webm';
    const noteId = id('voice');
    const ref = await media.save(`voice/${noteId}.${ext}`, audio, contentType);
    metrics.emit('VoiceNote', 1);
    return deliverToElder({ fromId, text: '🎤', language: sender.language, extra: { kind: 'voice', audio: ref, durationSec: durationSec ?? null } });
  }

  async function weeklyLetters({ send = true, save = send } = {}) {
    const me = await elder();
    const p = pronounsOf(me);
    const now = clock();
    const today = localParts().date;
    const since = (iso) => iso && dayDiff(localParts(new Date(iso)).date, today) < 7;
    const [meds, doses, checkins, stories, door, alerts, circle] = await Promise.all([
      store.list('medications'), store.list('doses'), store.list('checkins'), store.list('stories'), store.list('door'), store.list('alerts'), store.list('circle'),
    ]);
    const weekDoses = doses.filter((d) => dayDiff(d.date, today) < 7).length;
    const expected = [0, 1, 2, 3, 4, 5, 6].reduce((n, i) => {
      const date = new Date(Date.parse(`${today}T12:00:00Z`) - i * 86400e3).toISOString().slice(0, 10);
      return n + meds.filter((m) => takesOn(m, dayIndexOf(date))).reduce((k, m) => k + timesOf(m).length, 0);
    }, 0);
    const week = checkins.filter((c) => since(c.at));
    const shared = week.filter((c) => !c.private);
    const mood = ['POSITIVE', 'NEUTRAL', 'MIXED', 'NEGATIVE'].map((k) => [k, shared.filter((c) => c.sentiment === k).length]).sort((a, b) => b[1] - a[1])[0];
    const newStories = stories.filter((st) => since(st.createdAt));
    const doorDays = new Set(door.filter((d) => since(d.at)).map((d) => localParts(new Date(d.at)).date)).size;
    const helpAlerts = alerts.filter((a) => a.type === 'help' && since(a.createdAt));
    const next = (await upcomingAppointments({ language: 'en', days: 7 })).appointments;
    const nameOf = (pid) => circle.find((p) => p.id === pid)?.name ?? (pid === 'front-door' ? 'the Ring doorbell' : pid);
    const lines = [
      `Tablets: ${weekDoses} of ${expected} taken (${expected ? Math.round((weekDoses / expected) * 100) : 0}%).`,
      week.length
        ? `Mood: ${p.subject} checked in ${week.length} time${week.length === 1 ? '' : 's'}${shared.length && mood[1] ? `, mostly ${mood[0].toLowerCase()}` : ''}${week.length - shared.length ? ` (${week.length - shared.length} kept private, by ${p.possessive} choice)` : ''}.`
        : `Mood: ${p.subject} did not check in this week. A call might be welcome.`,
      newStories.length ? `Memory book: ${newStories.length} new ${newStories.length === 1 ? 'story' : 'stories'}: ${newStories.map((st) => `"${st.title}"`).join(', ')}.` : 'Memory book: no new stories this week.',
      `Front door: activity on ${doorDays} of 7 days.`,
      helpAlerts.length
        ? `Alerts: ${helpAlerts.length} call${helpAlerts.length === 1 ? '' : 's'} for help, ${helpAlerts.filter((a) => a.acknowledged).length} answered${helpAlerts.filter((a) => a.acknowledgedBy).map((a) => ` by ${nameOf(a.acknowledgedBy)}`).join(',')}.`
        : 'Alerts: none this week.',
      next.length ? `Coming up: ${next.map((a) => `${a.title} with ${a.with} on ${a.at.slice(0, 10)} at ${a.at.slice(11, 16)} (${a.escortName ? `${a.escortName} is taking ${p.object}` : `nobody is taking ${p.object} yet`})`).join('; ')}.` : 'Coming up: no appointments in the next week.',
    ];
    const letters = [];
    for (const p of circle.filter((m) => m.role === 'family')) {
      const english = `Dear ${p.name},\n\nHere is ${me.preferredName}'s week.\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\nWith love,\nSaathi`;
      const tr = await translateTo(english, p.language, 'en');
      const letter = { id: `letter-${today}-${p.id}`, memberId: p.id, language: p.language, english, text: tr.text, createdAt: now.toISOString() };
      if (save) await store.put('letters', letter);
      if (send) await notifier.notify({ audience: 'family', recipientId: p.id, severity: 'info', subject: `${me.preferredName}'s week`, message: tr.text });
      letters.push(letter);
    }
    if (save) {
      await events.publish('WeeklyLetter', { count: letters.length });
      metrics.emit('WeeklyLetter', letters.length);
    }
    return letters;
  }

  const member0 = (relationship) => String(relationship ?? 'family').trim().toLowerCase().slice(0, 40);

  async function introductions(fields) {
    const me = await elder();
    const lang = me?.language;
    if (!lang || lang === 'en') return {};
    const out = {};
    for (const [key, text] of Object.entries(fields)) {
      const tr = await translateTo(text, lang, 'en');
      if (tr.translated) out[key] = tr.text;
    }
    return Object.keys(out).length ? { [lang]: out } : {};
  }

  const slugOf = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);

  async function localizeFields(fields) {
    const me = await elder();
    const lang = me?.language;
    if (!lang || lang === 'en') return {};
    const out = {};
    for (const [key, text] of Object.entries(fields)) {
      if (!text) continue;
      const tr = await translateTo(text, lang, 'en');
      if (tr.translated) out[key] = tr.text;
    }
    return Object.keys(out).length ? { [lang]: out } : {};
  }

  async function saveMedication(input = {}) {
    const name = clean(input.name);
    if (!name) throw invalid('Give the medicine a name.');
    const times = [...new Set((Array.isArray(input.times) ? input.times : [input.time]).map((x) => clean(x, 5)).filter(Boolean))].sort();
    if (!times.length || times.some((x) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(x))) throw invalid('Add at least one time, like 08:00.');
    if (times.length > 6) throw invalid('Up to six times a day.');
    const days = Array.isArray(input.days) && input.days.length && input.days.length < 7 ? [...new Set(input.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : null;
    const purpose = clean(input.purpose) || name;
    const description = clean(input.description) || 'tablet';
    const existing = input.id ? await store.get('medications', input.id) : null;
    if (input.id && !existing) throw invalid('That medicine no longer exists.');
    let id = existing?.id ?? (slugOf(name) || 'medicine');
    if (!existing) for (let n = 2; await store.get('medications', id); n++) id = `${slugOf(name) || 'medicine'}-${n}`;
    const phrase = `${description} for ${purpose}`;
    const short = `${purpose} tablet`;
    const remaining = input.remaining === undefined || input.remaining === '' ? existing?.supply?.remaining ?? null : Math.max(0, Math.round(Number(input.remaining)) || 0);
    const med = {
      ...(existing ?? {}), id, name, purpose, description, times, time: times[0], days, withFood: Boolean(input.withFood), phrase, short,
      supply: remaining === null ? null : { ...(existing?.supply ?? {}), remaining, lowAtDays: Math.max(1, Number(input.lowAtDays) || existing?.supply?.lowAtDays || 5) },
      i18n: existing && existing.phrase === phrase ? existing.i18n : await localizeFields({ phrase, short }),
    };
    await store.put('medications', med);
    await events.publish('MedicationSaved', { medicationId: id });
    return med;
  }

  async function removeMedication(medicationId) {
    const removed = await store.remove('medications', medicationId);
    if (removed) await events.publish('MedicationRemoved', { medicationId });
    return removed;
  }

  async function saveAppointment(input = {}) {
    const title = clean(input.title) || 'Doctor visit';
    const withWhom = clean(input.with);
    const at = clean(input.at, 16);
    if (!withWhom) throw invalid('Who is the visit with?');
    if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw invalid('Choose a date and time.');
    const existing = input.id ? await store.get('appointments', input.id) : null;
    if (input.id && !existing) throw invalid('That visit no longer exists.');
    const place = clean(input.place, 160);
    const appt = {
      ...(existing ?? {}), id: existing?.id ?? id('appt'), title, with: withWhom, place, at, notes: clean(input.notes, 300), escort: existing?.escort ?? null,
      i18n: await localizeFields({ title, with: withWhom, place }),
    };
    await store.put('appointments', appt);
    await events.publish('AppointmentSaved', { appointmentId: appt.id });
    return appt;
  }

  async function removeAppointment(appointmentId) {
    const removed = await store.remove('appointments', appointmentId);
    if (removed) {
      await store.remove('alerts', `escort-${appointmentId}`);
      await events.publish('AppointmentRemoved', { appointmentId });
    }
    return removed;
  }

  async function saveRoutine(items = []) {
    if (!Array.isArray(items) || items.length > 20) throw invalid('Up to 20 routine items.');
    const routine = [];
    for (const item of items) {
      const time = clean(item.time, 5);
      const activity = clean(item.activity, 100);
      if (!activity) continue;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw invalid(`"${activity}" needs a time, like 17:00.`);
      const days = Array.isArray(item.days) && item.days.length && item.days.length < 7 ? item.days.map(Number) : undefined;
      routine.push({ time, activity, ...(days ? { days } : {}), i18n: await localizeFields({ activity }) });
    }
    routine.sort((a, b) => a.time.localeCompare(b.time));
    await store.update('profile', 'elder', { routine });
    await events.publish('ProfileUpdated', { fields: ['routine'] });
    return routine;
  }

  async function careSetup() {
    const [meds, appts, me] = await Promise.all([store.list('medications'), store.list('appointments'), elder()]);
    return {
      medications: meds.map((m) => ({ ...m, times: timesOf(m), daysLeft: daysLeftOf(m) })).sort((a, b) => timesOf(a)[0].localeCompare(timesOf(b)[0])),
      appointments: appts.sort((a, b) => a.at.localeCompare(b.at)),
      routine: me?.routine ?? [],
    };
  }

  async function removeMember(memberId) {
    const member = await store.get('circle', memberId);
    if (!member) return null;
    await store.remove('circle', memberId);
    await events.publish('MemberRemoved', { memberId });
    return member;
  }

  async function updateProfile(patch = {}) {
    const me = await elder();
    const text = (v, max = 120) => String(v ?? '').trim().slice(0, max);
    const next = {};
    if ('name' in patch) { if (!text(patch.name)) throw invalid('Name cannot be empty.'); next.name = text(patch.name); }
    if ('preferredName' in patch) next.preferredName = text(patch.preferredName, 40) || next.name || me.name.split(' ')[0];
    if ('language' in patch) { if (!LANGUAGES[patch.language]) throw invalid('Choose a language from the list.'); next.language = patch.language; }
    if ('city' in patch) next.city = text(patch.city);
    if ('home' in patch) next.home = text(patch.home, 200);
    if ('timezone' in patch) { if (!isTimeZone(patch.timezone)) throw invalid('Choose a time zone from the list.'); next.timezone = patch.timezone; }
    if ('country' in patch) { if (patch.country && !COUNTRIES[patch.country]) throw invalid('Choose a country from the list.'); next.country = patch.country || null; }
    if ('emergencyNumber' in patch) { const n = text(patch.emergencyNumber, 15).replace(/[^\d+]/g, ''); next.emergencyNumber = n || null; }
    if ('pronoun' in patch) { if (!PRONOUNS.includes(patch.pronoun)) throw invalid('Choose she, he or they.'); next.pronoun = patch.pronoun; }
    if ('pharmacy' in patch) next.pharmacy = text(patch.pharmacy?.name) ? { name: text(patch.pharmacy.name), phone: text(patch.pharmacy.phone, 30) } : null;
    if ('accessibility' in patch) {
      const a = patch.accessibility ?? {};
      next.accessibility = {
        ...me.accessibility,
        memorySupport: Boolean(a.memorySupport), hearing: a.hearingLoss ? 'mild-loss' : 'typical', vision: a.lowVision ? 'low-vision' : 'typical',
        preferredPace: a.memorySupport || a.hearingLoss ? 'slow' : 'normal', largeText: Boolean(a.lowVision),
      };
    }
    if ('shareMoodWords' in patch) next.privacy = { ...me.privacy, shareMoodWords: Boolean(patch.shareMoodWords) };
    const updated = await store.update('profile', 'elder', next);
    await events.publish('ProfileUpdated', { fields: Object.keys(next) });
    return updated;
  }

  async function sweepReminders() {
    const now = localParts();
    const { lang } = await voice();
    const sent = [];
    const due = (await medicationStatus()).filter((m) => m.status === 'due' && now.minutes >= toMinutes(m.time) && now.minutes - toMinutes(m.time) <= 30);
    const fresh = [];
    for (const m of due) {
      const reminderId = `tablet-${m.slotId}-${now.date}`;
      if (await store.get('reminders', reminderId)) continue;
      await store.put('reminders', { id: reminderId, at: clock().toISOString() });
      fresh.push(m);
    }
    if (fresh.length) {
      const say = t(lang, 'medsDue', { list: fresh.map((m) => localized(m, 'phrase', lang)).join(t(lang, 'medsDueJoin')), withFood: fresh.some((m) => m.withFood) });
      await events.publish('TabletReminder', { say, sayLanguage: lang, medications: fresh.map((m) => m.slotId) });
      sent.push(...fresh.map((m) => m.slotId));
    }
    const soon = (await upcomingAppointments({ language: lang, days: 0 })).appointments
      .filter((a) => { const left = toMinutes(a.at.slice(11, 16)) - now.minutes; return left > 0 && left <= 120; });
    for (const a of soon) {
      const reminderId = `visit-${a.id}-${now.date}`;
      if (await store.get('reminders', reminderId)) continue;
      await store.put('reminders', { id: reminderId, at: clock().toISOString() });
      const circle = await store.list('circle');
      const escort = a.escort ? localized(circle.find((p) => p.id === a.escort), 'name', lang) ?? null : null;
      const raw = (await store.get('appointments', a.id)) ?? a;
      const say = localDigits(lang, t(lang, 'apptLine', { when: t(lang, 'apptWhen', { kind: 'today', date: '' }), time: a.at.slice(11, 16), with: localized(raw, 'with', lang), place: localized(raw, 'place', lang) || '', escort }));
      await events.publish('VisitReminder', { say, sayLanguage: lang, appointmentId: a.id });
      sent.push(a.id);
    }
    return sent;
  }

  async function sweepWeeklyLetter() {
    const now = localParts();
    if (now.dayIndex !== 0 || now.minutes < 18 * 60) return null;
    if ((await store.list('letters')).some((l) => l.id.startsWith(`letter-${now.date}-`))) return null;
    return weeklyLetters({ send: true });
  }

  async function addMember({ name, relationship, language = 'en', role = 'family', email = null, city = '' }) {
    const circle = await store.list('circle');
    const base = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'member';
    let memberId = base === 'elder' ? 'member' : base;
    for (let n = 2; circle.some((p) => p.id === memberId); n++) memberId = `${base}-${n}`;
    const member = {
      id: memberId, name: String(name).trim().slice(0, 80), relationship: String(relationship ?? 'family').trim().toLowerCase().slice(0, 40),
      role: role === 'neighbour' ? 'neighbour' : 'family', language, city, email, aliases: [],
      escalationOrder: role === 'neighbour' ? 2 : 1, aboutForElder: `${String(name).trim()} is your ${String(relationship ?? 'family').trim().toLowerCase()}.`,
      i18n: await introductions({ relationship: member0(relationship), aboutForElder: `${String(name).trim()} is your ${member0(relationship)}.` }),
    };
    await store.put('circle', member);
    await events.publish('MemberAdded', { memberId });
    return member;
  }

  async function subscribeMember({ email, memberId, role = 'family' }) {
    if (!email || !notifier.subscribe) return null;
    return notifier.subscribe({ email, memberId, audiences: role === 'neighbour' ? ['neighbour', 'everyone'] : ['family', 'everyone'] });
  }

  async function setAvatar({ memberId, image, contentType, e2e = null }) {
    let ref;
    let avatarE2e = null;
    if (e2e) {
      if (!/^[A-Za-z0-9_-]{8,48}$/.test(String(e2e.itemId ?? '')) || !['image/png', 'image/jpeg', 'image/webp'].includes(e2e.mediaType)) throw invalid('That private photo is not valid.');
      ref = await media.save(`avatars/e2e-${e2e.itemId}.bin`, image, 'application/octet-stream');
      avatarE2e = { itemId: e2e.itemId, mediaType: e2e.mediaType };
    } else {
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[contentType];
      if (!ext) throw invalid('Use a PNG, JPEG or WebP image.');
      ref = await media.save(`avatars/${memberId}-${Date.now().toString(36)}.${ext}`, image, contentType);
    }
    if (memberId === 'elder') return store.update('profile', 'elder', { avatar: ref, avatarE2e });
    return store.update('circle', memberId, { avatar: ref, avatarE2e });
  }

  async function messages() {
    return store.list('messages');
  }

  async function doorActivity() {
    return (await store.list('door')).sort((a, b) => b.at.localeCompare(a.at));
  }

  const validPoint = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n) && Math.abs(n) < 200);

  async function homeMap() {
    const [rooms, items, meta] = await Promise.all([store.list('rooms'), store.list('homeItems'), store.get('homeMeta', 'map')]);
    const area = (poly) => Math.abs(poly.reduce((a, [x1, z1], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; return a + x1 * z2 - x2 * z1; }, 0)) / 2;
    return {
      rooms: rooms.map((r) => ({ ...r, areaM2: Math.round(area(r.polygon) * 10) / 10 })),
      items,
      devices: meta?.devices ?? [],
      source: meta?.source ?? null,
      updatedAt: meta?.updatedAt ?? null,
      totalAreaM2: Math.round(rooms.reduce((a, r) => a + area(r.polygon), 0) * 10) / 10,
    };
  }

  async function saveRooms({ rooms, source = 'manual', by }) {
    if (!Array.isArray(rooms) || !rooms.length || rooms.length > 30) throw invalid('Send between 1 and 30 rooms.');
    const cleaned = rooms.map((r, i) => {
      if (!Array.isArray(r.polygon) || r.polygon.length < 3 || r.polygon.length > 40 || !r.polygon.every(validPoint)) throw invalid(`Room ${i + 1} needs at least three corners.`);
      const name = String(r.name ?? `Room ${i + 1}`).trim().slice(0, 40) || `Room ${i + 1}`;
      const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `room-${i + 1}`;
      return { id: r.id && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : `${base}-${i + 1}`, name, type: String(r.type ?? 'room').slice(0, 20), polygon: r.polygon.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]), i18n: r.i18n ?? {} };
    });
    for (const old of await store.list('rooms')) await store.remove('rooms', old.id);
    for (const room of cleaned) await store.put('rooms', room);
    const meta = (await store.get('homeMeta', 'map')) ?? { id: 'map', devices: [] };
    await store.put('homeMeta', { ...meta, source, updatedAt: clock().toISOString(), updatedBy: by ?? null });
    await events.publish('HomeMapUpdated', { rooms: cleaned.length, source });
    return homeMap();
  }

  async function placeItem({ name, roomId, x, z, note = '', aliases = [] }) {
    const room = await store.get('rooms', roomId);
    if (!room) throw invalid('Choose a room on the map first.');
    const label = String(name ?? '').trim().slice(0, 40);
    if (!label) throw invalid('Give the thing a name, like "reading glasses".');
    const itemId = `${label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'}-${Date.now().toString(36)}`;
    const item = { id: itemId, name: label, roomId, x: Number(x) || 0, z: Number(z) || 0, note: String(note).trim().slice(0, 80), aliases: aliases.map(String).slice(0, 8), i18n: {} };
    const { lang } = await voice();
    if (lang !== 'en') {
      const n = await translateTo(label, lang, 'en');
      const t2 = item.note ? await translateTo(item.note, lang, 'en') : null;
      if (n.translated) item.i18n[lang] = { name: n.text, ...(t2?.translated ? { note: t2.text } : {}) };
    }
    await store.put('homeItems', item);
    await events.publish('HomeItemPlaced', { itemId, roomId });
    return item;
  }

  async function removeItem(itemId) {
    const removed = await store.remove('homeItems', itemId);
    if (removed) await events.publish('HomeItemRemoved', { itemId });
    return removed;
  }

  async function whereIs(query, { language } = {}) {
    const { lang } = await voice(language);
    const q = String(query ?? '').toLowerCase();
    const [items, rooms] = await Promise.all([store.list('homeItems'), store.list('rooms')]);
    const names = (i) => [i.name, ...(i.aliases ?? []), ...Object.values(i.i18n ?? {}).map((v) => v.name)].filter(Boolean).map((n) => n.toLowerCase());
    const item = items.find((i) => names(i).some((n) => q.includes(n) || n.includes(q)));
    if (!item) return { found: false, sayLanguage: lang, say: t(lang, 'whereUnknown') };
    const room = rooms.find((r) => r.id === item.roomId);
    return {
      found: true, item: { id: item.id, name: item.name, roomId: item.roomId, x: item.x, z: item.z }, room: room?.name ?? null,
      sayLanguage: lang,
      say: t(lang, 'whereIs', { item: localized(item, 'name', lang), room: localized(room, 'name', lang) ?? item.roomId, note: localized(item, 'note', lang) }),
    };
  }

  async function adherence(days = 7) {
    const [meds, doses] = await Promise.all([store.list('medications'), store.list('doses')]);
    const today = localParts().date;
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.parse(`${today}T12:00:00Z`) - i * 86400e3).toISOString().slice(0, 10);
      const expected = meds.filter((m) => takesOn(m, dayIndexOf(date))).reduce((k, m) => k + timesOf(m).length, 0);
      out.push({ date, weekday: DAY_NAMES[dayIndexOf(date)].slice(0, 3), today: i === 0, taken: doses.filter((d) => d.date === date).length, expected });
    }
    return out;
  }

  async function familySummary({ forMemberId } = {}) {
    const me = await elder();
    const p = pronounsOf(me);
    const circle = await store.list('circle');
    const member = circle.find((p) => p.id === forMemberId);
    const today = localParts().date;
    const meds = await medicationStatus();
    const checkins = (await store.list('checkins')).sort((a, b) => b.at.localeCompare(a.at))
      .map((c) => (c.private ? { ...c, text: 'A private check-in', english: 'A private check-in', sentiment: 'PRIVATE', scores: null, concerns: { level: 'none', urgent: [], gentle: [] } } : c));
    const alerts = (await store.list('alerts')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const todays = checkins.filter((c) => localParts(new Date(c.at)).date === today);
    const english = [
      `${me.preferredName} today: ${meds.filter((m) => m.status === 'taken').length} of ${meds.length} tablets taken`
        + (meds.some((m) => m.status === 'missed') ? ` (${meds.filter((m) => m.status === 'missed').map((m) => m.purpose).join(', ')} not confirmed)` : '') + '.',
      !todays.length ? `${p.Subject} ${p.has === 'have' ? "haven't" : "hasn't"} checked in yet today.`
        : todays[0].private ? `${p.Subject} checked in ${todays.length} time(s); ${p.possessive} latest check-in is private, by ${p.possessive} choice.`
          : `${p.Subject} checked in ${todays.length} time(s); latest mood: ${todays[0].sentiment.toLowerCase()} - "${todays[0].english}".`,
      alerts.some((a) => !a.acknowledged) ? `${alerts.filter((a) => !a.acknowledged).length} alert(s) waiting for someone to respond.` : 'No open alerts.',
    ].join(' ');
    const translated = member ? await translateTo(english, member.language, 'en') : { text: english };
    return {
      english, text: translated.text, language: member?.language ?? 'en',
      medications: meds.map(({ i18n, ...m }) => m),
      checkins: checkins.slice(0, 10),
      alerts: alerts.slice(0, 10),
      stories: await Promise.all((await listStories()).slice(0, 10).map(withPlayableAudio)),
      appointments: (await upcomingAppointments({ language: 'en' })).appointments,
      adherence: await adherence(3),
      letter: (await store.list('letters')).filter((l) => l.memberId === forMemberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    };
  }

  const withZone = (api) => Object.fromEntries(Object.entries(api).map(([k, v]) => [k, typeof v === 'function' && k !== 'elder'
    ? async (...args) => { await elder(); return v(...args); }
    : v]));

  return withZone({
    elder, orientation, whoIs,
    medicationSchedule, medicationStatus, confirmMedication, sweepMissedDoses, sweepQuietDay, doorEvent,
    sweepSupplies, sweepWeeklyLetter, sweepReminders, recordRefill, upcomingAppointments, sweepAppointments, claimEscort, addVoiceNote, weeklyLetters,
    addMember, removeMember, updateProfile, saveMedication, removeMedication, saveAppointment, removeAppointment, saveRoutine, careSetup, subscribeMember, setAvatar, media, householdId: deps.householdId ?? DEFAULT_HOUSEHOLD,
    messages, doorActivity, homeMap, saveRooms, placeItem, removeItem, whereIs,
    checkIn, requestHelp, acknowledgeAlert,
    familyMessages, sendToFamily, messageFromFamily,
    saveStory, listStories, familySummary,
    circle: () => store.list('circle'),
  });
}
