import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { readCookie, cookieHeader } from '../accounts/sessions.js';

export const DIDI_COOKIE = 'saathi_didi';
const YEAR = 365 * 24 * 60 * 60;

export function mountDidis(app, { didis, config, firebase = null, stt = null, push = null, webConfig = {} }) {
  const r = express.Router();
  const httpsSite = config.auth?.publicUrl?.startsWith('https://');
  const secure = (req) => req.secure || req.get('x-forwarded-proto') === 'https' || Boolean(httpsSite);
  const setCookie = (req, res, value, maxAge) => res.append('Set-Cookie', cookieHeader(DIDI_COOKIE, value, { maxAge, secure: secure(req), sameSite: 'Strict' }));
  const send = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); } catch (err) {
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
  const signedIn = async (req, res, next) => {
    try {
      const didi = await didis.byToken(readCookie(req.headers.cookie, DIDI_COOKIE));
      if (!didi) return res.status(401).json({ error: 'Please sign up or open your Saathi Didi link.' });
      req.didi = didi;
      next();
    } catch (err) { next(err); }
  };

  r.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
  r.get('/lessons', send((req) => ({ lessons: didis.lessons(req.query.language) })));
  r.get('/config', send(() => ({ phoneSignIn: Boolean(firebase && webConfig.firebase), voiceNotes: Boolean(stt), push: Boolean(push?.enabled && webConfig.firebase && webConfig.vapidKey), firebase: webConfig.firebase ?? null, vapidKey: webConfig.vapidKey ?? null })));
  const phoneFrom = async (idToken) => {
    if (!firebase || typeof idToken !== 'string') return null;
    try { return (await firebase.verifyIdToken(idToken)).phone; } catch { return null; }
  };
  r.post('/phone-login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), send(async (req, res) => {
    const phone = await phoneFrom(req.body?.idToken);
    if (!phone) throw Object.assign(new Error('That phone sign-in did not work. Please try again.'), { status: 401 });
    const didi = await didis.byPhone(phone);
    if (!didi) return { needsSignup: true, phone };
    setCookie(req, res, await didis.newToken(didi), YEAR);
    return didis.me(didi);
  }));
  r.post('/signup', rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), send(async (req, res) => {
    const verifiedPhone = await phoneFrom(req.body?.idToken);
    const { didi, token } = await didis.signUp({ ...(req.body ?? {}), verifiedPhone: verifiedPhone ? verifiedPhone.replace(/[^\d+]/g, '') : null });
    setCookie(req, res, token, YEAR);
    return { didi, link: `/didi.html#key=${token}` };
  }));
  r.post('/login', send(async (req, res) => {
    const token = typeof req.body?.key === 'string' ? req.body.key : '';
    const didi = await didis.byToken(token);
    if (!didi) throw Object.assign(new Error('That Saathi Didi link is not valid.'), { status: 401 });
    setCookie(req, res, token, YEAR);
    return didis.me(didi);
  }));
  r.post('/logout', (req, res) => { setCookie(req, res, '', 0); res.json({ ok: true }); });
  r.use(signedIn);
  r.get('/me', send((req) => didis.me(req.didi)));
  r.post('/lessons/:id', send((req) => didis.answerLesson(req.didi, req.params.id, req.body?.answer)));
  r.get('/offers', send(async (req) => ({ offers: await didis.offers(req.didi) })));
  r.get('/bookings', send(async (req) => ({ bookings: await didis.myBookings(req.didi) })));
  r.post('/bookings/:id/accept', send((req) => didis.accept(req.didi, req.params.id)));
  r.get('/bookings/:id/briefing', send((req) => didis.briefing(req.didi, req.params.id)));
  r.post('/bookings/:id/check-in', send((req) => didis.checkIn(req.didi, req.params.id)));
  r.post('/bookings/:id/check-out', send((req) => didis.checkOut(req.didi, req.params.id, { note: req.body?.note, language: req.body?.language })));
  r.post('/bookings/:id/sos', send((req) => didis.sos(req.didi, req.params.id, { note: req.body?.note, language: req.body?.language })));
  r.post('/bookings/:id/rate-family', send((req) => didis.rateFamily(req.didi, req.params.id, { stars: req.body?.stars, note: req.body?.note, block: req.body?.block === true })));
  r.post('/bookings/:id/voice-note', express.raw({ type: ['audio/webm', 'audio/ogg'], limit: '1mb' }), send(async (req) => {
    if (!stt) throw Object.assign(new Error('Voice notes are not set up here. Please type your note.'), { status: 400 });
    const b = (await didis.myBookings(req.didi)).find((x) => x.id === req.params.id);
    if (!b || b.status !== 'in-progress') throw Object.assign(new Error('Record the note during the visit.'), { status: 409 });
    return stt.transcribe(req.body, { language: req.query.language ?? req.didi.languages[0], contentType: req.get('content-type') });
  }));
  r.put('/safety', send((req) => didis.updateSafety(req.didi, req.body ?? {})));
  r.get('/card', async (req, res, next) => {
    try {
      const card = await didis.card(req.didi);
      res.set('Content-Type', card.contentType).set('Cache-Control', 'private, max-age=0').send(card.data);
    } catch (err) { next(err); }
  });
  r.post('/push', send((req) => push ? push.register({ token: req.body?.token, didiId: req.didi.id }) : Promise.reject(Object.assign(new Error('Notifications are not set up here.'), { status: 400 }))));
  r.get('/earnings', send((req) => didis.earnings(req.didi, /^\d{4}-\d{2}$/.test(req.query.month ?? '') ? req.query.month : undefined)));
  app.use('/didi-api', r);
}

export function mountFamilyDidis(api, { didis, record, memberOf }) {
  const send = (fn) => async (req, res, next) => {
    try {
      if (!didis) return res.status(404).json({ error: 'Saathi Didis are not available here.' });
      res.json(await fn(req));
    } catch (err) {
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
  api.get('/didis', send(async (req) => ({ didis: await didis.search(req.householdId) })));
  api.get('/didis/bookings', send(async (req) => ({ bookings: await didis.bookings(req.householdId) })));
  api.post('/didis/bookings', send(async (req) => {
    const out = await didis.book(req.householdId, req.body ?? {}, memberOf(req));
    record(req, 'didi-book', { id: out.id, kind: out.kind });
    return out;
  }));
  api.post('/didis/bookings/:id/cancel', send(async (req) => {
    const out = await didis.cancel(req.householdId, req.params.id);
    record(req, 'didi-cancel', { id: out.id });
    return out;
  }));
  api.post('/didis/bookings/:id/paid', send(async (req) => {
    const out = await didis.markPaid(req.householdId, req.params.id);
    record(req, 'didi-paid', { id: out.id, fee: out.fee });
    return out;
  }));
  api.post('/didis/bookings/:id/rate', send(async (req) => {
    const out = await didis.rate(req.householdId, req.params.id, req.body ?? {});
    record(req, 'didi-rate', { id: out.id, stars: out.rating });
    return out;
  }));
}
