import { SESSION_COOKIE, readCookie, cookieHeader } from '../accounts/sessions.js';
import { AuthError } from '../accounts/cognito.js';
import { pkce } from '../accounts/google.js';

const SOCIAL_COOKIE = 'saathi_social';
const GOOGLE_COOKIE = 'saathi_google';
const DEVICE_MAX_AGE = 365 * 24 * 3600;
const ATTEMPTS = new Map();

function rateLimited(key, limit = 8, windowMs = 60_000) {
  const now = Date.now();
  const recent = (ATTEMPTS.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  ATTEMPTS.set(key, recent);
  return recent.length > limit;
}

const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null);

export function mountAuth(app, { config, accounts, sessions, google = null, familyMail = null }) {
  const secure = (req) => req.secure || req.get('x-forwarded-proto') === 'https';
  const setSession = (req, res, account) => {
    res.append('Set-Cookie', cookieHeader(SESSION_COOKIE, sessions.issue({ email: account.email }), { maxAge: sessions.maxAge, secure: secure(req) }));
  };
  const landingFor = (account, next) => (!account.householdId ? '/welcome.html' : safeNext(next) ?? '/family.html');
  const origin = (req) => config.auth.publicUrl ?? `${req.protocol}://${req.get('host')}`;
  const withInvite = async (account, invite) => (invite && !account.householdId ? accounts.acceptInvite(account.email, invite) : account);
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err instanceof AuthError) return res.status(err.code === 'forbidden' ? 403 : err.code === 'limit' ? 429 : 400).json({ error: err.message, code: err.code });
    next(err);
  });
  const social = (config.auth.socialProviders ?? []).filter(Boolean);
  const cognito = accounts.providers().cognito;

  app.use(wrap(async (req, _res, next) => {
    const claims = sessions.read(readCookie(req.headers.cookie, SESSION_COOKIE));
    if (claims?.email) req.user = await accounts.get(claims.email);
    else if (claims?.device) req.device = await accounts.getDevice(claims.device);
    next();
  }));

  app.get('/api/session', (req, res) => {
    res.json({
      user: req.user ?? null,
      device: req.device ? { id: req.device.id, label: req.device.label } : null,
      providers: { cognito, demo: accounts.providers().demo, social: [...new Set([...(cognito ? social : []), ...(google ? ['Google'] : [])])] },
    });
  });

  app.post('/auth/signup', wrap(async (req, res) => {
    const { email, password, name, invite } = req.body ?? {};
    if (rateLimited(`signup:${req.ip}`)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    const out = await accounts.signUp({ email, password, name });
    if (out.confirm) return res.json({ confirm: true });
    const account = await withInvite(out.account, invite);
    setSession(req, res, account);
    res.json({ user: account, next: landingFor(account) });
  }));

  app.post('/auth/confirm', wrap(async (req, res) => {
    const { email, code, password } = req.body ?? {};
    if (rateLimited(`confirm:${req.ip}`)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    await accounts.confirm({ email, code: String(code ?? '').trim() });
    if (!password) return res.json({ confirmed: true });
    const account = await accounts.login({ email, password });
    setSession(req, res, account);
    res.json({ user: account, next: landingFor(account) });
  }));

  app.post('/auth/resend', wrap(async (req, res) => {
    if (rateLimited(`resend:${req.ip}`, 3)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    await accounts.resend({ email: req.body?.email });
    res.json({ sent: true });
  }));

  app.post('/auth/login', wrap(async (req, res) => {
    const { email, password, next, invite } = req.body ?? {};
    if (rateLimited(`login:${req.ip}:${String(email).toLowerCase()}`)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    const account = await withInvite(await accounts.login({ email, password }), invite);
    setSession(req, res, account);
    res.json({ user: account, next: landingFor(account, next) });
  }));

  app.post('/auth/logout', (req, res) => {
    res.append('Set-Cookie', cookieHeader(SESSION_COOKIE, '', { maxAge: 0, secure: secure(req) }));
    res.json({ ok: true });
  });

  app.get('/auth/google', (req, res) => {
    if (!google) return res.redirect('/login.html?error=social-unavailable');
    const gmail = req.query.gmail === '1';
    if (gmail && req.user?.role !== 'owner') return res.redirect('/family.html?gmail=owner-only');
    const { verifier, challenge, state } = pkce();
    const redirectUri = `${origin(req)}/auth/google/callback`;
    res.append('Set-Cookie', cookieHeader(GOOGLE_COOKIE, sessions.issue({ verifier, state, redirectUri, gmail, next: safeNext(req.query.next), invite: req.query.invite ? String(req.query.invite) : null }, 600), { maxAge: 600, secure: secure(req) }));
    res.redirect(google.authUrl({ redirectUri, state, challenge, gmail, loginHint: gmail ? req.user.email : undefined }));
  });

  app.get('/auth/google/callback', wrap(async (req, res) => {
    const pending = sessions.read(readCookie(req.headers.cookie, GOOGLE_COOKIE));
    res.append('Set-Cookie', cookieHeader(GOOGLE_COOKIE, '', { maxAge: 0, secure: secure(req) }));
    if (!pending || pending.state !== req.query.state || !req.query.code) {
      return res.redirect(pending?.gmail ? '/family.html?gmail=failed' : '/login.html?error=social-failed');
    }
    let result;
    try {
      result = await google.finish({ code: String(req.query.code), verifier: pending.verifier, redirectUri: pending.redirectUri });
    } catch (err) {
      console.error('Google sign-in failed:', err.message);
      return res.redirect(pending.gmail ? '/family.html?gmail=failed' : '/login.html?error=social-failed');
    }
    if (pending.gmail) {
      if (req.user?.role !== 'owner' || !familyMail) return res.redirect('/family.html?gmail=owner-only');
      if (!result.refreshToken || !result.scopes.some((s) => s.endsWith('/gmail.send'))) return res.redirect('/family.html?gmail=no-permission');
      await familyMail.connectGmail(req.user.householdId, { email: result.identity.email, name: req.user.name, refreshToken: result.refreshToken, by: req.user.email });
      return res.redirect('/family.html?gmail=connected');
    }
    const account = await accounts.googleLogin(result.identity, { invite: pending.invite });
    setSession(req, res, account);
    res.redirect(landingFor(account, pending.next));
  }));

  app.get('/api/invite/:token', wrap(async (req, res) => {
    const invite = await accounts.previewInvite(req.params.token);
    if (!invite) return res.status(404).json({ error: 'This invite link has expired or was already used. Ask for a new one.' });
    res.json({ ...invite, google: Boolean(google), signedInAs: req.user?.email ?? null });
  }));

  app.post('/auth/invite/accept', wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    const account = await accounts.acceptInvite(req.user.email, req.body?.invite);
    res.json({ user: account, next: '/family.html' });
  }));

  app.post('/auth/device', wrap(async (req, res) => {
    if (rateLimited(`device:${req.ip}`, 10)) throw new AuthError('limit', 'Too many tries. Please wait a minute.');
    const device = await accounts.pairDevice(req.body?.code, { label: req.body?.label });
    res.append('Set-Cookie', cookieHeader(SESSION_COOKIE, sessions.issue({ device: device.id }, DEVICE_MAX_AGE), { maxAge: DEVICE_MAX_AGE, secure: secure(req) }));
    res.json({ device: { id: device.id, label: device.label }, next: '/alexa.html' });
  }));

  app.get('/auth/social/:provider', wrap(async (req, res) => {
    if (google && String(req.params.provider).toLowerCase() === 'google') {
      return res.redirect(`/auth/google${req.query.next ? `?next=${encodeURIComponent(String(req.query.next))}` : ''}`);
    }
    const provider = social.find((p) => p.toLowerCase() === String(req.params.provider).toLowerCase());
    if (!cognito || !provider || !accounts.socialStart) return res.redirect('/login.html?error=social-unavailable');
    const { url, verifier, state } = accounts.socialStart(provider);
    res.append('Set-Cookie', cookieHeader(SOCIAL_COOKIE, sessions.issue({ verifier, state, next: safeNext(req.query.next) }, 600), { maxAge: 600, secure: secure(req) }));
    res.redirect(url);
  }));

  app.get('/auth/callback', wrap(async (req, res) => {
    const pending = sessions.read(readCookie(req.headers.cookie, SOCIAL_COOKIE));
    res.append('Set-Cookie', cookieHeader(SOCIAL_COOKIE, '', { maxAge: 0, secure: secure(req) }));
    if (!pending || pending.state !== req.query.state || !req.query.code) return res.redirect('/login.html?error=social-failed');
    const account = await accounts.socialFinish({ code: String(req.query.code), verifier: pending.verifier });
    setSession(req, res, account);
    res.redirect(landingFor(account, pending.next));
  }));

  app.post('/api/onboarding', wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    const account = await accounts.createHousehold(req.user.email, req.body ?? {});
    res.json({ user: account, next: '/family.html' });
  }));
}
