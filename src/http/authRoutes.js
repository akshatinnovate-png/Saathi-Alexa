import { randomBytes } from 'node:crypto';
import { SESSION_COOKIE, SECURE_SESSION_COOKIE, readCookie, cookieHeader } from '../accounts/sessions.js';
import { AuthError } from '../accounts/cognito.js';
import { pkce } from '../accounts/google.js';

const SOCIAL_COOKIE = 'saathi_social';
const GOOGLE_COOKIE = 'saathi_google';
const MFA_COOKIE = 'saathi_mfa';
const PASSKEY_COOKIE = 'saathi_passkey';
const PAIR_COOKIE = 'saathi_pair';
const ATTEMPTS = new Map();

function rateLimited(key, limit = 8, windowMs = 60_000) {
  const now = Date.now();
  const recent = (ATTEMPTS.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  ATTEMPTS.set(key, recent);
  return recent.length > limit;
}

const safeNext = (next) => (typeof next === 'string' && /^\/(?!\/|\\)[\w\-./?=&#%]*$/.test(next) ? next : null);

export function mountAuth(app, { config, accounts, sessions, security = null, google = null, familyMail = null, audit = null }) {
  const secure = (req) => req.secure || req.get('x-forwarded-proto') === 'https';
  const cookieName = (req) => (secure(req) ? SECURE_SESSION_COOKIE : SESSION_COOKIE);
  const setCookie = (req, res, name, value, maxAge) => res.append('Set-Cookie', cookieHeader(name, value, { maxAge, secure: secure(req) }));
  const clearCookie = (req, res, name) => setCookie(req, res, name, '', 0);
  const log = (req, action, { householdId = null, actor = null, detail = {} } = {}) =>
    audit?.append({ householdId, actor, action, detail: { ...detail, agent: String(req.get('user-agent') ?? '').slice(0, 120) }, ip: req.ip }).catch(() => {});
  const landingFor = (account, next) => (!account.householdId ? '/welcome.html' : safeNext(next) ?? '/family.html');
  const origin = (req) => config.auth.publicUrl ?? `${req.protocol}://${req.get('host')}`;
  const withInvite = async (account, invite) => (invite && !account.householdId ? accounts.acceptInvite(account.email, invite) : account);
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err instanceof AuthError) return res.status(err.code === 'forbidden' ? 403 : err.code === 'limit' ? 429 : 400).json({ error: err.message, code: err.code });
    next(err);
  });
  const social = (config.auth.socialProviders ?? []).filter(Boolean);
  const cognito = accounts.providers().cognito;

  async function startSession(req, res, account, method) {
    const old = readCookie(req.headers.cookie, cookieName(req));
    const previous = old ? await sessions.resolve(old) : null;
    if (previous) await sessions.revoke(previous.id);
    const { cookie, maxAge } = await sessions.start({ email: account.email, userAgent: req.get('user-agent'), mfa: [method] });
    setCookie(req, res, cookieName(req), cookie, maxAge);
    log(req, 'signed-in', { householdId: account.householdId, actor: account.email, detail: { method } });
  }

  async function finishLogin(req, res, account, { method, next = null, invite = null }) {
    if (account.totp && method !== 'passkey') {
      setCookie(req, res, MFA_COOKIE, sessions.issue({ email: account.email, method, next, invite, nonce: randomBytes(8).toString('hex') }, 300), 300);
      return { mfa: true };
    }
    const joined = await withInvite(account, invite);
    await startSession(req, res, joined, method);
    return { user: joined, next: landingFor(joined, next) };
  }

  app.use(wrap(async (req, _res, next) => {
    const raw = readCookie(req.headers.cookie, SECURE_SESSION_COOKIE) ?? readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = raw ? await sessions.resolve(raw) : null;
    if (session?.kind === 'user') {
      const user = await accounts.get(session.email);
      if (user) {
        req.user = user;
        req.session = session;
      } else {
        await sessions.revoke(session.id);
      }
    } else if (session?.kind === 'device') {
      const device = await accounts.getDevice(session.deviceId);
      if (device) {
        req.device = device;
        req.session = session;
      } else {
        await sessions.revoke(session.id);
      }
    }
    next();
  }));

  app.get('/api/session', (req, res) => {
    res.json({
      user: req.user ?? null,
      device: req.device ? { id: req.device.id, label: req.device.label } : null,
      providers: {
        cognito, demo: accounts.providers().demo, passkeys: Boolean(security),
        social: [...new Set([...(cognito ? social : []), ...(google ? ['Google'] : [])])],
      },
    });
  });

  app.post('/auth/signup', wrap(async (req, res) => {
    const { email, password, name, invite } = req.body ?? {};
    if (rateLimited(`signup:${req.ip}`)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    const out = await accounts.signUp({ email, password, name });
    if (out.confirm) return res.json({ confirm: true });
    log(req, 'account-created', { actor: out.account.email, detail: { method: 'password' } });
    res.json(await finishLogin(req, res, out.account, { method: 'password', invite }));
  }));

  app.post('/auth/confirm', wrap(async (req, res) => {
    const { email, code, password } = req.body ?? {};
    if (rateLimited(`confirm:${req.ip}`)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    await accounts.confirm({ email, code: String(code ?? '').trim() });
    if (!password) return res.json({ confirmed: true });
    const account = await accounts.login({ email, password });
    res.json(await finishLogin(req, res, account, { method: 'password' }));
  }));

  app.post('/auth/resend', wrap(async (req, res) => {
    if (rateLimited(`resend:${req.ip}`, 3)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    await accounts.resend({ email: req.body?.email });
    res.json({ sent: true });
  }));

  app.post('/auth/login', wrap(async (req, res) => {
    const { email, password, next, invite } = req.body ?? {};
    if (rateLimited(`login:${req.ip}:${String(email).toLowerCase()}`)) throw new AuthError('limit', 'Too many attempts. Please wait a minute.');
    let account;
    try {
      account = await accounts.login({ email, password });
    } catch (err) {
      if (err instanceof AuthError) log(req, 'sign-in-failed', { actor: String(email ?? '').toLowerCase().slice(0, 120), detail: { reason: err.code } });
      throw err;
    }
    res.json(await finishLogin(req, res, account, { method: 'password', next, invite }));
  }));

  app.post('/auth/login/mfa', wrap(async (req, res) => {
    const pending = sessions.read(readCookie(req.headers.cookie, MFA_COOKIE));
    if (!pending?.email || !security) throw new AuthError('code', 'Please sign in again.');
    if (rateLimited(`mfa:${pending.email}`, 5, 5 * 60_000)) throw new AuthError('limit', 'Too many wrong codes. Please wait a few minutes.');
    const ok = await security.verifyMfa(pending.email, req.body?.code);
    const account = await accounts.get(pending.email);
    if (!ok || !account) {
      log(req, 'two-step-failed', { householdId: account?.householdId, actor: pending.email });
      throw new AuthError('code', 'That code was not right. Type the 6 numbers your app shows now, or a recovery code.');
    }
    clearCookie(req, res, MFA_COOKIE);
    const joined = await withInvite(account, pending.invite);
    await startSession(req, res, joined, `${pending.method}+${ok.method}`);
    res.json({ user: joined, next: landingFor(joined, pending.next), recoveryLeft: ok.method === 'recovery' ? ok.left : undefined });
  }));

  app.post('/auth/passkey/options', wrap(async (req, res) => {
    if (!security) throw new AuthError('passkey', 'Passkeys are not available here.');
    const options = await security.passkeyLoginOptions();
    setCookie(req, res, PASSKEY_COOKIE, sessions.issue({ challenge: options.challenge }, 300), 300);
    res.json(options);
  }));

  app.post('/auth/passkey/verify', wrap(async (req, res) => {
    const pending = sessions.read(readCookie(req.headers.cookie, PASSKEY_COOKIE));
    clearCookie(req, res, PASSKEY_COOKIE);
    if (!pending?.challenge || !security) throw new AuthError('passkey', 'That took too long. Please try again.');
    const email = await security.verifyPasskeyLogin(req.body?.response, pending.challenge);
    const account = await accounts.get(email);
    res.json(await finishLogin(req, res, account, { method: 'passkey', next: req.body?.next }));
  }));

  app.post('/auth/logout', wrap(async (req, res) => {
    if (req.session) {
      await sessions.revoke(req.session.id);
      log(req, req.device ? 'device-signed-out' : 'signed-out', { householdId: (req.user ?? req.device)?.householdId, actor: req.user?.email ?? req.device?.id });
    }
    clearCookie(req, res, cookieName(req));
    res.json({ ok: true });
  }));

  app.get('/auth/google', (req, res) => {
    if (!google) return res.redirect('/login.html?error=social-unavailable');
    const gmail = req.query.gmail === '1';
    if (gmail && req.user?.role !== 'owner') return res.redirect('/family.html?gmail=owner-only');
    const { verifier, challenge, state } = pkce();
    const nonce = randomBytes(16).toString('base64url');
    const redirectUri = `${origin(req)}/auth/google/callback`;
    setCookie(req, res, GOOGLE_COOKIE, sessions.issue({ verifier, state, nonce, redirectUri, gmail, next: safeNext(req.query.next), invite: req.query.invite ? String(req.query.invite) : null }, 600), 600);
    res.redirect(google.authUrl({ redirectUri, state, challenge, nonce, gmail, loginHint: gmail ? req.user.email : undefined }));
  });

  app.get('/auth/google/callback', wrap(async (req, res) => {
    const pending = sessions.read(readCookie(req.headers.cookie, GOOGLE_COOKIE));
    clearCookie(req, res, GOOGLE_COOKIE);
    if (!pending || pending.state !== req.query.state || !req.query.code) {
      return res.redirect(pending?.gmail ? '/family.html?gmail=failed' : '/login.html?error=social-failed');
    }
    let result;
    try {
      result = await google.finish({ code: String(req.query.code), verifier: pending.verifier, redirectUri: pending.redirectUri, nonce: pending.nonce });
    } catch (err) {
      console.error('Google sign-in failed:', err.message);
      return res.redirect(pending.gmail ? '/family.html?gmail=failed' : '/login.html?error=social-failed');
    }
    if (pending.gmail) {
      if (req.user?.role !== 'owner' || !familyMail) return res.redirect('/family.html?gmail=owner-only');
      if (!result.refreshToken || !result.scopes.some((s) => s.endsWith('/gmail.send'))) return res.redirect('/family.html?gmail=no-permission');
      await familyMail.connectGmail(req.user.householdId, { email: result.identity.email, name: req.user.name, refreshToken: result.refreshToken, by: req.user.email });
      log(req, 'gmail-connected', { householdId: req.user.householdId, actor: req.user.email, detail: { gmail: result.identity.email } });
      return res.redirect('/family.html?gmail=connected');
    }
    const account = await accounts.googleLogin(result.identity, { invite: pending.invite });
    const out = await finishLogin(req, res, account, { method: 'google', next: pending.next });
    res.redirect(out.mfa ? '/login.html?step=code' : out.next);
  }));

  app.get('/api/invite/:token', wrap(async (req, res) => {
    const invite = await accounts.previewInvite(req.params.token);
    if (!invite) return res.status(404).json({ error: 'This invite link has expired or was already used. Ask for a new one.' });
    res.json({ ...invite, google: Boolean(google), signedInAs: req.user?.email ?? null });
  }));

  app.post('/auth/invite/accept', wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    const account = await accounts.acceptInvite(req.user.email, req.body?.invite);
    log(req, 'joined-family', { householdId: account.householdId, actor: account.email });
    res.json({ user: account, next: '/family.html' });
  }));

  app.post('/auth/device', wrap(async (req, res) => {
    if (rateLimited(`device:${req.ip}`, 10)) throw new AuthError('limit', 'Too many tries. Please wait a minute.');
    const request = await accounts.pairDevice(req.body?.code, { label: req.body?.label, agent: req.get('user-agent') });
    setCookie(req, res, PAIR_COOKIE, sessions.issue({ requestId: request.requestId, secret: request.secret }, 600), 600);
    log(req, 'device-asked-to-join', { householdId: request.householdId, detail: { emoji: request.emoji.join('') } });
    res.json({ status: 'pending', emoji: request.emoji });
  }));

  app.get('/auth/device/status', wrap(async (req, res) => {
    const pending = sessions.read(readCookie(req.headers.cookie, PAIR_COOKIE));
    if (!pending?.requestId) return res.json({ status: 'unknown' });
    const out = await accounts.pairStatus(pending.requestId, pending.secret);
    if (out.status !== 'pending') clearCookie(req, res, PAIR_COOKIE);
    if (out.status !== 'approved') return res.json({ status: out.status, emoji: out.emoji });
    const { cookie, maxAge } = await sessions.start({ deviceId: out.device.id, userAgent: req.get('user-agent'), mfa: ['pairing-code', 'family-approval'] });
    setCookie(req, res, cookieName(req), cookie, maxAge);
    log(req, 'device-joined', { householdId: out.device.householdId, actor: out.device.id, detail: { label: out.device.label } });
    res.json({ status: 'approved', device: { id: out.device.id, label: out.device.label }, next: '/alexa.html' });
  }));

  app.get('/auth/social/:provider', wrap(async (req, res) => {
    if (google && String(req.params.provider).toLowerCase() === 'google') {
      return res.redirect(`/auth/google${req.query.next ? `?next=${encodeURIComponent(String(req.query.next))}` : ''}`);
    }
    const provider = social.find((p) => p.toLowerCase() === String(req.params.provider).toLowerCase());
    if (!cognito || !provider || !accounts.socialStart) return res.redirect('/login.html?error=social-unavailable');
    const { url, verifier, state } = accounts.socialStart(provider);
    setCookie(req, res, SOCIAL_COOKIE, sessions.issue({ verifier, state, next: safeNext(req.query.next) }, 600), 600);
    res.redirect(url);
  }));

  app.get('/auth/callback', wrap(async (req, res) => {
    const pending = sessions.read(readCookie(req.headers.cookie, SOCIAL_COOKIE));
    clearCookie(req, res, SOCIAL_COOKIE);
    if (!pending || pending.state !== req.query.state || !req.query.code) return res.redirect('/login.html?error=social-failed');
    const account = await accounts.socialFinish({ code: String(req.query.code), verifier: pending.verifier });
    const out = await finishLogin(req, res, account, { method: 'cognito', next: pending.next });
    res.redirect(out.mfa ? '/login.html?step=code' : out.next);
  }));

  app.post('/api/onboarding', wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    const account = await accounts.createHousehold(req.user.email, req.body ?? {});
    log(req, 'family-created', { householdId: account.householdId, actor: account.email });
    res.json({ user: account, next: '/family.html' });
  }));
}
