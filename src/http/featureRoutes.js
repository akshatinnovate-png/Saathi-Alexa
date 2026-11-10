import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { IMAGE_TYPES, AUDIO_TYPES } from '../features/media.js';

const images = express.raw({ type: IMAGE_TYPES, limit: '6mb' });
const audio = express.raw({ type: AUDIO_TYPES, limit: '12mb' });
const modelLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });

export function mountFamilyFeatures(api, { scan, doctorNotes, haq, sangat, raksha, setup = null, record, memberOf }) {
  const send = (feature, fn) => async (req, res, next) => {
    try {
      if (!feature) return res.status(404).json({ error: 'This part of Saathi is not set up here.' });
      res.json(await fn(req));
    } catch (err) {
      if (err.status && (err.status < 500 || err.status === 503)) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
  const who = async (req) => {
    const id = memberOf(req);
    const p = id ? (await req.saathi.circle()).find((m) => m.id === id) : null;
    return p?.name ?? null;
  };

  api.post('/scan', modelLimit, images, send(scan, (req) => scan.read(req.householdId, { image: req.body, contentType: req.get('content-type') })));
  api.post('/scan/confirm', send(scan, async (req) => {
    const out = await scan.confirm(req.householdId, req.body?.medicines);
    record(req, 'scan-confirm', { saved: out.saved });
    return out;
  }));

  api.get('/doctor-notes', send(doctorNotes, async (req) => ({ notes: await doctorNotes.list(req.householdId) })));
  api.post('/doctor-notes', modelLimit, audio, send(doctorNotes, async (req) => {
    const note = await doctorNotes.record(req.householdId, { audio: req.body, contentType: req.get('content-type'), consent: req.query.consent === 'yes', by: await who(req) });
    record(req, 'doctor-note', { id: note.id });
    return note;
  }));
  api.post('/doctor-notes/:id/apply', send(doctorNotes, async (req) => {
    const out = await doctorNotes.apply(req.householdId, req.params.id, req.body ?? {});
    record(req, 'doctor-note-apply', { id: req.params.id, started: out.started.length, stopped: out.stopped.length });
    return out;
  }));

  api.get('/haq', send(haq, (req) => haq.view(req.householdId)));
  api.put('/haq', send(haq, async (req) => {
    await req.saathi.updateProfile({ haq: req.body ?? {} });
    return haq.view(req.householdId);
  }));
  api.post('/haq/explain', modelLimit, images, send(haq, (req) => haq.explain(req.householdId, { image: req.body, contentType: req.get('content-type') })));

  api.get('/sangat', send(sangat, async (req) => ({ circles: await sangat.near(req.householdId) })));
  api.get('/sangat/today', send(sangat, async (req) => ({ circles: await sangat.today(req.householdId) })));
  api.post('/sangat/:id/attend', send(sangat, (req) => sangat.attend(req.householdId, req.params.id)));
  for (const action of ['join', 'leave', 'paid']) {
    api.post(`/sangat/:id/${action}`, send(sangat, async (req) => {
      const out = await sangat[action](req.householdId, req.params.id);
      record(req, `sangat-${action}`, { id: req.params.id });
      return out;
    }));
  }

  api.get('/setup', send(setup, (req) => setup.status(req.householdId, { email: req.user?.email ?? null, role: req.role })));
  api.get('/attention', send(setup, (req) => setup.attention(req.householdId, { memberId: memberOf(req), role: req.role })));
  api.get('/setup/recommended', send(setup, (req) => setup.recommended(req.householdId)));
  api.post('/setup/recommended', send(setup, async (req) => {
    const out = await setup.applyRecommended(req.householdId, req.body?.ids);
    record(req, 'recommended-protection', { applied: out.applied });
    return out;
  }));
  api.post('/setup/recommended/undo', send(setup, async (req) => {
    const out = await setup.undoRecommended(req.householdId, req.body?.undo);
    record(req, 'recommended-protection-undone', { restored: out.restored });
    return out;
  }));

  api.get('/raksha', send(raksha, async (req) => ({ settings: await raksha.settings(req.householdId), recent: await raksha.recent(req.householdId), answerSeconds: raksha.answerSeconds })));
  api.put('/raksha', send(raksha, async (req) => {
    await req.saathi.updateProfile({ raksha: req.body ?? {} });
    record(req, 'raksha-settings', { enabled: Boolean(req.body?.enabled) });
    return { settings: await raksha.settings(req.householdId) };
  }));
  api.post('/raksha/check', send(raksha, (req) => raksha.check(req.householdId, req.body ?? {})));
  api.post('/raksha/:id/answer', send(raksha, (req) => raksha.answer(req.householdId, req.params.id, { fine: req.body?.fine === true, location: req.body?.location })));
}

export function mountDidiFeatures(router, { didis, doctorNotes, sangat }) {
  const send = (fn) => async (req, res, next) => {
    try { res.json(await fn(req)); } catch (err) {
      if (err.status && (err.status < 500 || err.status === 503)) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
  if (doctorNotes) {
    router.post('/bookings/:id/doctor-notes', modelLimit, audio, send(async (req) => {
      const b = await didis.householdOf(req.didi, req.params.id);
      if (b.kind !== 'escort' || b.status !== 'in-progress') throw Object.assign(new Error('Record doctor notes during a doctor escort visit.'), { status: 409 });
      const note = await doctorNotes.record(b.householdId, { audio: req.body, contentType: req.get('content-type'), consent: req.query.consent === 'yes', by: req.didi.name, bookingId: req.params.id });
      return { id: note.id, summary: note.summary };
    }));
  }
  if (sangat) {
    router.get('/circles', send((req) => sangat.hosted(req.didi)));
    router.post('/circles', send((req) => sangat.create(req.didi, req.body ?? {})));
    router.post('/circles/:id', send((req) => sangat.update(req.didi, req.params.id, req.body ?? {})));
    router.get('/circles/:id/topic', send((req) => sangat.topic(req.didi, req.params.id)));
  }
}
