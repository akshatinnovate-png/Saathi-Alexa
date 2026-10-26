import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { COUNTRIES, PRONOUNS } from '../domain/people.js';
import { hostHeaderValidation, localhostHostValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { mountMcp } from './mcpRoute.js';
import { mountAuth } from './authRoutes.js';
import { LANGUAGES } from '../domain/languages.js';
import { seedData } from '../domain/seed.js';
import { DEFAULT_HOUSEHOLD } from '../households/scope.js';
import { verifySignature, normaliseRingEvent, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../ring/webhook.js';

const PROTECTED_PAGES = ['/family.html', '/alexa.html', '/welcome.html', '/scan.html'];

export function createApp({ config, services, simulatorFor, verifier, optionalVerifier, accounts, sessions, allowedHosts, ringSimulator, assistantFor, google, familyMail }) {
  const { localBus, store } = services;
  const app = express();
  app.set('trust proxy', 'loopback');
  const requireLogin = config.web?.requireLogin !== false && Boolean(accounts && sessions);

  if (allowedHosts?.length) app.use(hostHeaderValidation(allowedHosts));
  else if (['127.0.0.1', 'localhost', '::1'].includes(config.host)) app.use(localhostHostValidation());
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

  mountMcp(app, services, { verifier, optionalVerifier, bus: localBus, auth: config.auth });

  app.post('/ring/events', async (req, res, next) => {
    try {
      const check = verifySignature({ secret: config.ring.webhookSecret, signature: req.get(SIGNATURE_HEADER), timestamp: req.get(TIMESTAMP_HEADER), rawBody: req.rawBody ?? '' });
      if (!check.ok) return res.status(401).json({ error: check.reason });
      let event;
      try { event = normaliseRingEvent(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
      const device = await store.get('ringDevices', event.deviceId);
      res.json(await services.forHousehold(device?.householdId ?? DEFAULT_HOUSEHOLD).doorEvent(event));
    } catch (err) { next(err); }
  });

  if (accounts && sessions) mountAuth(app, { config, accounts, sessions, google, familyMail });

  app.use((req, _res, next) => {
    const fallback = requireLogin ? null : DEFAULT_HOUSEHOLD;
    req.householdId = req.user?.householdId ?? req.device?.householdId ?? fallback;
    req.memberId = req.user?.memberId ?? null;
    next();
  });

  app.get(PROTECTED_PAGES, (req, res, next) => {
    if (!requireLogin) return next();
    if (!req.user && req.device) return req.path === '/alexa.html' ? next() : res.redirect('/alexa.html');
    if (!req.user) return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    if (!req.user.householdId && req.path !== '/welcome.html') return res.redirect('/welcome.html');
    if (req.user.householdId && req.path === '/welcome.html') return res.redirect('/family.html');
    next();
  });

  const api = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const memberOf = (req) => req.memberId ?? req.body?.member ?? req.query.member ?? (config.demo ? 'riya' : null);

  api.use((req, res, next) => {
    if (!req.householdId) return res.status(401).json({ error: requireLogin && req.user ? 'Set up your household first.' : 'Please log in.' });
    if (req.device && !req.user && /^\/(household|devices|mail|demo|family\/avatar)/.test(req.path)) return res.status(403).json({ error: "Aaji's device can't do that. Use the family app." });
    req.saathi = services.forHousehold(req.householdId);
    next();
  });

  const familyOnly = (req, res) => {
    if (!accounts || !req.user) { res.status(401).json({ error: 'Please log in.' }); return false; }
    return true;
  };
  const ownerOnly = (req, res) => {
    if (!familyOnly(req, res)) return false;
    if (req.user.role !== 'owner') { res.status(403).json({ error: 'Only the person who set up this household can do that.' }); return false; }
    return true;
  };
  const originOf = (req) => config.auth.publicUrl ?? `${req.protocol}://${req.get('host')}`;

  api.post('/devices/pairing-code', wrap(async (req, res) => {
    if (!familyOnly(req, res)) return;
    const { code, expiresAt } = await accounts.createPairingCode(req.user.email);
    const url = `${originOf(req)}/device.html`;
    const qr = await QRCode.toString(`${url}?code=${code}`, { type: 'svg', margin: 1, color: { dark: '#16181d', light: '#ffffff' } });
    res.json({ code, expiresAt, url, qr });
  }));

  api.get('/devices', wrap(async (req, res) => {
    if (!familyOnly(req, res)) return;
    res.json(await accounts.listDevices(req.householdId));
  }));

  api.delete('/devices/:id', wrap(async (req, res) => {
    if (!familyOnly(req, res)) return;
    res.json({ removed: Boolean(await accounts.removeDevice(req.householdId, req.params.id)) });
  }));

  api.get('/mail', wrap(async (req, res) => {
    if (!familyOnly(req, res)) return;
    res.json(familyMail ? await familyMail.status(req.householdId) : { service: 'none', real: false, gmail: null, googleAvailable: false });
  }));

  api.post('/mail/test', wrap(async (req, res) => {
    if (!familyOnly(req, res) || !familyMail) return;
    res.json(await familyMail.sendTest(req.householdId, { to: req.user.email, name: req.user.name }));
  }));

  api.delete('/mail/gmail', wrap(async (req, res) => {
    if (!ownerOnly(req, res) || !familyMail) return;
    res.json({ removed: Boolean(await familyMail.disconnectGmail(req.householdId)) });
  }));

  const careEditor = async (req, res) => {
    if (!familyOnly(req, res)) return false;
    const me = (await req.saathi.circle()).find((p) => p.id === req.user.memberId);
    if (me?.role === 'neighbour') { res.status(403).json({ error: 'Neighbours can see alerts but not change medicines or visits.' }); return false; }
    return true;
  };

  api.get('/care', wrap(async (req, res) => {
    if (!familyOnly(req, res)) return;
    res.json(await req.saathi.careSetup());
  }));

  api.post('/care/medications', wrap(async (req, res) => {
    if (!(await careEditor(req, res))) return;
    res.json(await req.saathi.saveMedication({ ...(req.body ?? {}), id: undefined }));
  }));

  api.put('/care/medications/:id', wrap(async (req, res) => {
    if (!(await careEditor(req, res))) return;
    res.json(await req.saathi.saveMedication({ ...(req.body ?? {}), id: req.params.id }));
  }));

  api.delete('/care/medications/:id', wrap(async (req, res) => {
    if (!(await careEditor(req, res))) return;
    res.json({ removed: Boolean(await req.saathi.removeMedication(req.params.id)) });
  }));

  api.post('/care/appointments', wrap(async (req, res) => {
    if (!(await careEditor(req, res))) return;
    res.json(await req.saathi.saveAppointment({ ...(req.body ?? {}), id: undefined }));
  }));

  api.put('/care/appointments/:id', wrap(async (req, res) => {
    if (!(await careEditor(req, res))) return;
    res.json(await req.saathi.saveAppointment({ ...(req.body ?? {}), id: req.params.id }));
  }));

  api.delete('/care/appointments/:id', wrap(async (req, res) => {
    if (!(await careEditor(req, res))) return;
    res.json({ removed: Boolean(await req.saathi.removeAppointment(req.params.id)) });
  }));

  api.put('/care/routine', wrap(async (req, res) => {
    if (!(await careEditor(req, res))) return;
    res.json(await req.saathi.saveRoutine(req.body?.routine ?? []));
  }));

  api.put('/household/profile', wrap(async (req, res) => {
    if (!ownerOnly(req, res)) return;
    res.json(await req.saathi.updateProfile(req.body ?? {}));
  }));

  api.delete('/household/members/:memberId', wrap(async (req, res) => {
    if (!ownerOnly(req, res)) return;
    res.json(await accounts.removeMember(req.user.email, req.params.memberId));
  }));

  api.get('/household/invites', wrap(async (req, res) => {
    if (!familyOnly(req, res)) return;
    res.json(await accounts.pendingInvites(req.householdId));
  }));

  api.post('/household/invite/:memberId/resend', wrap(async (req, res) => {
    if (!ownerOnly(req, res)) return;
    res.json(await accounts.resendInvite(req.user.email, req.params.memberId));
  }));

  api.get('/status', wrap(async (req, res) => {
    const circle = await req.saathi.circle();
    const elder = await req.saathi.elder();
    const withAvatar = async (p) => (p?.avatar ? { ...p, avatarUrl: await (services.media.playbackUrl?.(p.avatar) ?? p.avatar) } : p);
    res.json({
      services: services.describe(), auth: config.auth.mode, brain: simulatorFor ? (await simulatorFor(req.householdId)).brain : 'offline-planner',
      languages: LANGUAGES, elder: await withAvatar(elder), circle: await Promise.all(circle.map(withAvatar)),
      demo: Boolean(config.demo), householdId: req.householdId, me: req.user ?? null, memberId: req.memberId, device: req.device ? { id: req.device.id, label: req.device.label } : null,
    });
  }));

  api.post('/alexa/turn', wrap(async (req, res) => {
    const { text, language = 'en', sessionId = 'device-1' } = req.body ?? {};
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    res.json(await (await simulatorFor(req.householdId)).turn({ sessionId, text: text.trim(), language }));
  }));

  api.post('/alexa/answer', wrap(async (req, res) => {
    const { id, accept } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    res.json(await (await simulatorFor(req.householdId)).answer({ id, accept: Boolean(accept) }));
  }));

  api.post('/alexa/reset', wrap(async (req, res) => {
    (await simulatorFor(req.householdId)).reset(req.body?.sessionId ?? 'device-1');
    res.json({ ok: true });
  }));

  api.post('/assistant', wrap(async (req, res) => {
    const { message, audience = 'family', language, conversationId } = req.body ?? {};
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
    res.json(await (await assistantFor(req.householdId)).ask({ message: message.trim(), audience, language, memberId: memberOf(req), conversationId }));
  }));

  api.post('/speak', wrap(async (req, res) => {
    const { text, language = 'en', slow = false } = req.body ?? {};
    const spoken = text ? await services.speech.synthesize(text, language, { slow }) : null;
    if (!spoken) return res.status(204).end();
    res.set('Content-Type', spoken.contentType).set('X-Polly-Voice', spoken.voice).send(spoken.audio);
  }));

  if (config.demo) api.post('/ring/simulate', wrap(async (req, res) => {
    const kind = req.body?.kind;
    if (!['ding', 'motion'].includes(kind)) return res.status(400).json({ error: 'kind must be ding or motion' });
    const deviceId = req.householdId === DEFAULT_HOUSEHOLD ? 'front-door' : `front-door-${req.householdId}`;
    if (req.householdId !== DEFAULT_HOUSEHOLD) await store.put('ringDevices', { id: deviceId, householdId: req.householdId });
    res.json(await ringSimulator.trigger(kind, deviceId));
  }));

  api.get('/family/summary', wrap(async (req, res) => {
    res.json(await req.saathi.familySummary({ forMemberId: req.memberId ?? req.query.member }));
  }));

  api.get('/family/messages', wrap(async (req, res) => {
    const scoped = req.saathi;
    const messages = (await scoped.messages()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    res.json(await Promise.all(messages.map(async (m) => (m.audio ? { ...m, audioUrl: await (services.media.playbackUrl?.(m.audio) ?? m.audio) } : m))));
  }));

  api.post('/family/voice-note', express.raw({ type: ['audio/*'], limit: '8mb' }), wrap(async (req, res) => {
    const from = req.memberId ?? req.query.from;
    if (!from || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'from and an audio body are required' });
    res.json(await req.saathi.addVoiceNote({ fromId: String(from), audio: req.body, contentType: req.get('content-type'), durationSec: Number(req.query.duration) || undefined }));
  }));

  api.post('/family/avatar', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '3mb' }), wrap(async (req, res) => {
    const memberId = req.query.for === 'elder' ? 'elder' : req.memberId ?? req.query.for;
    if (!memberId || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'an image body is required' });
    const updated = await req.saathi.setAvatar({ memberId, image: req.body, contentType: req.get('content-type') });
    res.json({ ...updated, avatarUrl: await (services.media.playbackUrl?.(updated.avatar) ?? updated.avatar) });
  }));

  api.post('/family/refill', wrap(async (req, res) => {
    const r = await req.saathi.recordRefill({ medicationId: req.body?.medicationId, quantity: Number(req.body?.quantity) || 30, by: memberOf(req) });
    if (!r) return res.status(404).json({ error: 'medicine not found' });
    res.json(r);
  }));

  api.post('/family/escort', wrap(async (req, res) => {
    const r = await req.saathi.claimEscort({ appointmentId: req.body?.appointmentId, member: memberOf(req) });
    if (!r) return res.status(404).json({ error: 'appointment or member not found' });
    res.json(r);
  }));

  api.post('/family/letter', wrap(async (req, res) => {
    const letters = await req.saathi.weeklyLetters({ send: Boolean(req.body?.send) });
    res.json(letters.find((l) => l.memberId === memberOf(req)) ?? null);
  }));

  api.get('/family/door', wrap(async (req, res) => {
    res.json((await req.saathi.doorActivity()).slice(0, 20));
  }));

  api.post('/family/message', wrap(async (req, res) => {
    const text = req.body?.text;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    res.json(await req.saathi.messageFromFamily({ fromId: memberOf(req), text: text.trim() }));
  }));

  api.post('/family/alerts/:id/ack', wrap(async (req, res) => {
    const alert = await req.saathi.acknowledgeAlert({ alertId: req.params.id, by: memberOf(req) });
    if (!alert) return res.status(404).json({ error: 'alert not found' });
    res.json(alert);
  }));

  api.get('/home', wrap(async (req, res) => {
    res.json(await req.saathi.homeMap());
  }));

  api.put('/home/rooms', wrap(async (req, res) => {
    res.json(await req.saathi.saveRooms({ rooms: req.body?.rooms, source: req.body?.source ?? 'manual', by: memberOf(req) }));
  }));

  api.post('/home/items', wrap(async (req, res) => {
    res.json(await req.saathi.placeItem({ ...req.body, by: memberOf(req) }));
  }));

  api.delete('/home/items/:id', wrap(async (req, res) => {
    res.json({ removed: await req.saathi.removeItem(req.params.id) });
  }));

  api.post('/household/invite', wrap(async (req, res) => {
    if (!accounts || !req.user) return res.status(401).json({ error: 'Please log in.' });
    res.json(await accounts.invite(req.user.email, req.body ?? {}));
  }));

  api.post('/household/device-token', wrap(async (req, res) => {
    if (!accounts || !req.user) return res.status(401).json({ error: 'Please log in.' });
    const token = await accounts.issueDeviceToken(req.user.email, { label: String(req.body?.label ?? 'Alexa+ device').slice(0, 60) });
    res.json({ token, mcpUrl: `${config.auth.publicUrl ?? `${req.protocol}://${req.get('host')}`}/mcp` });
  }));

  api.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const mine = (event) => (event.detail?.householdId ?? DEFAULT_HOUSEHOLD) === req.householdId;
    const send = (event) => mine(event) && res.write(`data: ${JSON.stringify(event)}\n\n`);
    localBus.recent?.().slice(-20).forEach(send);
    const unsubscribe = localBus.subscribe(send);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); unsubscribe(); });
  });

  if (config.demo) api.post('/demo/reset', wrap(async (req, res) => {
    if (req.householdId !== DEFAULT_HOUSEHOLD) return res.status(403).json({ error: 'Only the demo household can be reset.' });
    await services.resetDemo(seedData());
    (await simulatorFor?.(req.householdId))?.reset('device-1');
    await localBus.publish('DemoReset', { householdId: DEFAULT_HOUSEHOLD });
    res.json({ ok: true });
  }));

  if (config.demo) api.post('/demo/sweep', wrap(async (req, res) => {
    res.json({
      raised: await req.saathi.sweepMissedDoses(), quietDay: await req.saathi.sweepQuietDay(),
      refills: await req.saathi.sweepSupplies(), escorts: await req.saathi.sweepAppointments(),
    });
  }));

  app.get('/api/reference', (_req, res) => res.json({ countries: COUNTRIES, pronouns: PRONOUNS, languages: LANGUAGES }));
  app.use('/api', api);
  app.use('/media', express.static(fileURLToPath(new URL('../../data/media', import.meta.url))));
  app.use('/vendor/three', express.static(fileURLToPath(new URL('../../node_modules/three', import.meta.url)), { index: false }));
  app.use(express.static(fileURLToPath(new URL('../../public', import.meta.url))));

  app.use((err, _req, res, _next) => {
    if (err.code && err.constructor?.name === 'AuthError') return res.status(err.code === 'forbidden' ? 403 : 400).json({ error: err.message, code: err.code });
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong', detail: err.message });
  });

  return app;
}
