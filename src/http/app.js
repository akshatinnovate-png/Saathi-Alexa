import express from 'express';
import { hostHeaderValidation, localhostHostValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { mountMcp } from './mcpRoute.js';
import { LANGUAGES } from '../domain/languages.js';
import { verifySignature, normaliseRingEvent, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../ring/webhook.js';

export function createApp({ config, services, simulator, verifier, allowedHosts, ringSimulator }) {
  const { saathi, localBus, store } = services;
  const app = express();

  if (allowedHosts?.length) app.use(hostHeaderValidation(allowedHosts));
  else if (['127.0.0.1', 'localhost', '::1'].includes(config.host)) app.use(localhostHostValidation());
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

  mountMcp(app, saathi, { verifier, bus: localBus, auth: config.auth });

  app.post('/ring/events', async (req, res, next) => {
    try {
      const check = verifySignature({ secret: config.ring.webhookSecret, signature: req.get(SIGNATURE_HEADER), timestamp: req.get(TIMESTAMP_HEADER), rawBody: req.rawBody ?? '' });
      if (!check.ok) return res.status(401).json({ error: check.reason });
      let event;
      try { event = normaliseRingEvent(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
      res.json(await saathi.doorEvent(event));
    } catch (err) { next(err); }
  });

  const api = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  api.get('/status', wrap(async (_req, res) => {
    res.json({
      services: services.describe(), auth: config.auth.mode, brain: simulator?.brain ?? 'offline-planner',
      languages: LANGUAGES, elder: await saathi.elder(), circle: await saathi.circle(),
    });
  }));

  api.post('/alexa/turn', wrap(async (req, res) => {
    const { text, language = 'en', sessionId = 'device-1' } = req.body ?? {};
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    res.json(await simulator.turn({ sessionId, text: text.trim(), language }));
  }));

  api.post('/alexa/answer', wrap(async (req, res) => {
    const { id, accept } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    res.json(await simulator.answer({ id, accept: Boolean(accept) }));
  }));

  api.post('/alexa/reset', (req, res) => {
    simulator.reset(req.body?.sessionId ?? 'device-1');
    res.json({ ok: true });
  });

  api.post('/speak', wrap(async (req, res) => {
    const { text, language = 'en', slow = false } = req.body ?? {};
    const spoken = text ? await services.speech.synthesize(text, language, { slow }) : null;
    if (!spoken) return res.status(204).end();
    res.set('Content-Type', spoken.contentType).set('X-Polly-Voice', spoken.voice).send(spoken.audio);
  }));

  api.post('/ring/simulate', wrap(async (req, res) => {
    const kind = req.body?.kind;
    if (!['ding', 'motion'].includes(kind)) return res.status(400).json({ error: 'kind must be ding or motion' });
    res.json(await ringSimulator.trigger(kind));
  }));

  api.get('/family/summary', wrap(async (req, res) => {
    res.json(await saathi.familySummary({ forMemberId: req.query.member }));
  }));

  api.get('/family/messages', wrap(async (_req, res) => {
    res.json((await store.list('messages')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30));
  }));

  api.get('/family/door', wrap(async (_req, res) => {
    res.json((await store.list('door')).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20));
  }));

  api.post('/family/message', wrap(async (req, res) => {
    const { from, text } = req.body ?? {};
    if (!from || !text?.trim()) return res.status(400).json({ error: 'from and text are required' });
    res.json(await saathi.messageFromFamily({ fromId: from, text: text.trim() }));
  }));

  api.post('/family/alerts/:id/ack', wrap(async (req, res) => {
    const alert = await saathi.acknowledgeAlert({ alertId: req.params.id, by: req.body?.member ?? 'riya' });
    if (!alert) return res.status(404).json({ error: 'alert not found' });
    res.json(alert);
  }));

  api.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    localBus.recent?.().slice(-20).forEach(send);
    const unsubscribe = localBus.subscribe(send);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); unsubscribe(); });
  });

  api.post('/demo/reset', wrap(async (_req, res) => {
    await store.reset();
    simulator?.reset('device-1');
    await localBus.publish('DemoReset', {});
    res.json({ ok: true });
  }));

  api.post('/demo/sweep', wrap(async (_req, res) => {
    res.json({ raised: await saathi.sweepMissedDoses(), quietDay: await saathi.sweepQuietDay() });
  }));

  app.use('/api', api);
  app.use('/media', express.static(new URL('../../data/media', import.meta.url).pathname));
  app.use(express.static(new URL('../../public', import.meta.url).pathname));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong', detail: err.message });
  });

  return app;
}
