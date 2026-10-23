import { assessConcerns } from './safety.js';
import { languageName } from './languages.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function createSaathi(deps) {
  const { store, translator, sentiment, speech, events, notifier, media, metrics, config } = deps;
  const clock = deps.clock ?? (() => new Date());
  const tz = config.timezone;

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
    return store.get('profile', 'elder');
  }

  async function translateTo(text, to, from = 'auto') {
    try {
      return await translator.translate(text, { from, to });
    } catch (err) {
      metrics.emit('TranslationFailure', 1, { engine: translator.kind });
      return { text, from, to, translated: false, engine: 'error', error: err.message };
    }
  }

  async function orientation() {
    const me = await elder();
    const now = localParts();
    const upcoming = me.routine
      .filter((r) => (!r.days || r.days.includes(now.dayIndex)) && toMinutes(r.time) >= now.minutes)
      .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
    const longDate = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(clock());
    return {
      greetingName: me.preferredName,
      today: longDate,
      time: now.time,
      partOfDay: partOfDay(now.minutes),
      place: me.home,
      next: upcoming[0] ?? null,
      laterToday: upcoming.slice(1, 4),
      say: `Today is ${longDate}. It is ${now.time} in the ${partOfDay(now.minutes)}. You are at home, in ${me.home}.`
        + (upcoming[0] ? ` Next is ${upcoming[0].activity.toLowerCase()} at ${upcoming[0].time}.` : ' There is nothing else planned today. You can rest.'),
    };
  }

  async function whoIs(query) {
    const q = query.toLowerCase().trim();
    const circle = await store.list('circle');
    const person = circle.find((p) => [p.name, p.relationship, ...(p.aliases ?? [])].some((n) => q.includes(n.toLowerCase())) || p.name.toLowerCase().includes(q));
    if (!person) {
      return { found: false, say: `I don't have anyone called ${query} in your family circle yet. That's alright.`, circle: circle.map((p) => `${p.name} (${p.relationship})`) };
    }
    const messages = (await store.list('messages')).filter((m) => m.from === person.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const routine = (await elder()).routine.filter((r) => r.activity.includes(person.name));
    return {
      found: true,
      person: { name: person.name, relationship: person.relationship, city: person.city },
      say: person.aboutForElder,
      lastMessage: messages[0] ? { text: messages[0].text, at: messages[0].createdAt } : null,
      regularPlans: routine.map((r) => `${r.activity} at ${r.time}${r.days ? ` on ${r.days.map((d) => DAY_NAMES[d]).join(' and ')}` : ''}`),
    };
  }

  async function medicationStatus() {
    const now = localParts();
    const meds = await store.list('medications');
    const doses = (await store.list('doses')).filter((d) => d.date === now.date);
    return meds.map((m) => {
      const taken = doses.find((d) => d.medicationId === m.id);
      const diff = now.minutes - toMinutes(m.time);
      const status = taken ? 'taken' : diff > 90 ? 'missed' : diff >= -30 ? 'due' : 'upcoming';
      return { ...m, status, takenAt: taken?.takenAt ?? null };
    });
  }

  async function medicationSchedule() {
    const meds = await medicationStatus();
    const due = meds.filter((m) => m.status === 'due' || m.status === 'missed');
    return {
      medications: meds,
      say: due.length
        ? `It's time for your ${due.map((m) => `${m.description} for ${m.purpose}`).join(', and your ')}.${due.some((m) => m.withFood) ? ' Please take it with some food.' : ''}`
        : `You're all caught up. ${meds.filter((m) => m.status === 'upcoming').map((m) => `Your ${m.purpose} tablet is at ${m.time}.`).join(' ')}`.trim(),
    };
  }

  async function confirmMedication(medicationQuery) {
    const meds = await medicationStatus();
    const q = (medicationQuery ?? '').toLowerCase();
    const med = meds.find((m) => q && (m.id === q || m.name.toLowerCase().includes(q) || m.purpose.includes(q)))
      ?? meds.find((m) => m.status === 'due') ?? meds.find((m) => m.status === 'missed');
    if (!med) return { recorded: false, say: "I couldn't tell which tablet you mean, and nothing is due right now. That's okay." };
    if (med.status === 'taken') return { recorded: false, alreadyTaken: true, medication: med.name, say: `You already took your ${med.purpose} tablet today at ${med.takenAt.slice(11, 16)}. No need to take another one.` };
    const now = localParts();
    const dose = { id: `${med.id}-${now.date}`, medicationId: med.id, date: now.date, takenAt: `${now.date}T${now.time}`, late: med.status === 'missed' };
    await store.put('doses', dose);
    await events.publish('DoseTaken', { medicationId: med.id, medication: med.name, late: dose.late });
    metrics.emit('DoseTaken', 1, { late: String(dose.late) });
    return { recorded: true, medication: med.name, say: `Thank you. I've noted your ${med.purpose} tablet. Well done.` };
  }

  async function sweepMissedDoses() {
    const meds = await medicationStatus();
    const now = localParts();
    const me = await elder();
    const raised = [];
    for (const med of meds.filter((m) => m.status === 'missed')) {
      const alertId = `dose-${med.id}-${now.date}`;
      if (await store.get('alerts', alertId)) continue;
      await store.put('alerts', { id: alertId, type: 'dose-missed', severity: 'info', createdAt: clock().toISOString(), summary: `${me.preferredName} hasn't confirmed her ${med.purpose} tablet (${med.time}).`, acknowledged: false });
      await events.publish('DoseMissed', { alertId, medicationId: med.id, medication: med.name });
      await notifier.notify({ audience: 'family', severity: 'info', subject: `${me.preferredName}: ${med.purpose} tablet not confirmed`, message: `${me.preferredName} hasn't confirmed her ${med.name} (${med.time}). A gentle call might help.` });
      metrics.emit('DoseMissed', 1);
      raised.push(alertId);
    }
    return raised;
  }

  async function checkIn({ text, language, keepPrivate = false }) {
    const me = await elder();
    const lang = language ?? me.language;
    const mood = await sentiment.analyze(text, lang);
    const concerns = assessConcerns(text, mood);
    const english = lang === 'en' ? { text } : await translateTo(text, 'en', lang);
    const entry = { id: id('checkin'), at: clock().toISOString(), text, language: lang, english: english.text, sentiment: mood.sentiment, scores: mood.scores, concerns, private: keepPrivate };
    await store.put('checkins', entry);
    metrics.emit('CheckIn', 1, { sentiment: mood.sentiment });
    await events.publish('CheckInRecorded', { id: entry.id, sentiment: mood.sentiment, level: concerns.level });

    if (concerns.level === 'urgent') {
      const alert = (await openHelpAlert()) ?? await raiseAlert({ reason: concerns.urgent.join(', '), words: english.text, severity: 'critical', source: 'check-in' });
      return { ...entry, alertId: alert.id, say: "I'm here with you. I'm letting your family know right now, and I'll stay with you. If you can, please sit down somewhere safe." };
    }
    if (concerns.level === 'gentle' && keepPrivate) {
      return { ...entry, say: "Thank you for trusting me with that. I'll keep it between us. I'm here if you want to talk more." };
    }
    if (concerns.level === 'gentle') {
      await events.publish('WellbeingConcern', { checkinId: entry.id, kinds: concerns.gentle, severity: 'gentle' });
      const quote = me.privacy?.shareMoodWords === false ? '' : ` ${me.preferredName} said: "${english.text}".`;
      await notifyCircle({
        audience: 'family', severity: 'gentle',
        subject: `${me.preferredName} could use a call today`,
        english: `${quote} She may be feeling ${concerns.gentle.join(' and ').replace('-', ' ')}. A call or a voice note from you would mean a lot.`.trim(),
      });
      const say = concerns.gentle.includes('loneliness') || concerns.gentle.includes('missing-family')
        ? "Thank you for telling me. You are not alone. I've let your family know you're thinking of them, and I'm sure someone will call soon. Would you like to hear Riya's last message, or tell me a story from when you were young?"
        : "Thank you for telling me how you feel. I've let your family know, gently. Would you like some water, or to rest for a little while?";
      return { ...entry, say };
    }
    return { ...entry, say: "That's lovely to hear. I've saved it so your family can smile about it too." };
  }

  async function openHelpAlert(withinMs = 10 * 60 * 1000) {
    const now = clock().getTime();
    return (await store.list('alerts')).find((a) => a.type === 'help' && !a.acknowledged && now - new Date(a.createdAt).getTime() < withinMs) ?? null;
  }

  async function requestHelp({ reason, urgency = 'high' }) {
    const existing = await openHelpAlert();
    if (existing) {
      metrics.emit('HelpRequestDeduplicated', 1);
      return { alertId: existing.id, deduplicated: true, say: "I've already called your family and they are on their way. I'm staying right here with you." };
    }
    const alert = await raiseAlert({ reason, words: reason, severity: urgency === 'critical' ? 'critical' : 'high', source: 'asked-for-help' });
    return { alertId: alert.id, say: "Okay. I'm calling your family now. Stay where you are, I'm right here with you. If nobody answers quickly, I will ask Meera from next door to come." };
  }

  async function raiseAlert({ reason, words, severity, source }) {
    const me = await elder();
    const circle = await store.list('circle');
    const neighbour = circle.find((p) => p.role === 'neighbour');
    const alert = {
      id: id('alert'), type: 'help', source, severity, reason, words, createdAt: clock().toISOString(),
      acknowledged: false, escalationStage: 'starting',
    };
    await store.put('alerts', alert);
    const escalation = {
      alertId: alert.id,
      severity,
      subject: `Saathi: ${me.preferredName} needs you now`,
      familyMessage: `${me.preferredName} (${me.name}) needs help: ${reason}. She said: "${words}". Please call her now and press "I'm on it" in the Saathi family app.`,
      neighbourMessage: `${neighbour?.name ?? 'Neighbour'}, ${me.preferredName} in ${me.home} needs help (${reason}) and her family hasn't responded yet. Please check on her.`,
      emergencyMessage: `No one has acknowledged ${me.preferredName}'s alert (${reason}). If you cannot reach her, call emergency services: 112 in India. Address: ${me.home}.`,
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
      await deliverToElder({ fromId: member.id, text: `${member.name} has seen your message and is coming to help.`, language: 'en', system: true });
    }
    return alert;
  }

  async function deliverToElder({ fromId, text, language, system = false }) {
    const msg = { id: id('msg'), from: fromId, to: 'elder', language, text, createdAt: clock().toISOString(), read: false, system };
    await store.put('messages', msg);
    await events.publish('MessageForElder', { id: msg.id, from: fromId });
    return msg;
  }

  async function familyMessages({ unreadOnly = true, markRead = true } = {}) {
    const me = await elder();
    const circle = await store.list('circle');
    const all = (await store.list('messages')).filter((m) => m.to === 'elder' && (!unreadOnly || !m.read))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const out = [];
    for (const m of all) {
      const sender = circle.find((p) => p.id === m.from);
      const t = await translateTo(m.text, me.language, m.language);
      out.push({ id: m.id, from: sender?.name ?? m.from, relationship: sender?.relationship, original: m.text, originalLanguage: languageName(m.language), translated: t.text, translatedTo: languageName(me.language), translationEngine: t.engine, at: m.createdAt });
      if (markRead && !m.read) await store.update('messages', m.id, { read: true });
    }
    return {
      messages: out,
      say: out.length ? out.map((m) => `${m.from}, your ${m.relationship}, says: ${m.original}`).join(' ') : 'There are no new messages. Everyone is well.',
    };
  }

  async function sendToFamily({ text, language, to }) {
    const me = await elder();
    const lang = language ?? me.language;
    const circle = await store.list('circle');
    const recipients = to ? circle.filter((p) => to.toLowerCase().includes(p.name.toLowerCase()) || to.toLowerCase().includes(p.relationship)) : circle.filter((p) => p.role === 'family');
    if (!recipients.length) return { sent: false, say: `I couldn't find ${to} in your family circle.` };
    const deliveries = [];
    for (const r of recipients) {
      const t = await translateTo(text, r.language, lang);
      const msg = { id: id('msg'), from: 'elder', to: r.id, language: lang, text, translated: t.text, translatedTo: r.language, createdAt: clock().toISOString() };
      await store.put('messages', msg);
      await notifier.notify({ audience: 'family', recipientId: r.id, severity: 'info', subject: `A message from ${me.preferredName}`, message: t.text });
      deliveries.push({ to: r.name, language: languageName(r.language), text: t.text, engine: t.engine });
    }
    await events.publish('MessageFromElder', { recipients: recipients.map((r) => r.id) });
    metrics.emit('MessageSent', deliveries.length);
    return { sent: true, deliveries, say: `I've sent it to ${recipients.map((r) => r.name).join(' and ')}${deliveries.some((d) => d.engine !== 'none' && d.engine !== 'passthrough') ? ', in their own language' : ''}.` };
  }

  async function messageFromFamily({ fromId, text, language }) {
    const circle = await store.list('circle');
    const sender = circle.find((p) => p.id === fromId);
    if (!sender) throw new Error(`Unknown family member ${fromId}`);
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
      const t = await translateTo(text, l, lang);
      translations[l] = { text: t.text, engine: t.engine };
    }
    const storyId = id('story');
    const audio = {};
    for (const [l, t] of Object.entries(translations)) {
      await onProgress(Math.min(++step, total - 1), total, `Narrating in ${languageName(l)}`);
      try {
        const spoken = await speech.synthesize(t.text, l, { slow: true });
        if (spoken) audio[l] = await media.save(`stories/${storyId}/${l}.mp3`, spoken.audio, spoken.contentType);
      } catch (err) {
        metrics.emit('SpeechFailure', 1, { language: l });
      }
    }
    const story = { id: storyId, title: title || 'A story from Aaji', language: lang, text, translations, audio, createdAt: clock().toISOString() };
    await store.put('stories', story);
    await onProgress(total, total, 'Shared with the family');
    await events.publish('StoryShared', { id: story.id, title: story.title });
    await notifyCircle({ audience: 'family', severity: 'info', subject: `${me.preferredName} told a new story: ${story.title}`, english: translations.en?.text ?? text, perMember: (p) => translations[p.language]?.text });
    metrics.emit('StorySaved', 1, { language: lang });
    return { id: story.id, title: story.title, languages: Object.keys(translations).map(languageName), say: `What a beautiful memory. I've saved "${story.title}" in your memory book, and shared it with your family in their languages.` };
  }

  async function listStories() {
    return (await store.list('stories')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    await notifyCircle({
      audience: 'family', severity: 'high',
      subject: 'Someone is at Aaji\'s door',
      english: `The Ring doorbell at ${(await elder()).preferredName}'s front door just rang during her alert (${alert.reason}).${neighbourDispatched ? ' Meera was asked to come, so the alert is now marked as answered.' : ' Please confirm someone is with her.'}`,
    });
    if (neighbourDispatched) await events.publish('AlertAcknowledged', { alertId: alert.id, by: 'front-door' });
    const say = 'Someone is at your front door. It may be Meera coming to help you. Take your time.';
    await deliverToElder({ fromId: 'meera', text: say, language: 'en', system: true });
    return { event, alertId: alert.id, resolved: neighbourDispatched, say };
  }

  async function sweepQuietDay() {
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

  async function familySummary({ forMemberId } = {}) {
    const me = await elder();
    const circle = await store.list('circle');
    const member = circle.find((p) => p.id === forMemberId);
    const today = localParts().date;
    const meds = await medicationStatus();
    const checkins = (await store.list('checkins')).sort((a, b) => b.at.localeCompare(a.at))
      .map((c) => (c.private ? { ...c, text: 'A private check-in', english: 'A private check-in', sentiment: 'PRIVATE', scores: null, concerns: { level: 'none', urgent: [], gentle: [] } } : c));
    const alerts = (await store.list('alerts')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const todays = checkins.filter((c) => c.at.slice(0, 10) === today);
    const english = [
      `${me.preferredName} today: ${meds.filter((m) => m.status === 'taken').length} of ${meds.length} tablets taken`
        + (meds.some((m) => m.status === 'missed') ? ` (${meds.filter((m) => m.status === 'missed').map((m) => m.purpose).join(', ')} not confirmed)` : '') + '.',
      !todays.length ? "She hasn't checked in yet today."
        : todays[0].private ? `She checked in ${todays.length} time(s); her latest check-in is private, by her choice.`
          : `She checked in ${todays.length} time(s); latest mood: ${todays[0].sentiment.toLowerCase()} - "${todays[0].english}".`,
      alerts.some((a) => !a.acknowledged) ? `${alerts.filter((a) => !a.acknowledged).length} alert(s) waiting for someone to respond.` : 'No open alerts.',
    ].join(' ');
    const translated = member ? await translateTo(english, member.language, 'en') : { text: english };
    return { english, text: translated.text, language: member?.language ?? 'en', medications: meds, checkins: checkins.slice(0, 10), alerts: alerts.slice(0, 10), stories: (await listStories()).slice(0, 10) };
  }

  return {
    elder, orientation, whoIs,
    medicationSchedule, medicationStatus, confirmMedication, sweepMissedDoses, sweepQuietDay, doorEvent,
    checkIn, requestHelp, acknowledgeAlert,
    familyMessages, sendToFamily, messageFromFamily,
    saveStory, listStories, familySummary,
    circle: () => store.list('circle'),
  };
}
