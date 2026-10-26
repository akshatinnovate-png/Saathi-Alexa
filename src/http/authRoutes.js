import { SESSION_COOKIE, readCookie, cookieHeader } from '../accounts/sessions.js';
import { AuthError } from '../accounts/cognito.js';

const SOCIAL_COOKIE = 'saathi_social';
const ATTEMPTS = new Map();

function rateLimited(key, limit = 8, windowMs = 60_000) {
  const now = Date.now();
  const recent = (ATTEMPTS.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  ATTEMPTS.set(key, recent);
  return recent.length > limit;
}

const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null);

export function mountAuth(app, { config, accounts, sessions }) {
  const secure = (req) => req.secure || req.get('x-forwarded-proto') === 'https';
  const setSession = (req, res, account) => {
    res.append('Set-Cookie', cookieHeader(SESSION_COOKIE, sessions.issue({ email: account.email }), { maxAge: sessions.maxAge, secure: secure(req) }));
  };
  const landingFor = (account, next) => (!account.householdId ? '/welcome.html' : safeNext(next) ?? '/family.html');
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err instanceof AuthError) return res.status(err.code === 'forbidden' ? 403 : err.code === 'limit' ? 429 : 400).json({ error: err.message, code: err.code });
    next(err);
  });
  const social = (config.auth.socialProviders ?? []).filter(Boolean);
  const cognito = accounts.providers().cognito;

  app.use(wrap(async (req, _res, next) => {
    const claims = sessions.read(readCookie(req.headers.cookie, SESSION_COOKIE));
    if (claims?.email) req.user = await accounts.get(claims.email);
    next();
  }));

  app.get('/api/session', (req, res) => {
    res.json({
      user: req.user ?? null,
      providers: { cognito, demo: accounts.providers().demo, social: cognito ? social : [] },
    });
  });

  app.post('/auth/signup', wrap(async (req, res) => {
    const { email, password, name } = req.body ?? {};
    if (rateLimited(`signup:${req.ip}`)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    const out = await accounts.signUp({ email, password, name });
    if (out.confirm) return res.json({ confirm: true });
    setSession(req, res, out.account);
    res.json({ user: out.account, next: landingFor(out.account) });
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
    const { email, password, next } = req.body ?? {};
    if (rateLimited(`login:${req.ip}:${String(email).toLowerCase()}`)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    const account = await accounts.login({ email, password });
    setSession(req, res, account);
    res.json({ user: account, next: landingFor(account, next) });
  }));

  app.post('/auth/logout', (req, res) => {
    res.append('Set-Cookie', cookieHeader(SESSION_COOKIE, '', { maxAge: 0, secure: secure(req) }));
    res.json({ ok: true });
  });

  app.get('/auth/social/:provider', wrap(async (req, res) => {
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
