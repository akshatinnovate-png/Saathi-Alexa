import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TWILIO = 'https://api.twilio.com/2010-04-01';
const VOICE = { en: { language: 'en-IN', voice: 'Google.en-IN-Standard-A' }, hi: { language: 'hi-IN', voice: 'Google.hi-IN-Standard-A' }, mr: { language: 'mr-IN', voice: 'Google.mr-IN-Standard-A' } };
const PHRASES = {
  en: { hello: (n) => `Namaste ${n}, this is Saathi calling.`, taken: 'Have you taken them? Please say yes or no.', thanks: 'Thank you. I have noted it.', takeNow: 'Please take it now, with water. I will let the family know.', feel: 'How are you feeling today?', bye: 'Take care. I will call again tomorrow. Goodbye!', missed: "Sorry, I didn't hear that." },
  hi: { hello: (n) => `नमस्ते ${n}, मैं साथी बोल रही हूँ।`, taken: 'क्या आपने दवा ले ली? कृपया हाँ या नहीं बोलिए।', thanks: 'धन्यवाद, मैंने लिख लिया है।', takeNow: 'कृपया अभी पानी के साथ ले लीजिए। मैं परिवार को बता दूँगी।', feel: 'आज आप कैसा महसूस कर रही हैं?', bye: 'अपना ध्यान रखिए। मैं कल फिर फ़ोन करूँगी। नमस्ते!', missed: 'माफ़ कीजिए, मैं सुन नहीं पाई।' },
  mr: { hello: (n) => `नमस्कार ${n}, मी साथी बोलतेय.`, taken: 'तुम्ही गोळ्या घेतल्या का? कृपया हो किंवा नाही सांगा.', thanks: 'धन्यवाद, मी नोंद केली आहे.', takeNow: 'कृपया आत्ता पाण्यासोबत घ्या. मी घरच्यांना सांगेन.', feel: 'आज तुम्हाला कसं वाटतंय?', bye: 'काळजी घ्या. मी उद्या पुन्हा फोन करेन. नमस्कार!', missed: 'माफ करा, मला ऐकू आलं नाही.' },
};
const YES = /\b(yes|yeah|yep|haan|han|ha|ji|done|taken|le li|li hai|ghetli|ghetlya)\b|हाँ|हां|हा|हो|ले ली|ली है|घेतल्या|घेतली/i;
const NO = /\b(no|nahi|nahin|not yet|nope|nahi li)\b|नहीं|नाही|अभी नहीं/i;

const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
const langOf = (l) => (VOICE[l] ? l : String(l ?? '').startsWith('hi') ? 'hi' : 'en');
const say = (text, lang) => `<Say language="${VOICE[lang].language}" voice="${VOICE[lang].voice}">${esc(text)}</Say>`;

export function twiml(parts) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join('')}</Response>`;
}

export function gather({ action, lang, text }) {
  return `<Gather input="speech" language="${VOICE[lang].language}" speechTimeout="auto" action="${esc(action)}" method="POST">${say(text, lang)}</Gather>`;
}

export function twilioSignature(authToken, url, params = {}) {
  const data = url + Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function isDue(settings, nowLocal, lastCalledDate) {
  return Boolean(settings?.enabled && /^\+\d{8,15}$/.test(settings.phone ?? '') && settings.time === nowLocal.time && lastCalledDate !== nowLocal.date);
}

export function createCalls({ provider = null, accountSid, authToken, from, whatsappFrom = null, publicUrl, services, fetchImpl = fetch, retryAfterMs = 10 * 60 * 1000, log = console } = {}) {
  const enabled = provider === 'twilio' && Boolean(accountSid && authToken && from && publicUrl);
  const sessions = new Map();
  const lastCalled = new Map();
  const auth = enabled ? `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` : null;

  async function twilio(path, form) {
    let res;
    try {
      res = await fetchImpl(`${TWILIO}/Accounts/${accountSid}${path}`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(15_000) });
    } catch {
      throw Object.assign(new Error('The phone service could not be reached.'), { status: 502 });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.message ?? `The phone service answered ${res.status}`), { status: 502 });
    return json;
  }

  const url = (path, token) => `${publicUrl}/calls/${path}?t=${encodeURIComponent(token)}`;

  async function place(householdId, { attempt = 1 } = {}) {
    if (!enabled) throw Object.assign(new Error('Saathi Calls are not set up on this Saathi.'), { status: 400 });
    const me = await services.forHousehold(householdId).elder();
    const phone = me?.calls?.phone;
    if (!/^\+\d{8,15}$/.test(phone ?? '')) throw Object.assign(new Error('Add their phone number with the country code, like +919812345678.'), { status: 400 });
    const token = randomBytes(18).toString('base64url');
    sessions.set(token, { householdId, attempt, lang: langOf(me.language), log: [], at: Date.now() });
    const call = await twilio('/Calls.json', { To: phone, From: from, Url: url('start', token), StatusCallback: url('status', token), StatusCallbackEvent: 'completed', Timeout: '30' });
    sessions.get(token).sid = call.sid;
    return { sid: call.sid, attempt };
  }

  async function whatsapp(to, body) {
    if (!whatsappFrom) return;
    await twilio('/Messages.json', { From: `whatsapp:${whatsappFrom}`, To: `whatsapp:${to}`, Body: body }).catch((err) => log.error?.(`WhatsApp summary failed: ${err.message}`));
  }

  async function finish(session) {
    const saathi = services.forHousehold(session.householdId);
    const me = await saathi.elder();
    const summary = `${me.preferredName} answered Saathi's call. ${session.log.join(' ')}`.trim();
    await saathi.recordCall({ outcome: 'completed', summary });
    for (const to of me.calls?.summaryTo ?? []) await whatsapp(to, summary);
  }

  return {
    enabled,

    verify(fullUrl, params, signature) {
      if (!enabled || !signature) return false;
      const expected = Buffer.from(twilioSignature(authToken, fullUrl, params));
      const given = Buffer.from(String(signature));
      return expected.length === given.length && timingSafeEqual(expected, given);
    },

    place,

    async step(name, token, params = {}) {
      const session = sessions.get(String(token));
      if (!session) return twiml(['<Hangup/>']);
      const saathi = services.forHousehold(session.householdId);
      const { lang } = session;
      const p = PHRASES[lang];
      const heard = String(params.SpeechResult ?? '').trim();
      const language = lang;
      if (name === 'start') {
        const me = await saathi.elder();
        const schedule = await saathi.medicationSchedule({ language });
        return twiml([gather({ action: url('meds', token), lang, text: `${p.hello(me.preferredName)} ${schedule.say} ${p.taken}` }), say(p.missed, lang), `<Redirect method="POST">${esc(url('feel-ask', token))}</Redirect>`]);
      }
      if (name === 'meds') {
        let reply = p.missed;
        if (YES.test(heard) && !NO.test(heard)) {
          let confirmed = 0;
          for (let i = 0; i < 4; i++) {
            const r = await saathi.confirmMedication(undefined, { language });
            if (!r.recorded) break;
            confirmed += 1;
          }
          reply = p.thanks;
          session.log.push(confirmed ? `Confirmed ${confirmed} tablet${confirmed === 1 ? '' : 's'}.` : 'Said the tablets were taken.');
        } else if (NO.test(heard)) {
          reply = p.takeNow;
          session.log.push('Said the tablets were not taken yet.');
        }
        return twiml([say(reply, lang), gather({ action: url('feel', token), lang, text: p.feel }), `<Redirect method="POST">${esc(url('bye', token))}</Redirect>`]);
      }
      if (name === 'feel-ask') return twiml([gather({ action: url('feel', token), lang, text: p.feel }), `<Redirect method="POST">${esc(url('bye', token))}</Redirect>`]);
      if (name === 'feel') {
        const parts = [];
        if (heard) {
          const r = await saathi.checkIn({ text: heard, language });
          parts.push(say(r.say, lang));
          session.log.push(`Said: "${heard}".`);
        }
        const msgs = await saathi.familyMessages({ language });
        if (msgs?.say && msgs.count !== 0) parts.push(say(msgs.say, lang));
        parts.push(say(p.bye, lang), '<Hangup/>');
        session.done = true;
        await finish(session);
        return twiml(parts);
      }
      if (name === 'bye') {
        if (!session.done) { session.done = true; await finish(session); }
        return twiml([say(p.bye, lang), '<Hangup/>']);
      }
      return twiml(['<Hangup/>']);
    },

    async status(token, params = {}) {
      const session = sessions.get(String(token));
      if (!session) return { ignored: true };
      sessions.delete(String(token));
      const status = String(params.CallStatus ?? '');
      if (!['no-answer', 'busy', 'failed', 'canceled'].includes(status)) return { status };
      if (session.attempt < 2) {
        setTimeout(() => place(session.householdId, { attempt: session.attempt + 1 }).catch((err) => log.error?.(`retry call failed: ${err.message}`)), retryAfterMs).unref?.();
        return { status, retrying: true };
      }
      await services.forHousehold(session.householdId).recordCall({ outcome: 'missed', summary: `No answer after ${session.attempt} calls.` });
      return { status, alerted: true };
    },

    async sweep(householdIds) {
      if (!enabled) return [];
      const placed = [];
      for (const id of householdIds) {
        const saathi = services.forHousehold(id);
        const me = await saathi.elder();
        const now = await saathi.localNow();
        if (!isDue({ ...me?.calls, phone: me?.calls?.phone }, now, lastCalled.get(id))) continue;
        lastCalled.set(id, now.date);
        try {
          placed.push((await place(id)).sid);
        } catch (err) {
          log.error?.(`Saathi call for ${id} failed: ${err.message}`);
        }
      }
      return placed;
    },
  };
}
