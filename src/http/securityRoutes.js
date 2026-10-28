import { AuthError } from '../accounts/cognito.js';
import { verifyPassword } from '../accounts/passwords.js';
import { sessionState } from '../security/core.js';

export function mountSecurity(app, { accounts, sessions, security, audit }) {
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err instanceof AuthError) return res.status(err.code === 'forbidden' ? 403 : err.code === 'limit' ? 429 : err.code === 'reauth' ? 401 : 400).json({ error: err.message, code: err.code });
    next(err);
  });
  const log = (req, action, detail = {}) =>
    audit?.append({ householdId: req.user?.householdId ?? null, actor: req.user?.email ?? null, action, detail, ip: req.ip }).catch(() => {});
  const signedIn = (req) => {
    if (!req.user || !req.session) throw new AuthError('account', 'Please log in.');
  };
  const fresh = (req) => {
    const { kind, createdAt, lastSeenAt, reauthAt } = req.session;
    if (!sessionState({ kind, createdAt, lastSeenAt, reauthAt }).fresh) throw new AuthError('reauth', 'For your safety, confirm it is you first.');
  };
  const owner = (req) => {
    signedIn(req);
    if (req.user.role !== 'owner') throw new AuthError('forbidden', 'Only the person who set up this household can see this.');
  };

  app.get('/api/security', wrap(async (req, res) => {
    signedIn(req);
    const mine = await sessions.list((s) => s.kind === 'user' && s.email === req.user.email);
    res.json({
      ...(await security.summary(req.user.email)),
      sessions: mine.map((s) => ({ id: s.id, agent: s.agent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === req.session.id, mfa: s.mfa ?? [] })),
      fresh: (() => { try { fresh(req); return true; } catch { return false; } })(),
    });
  }));

  app.post('/api/security/reauth', wrap(async (req, res) => {
    signedIn(req);
    const account = await accounts.raw(req.user.email);
    const { password, code } = req.body ?? {};
    let ok = false;
    if (password && account.passwordHash) ok = (await verifyPassword(password, account.passwordHash)).ok;
    if (!ok && code) ok = Boolean(await security.verifyMfa(account.email, code));
    if (!ok) {
      log(req, 'confirm-identity-failed');
      throw new AuthError('credentials', account.passwordHash ? 'That password or code was not right.' : 'That code was not right.');
    }
    await sessions.update(req.session.id, { reauthAt: new Date().toISOString() });
    res.json({ fresh: true });
  }));

  app.post('/api/security/password', wrap(async (req, res) => {
    signedIn(req);
    const account = await accounts.changePassword(req.user.email, { current: req.body?.current, next: req.body?.next });
    const ended = await sessions.revokeWhere((s) => s.kind === 'user' && s.email === account.email, { except: req.session.id });
    log(req, 'password-changed', { otherSessionsEnded: ended });
    res.json({ changed: true, otherSessionsEnded: ended });
  }));

  app.post('/api/security/sessions/revoke-others', wrap(async (req, res) => {
    signedIn(req);
    const ended = await sessions.revokeWhere((s) => s.kind === 'user' && s.email === req.user.email, { except: req.session.id });
    log(req, 'signed-out-everywhere-else', { sessions: ended });
    res.json({ ended });
  }));

  app.delete('/api/security/sessions/:id', wrap(async (req, res) => {
    signedIn(req);
    const target = (await sessions.list((s) => s.id === req.params.id))[0];
    if (!target || target.kind !== 'user' || target.email !== req.user.email) throw new AuthError('forbidden', 'That is not one of your sessions.');
    await sessions.revoke(target.id);
    log(req, 'session-ended', { agent: target.agent });
    res.json({ ended: true });
  }));

  app.post('/api/security/totp/start', wrap(async (req, res) => {
    signedIn(req);
    fresh(req);
    res.json(await security.startTotp(req.user.email));
  }));

  app.post('/api/security/totp/confirm', wrap(async (req, res) => {
    signedIn(req);
    fresh(req);
    const out = await security.confirmTotp(req.user.email, req.body?.code);
    log(req, 'two-step-turned-on');
    res.json(out);
  }));

  app.post('/api/security/totp/disable', wrap(async (req, res) => {
    signedIn(req);
    fresh(req);
    const out = await security.disableTotp(req.user.email, req.body?.code);
    log(req, 'two-step-turned-off');
    res.json(out);
  }));

  app.post('/api/security/recovery', wrap(async (req, res) => {
    signedIn(req);
    fresh(req);
    const out = await security.newRecoveryCodes(req.user.email, req.body?.code);
    log(req, 'recovery-codes-replaced');
    res.json(out);
  }));

  app.post('/api/security/passkeys/options', wrap(async (req, res) => {
    signedIn(req);
    fresh(req);
    res.json(await security.passkeyRegistrationOptions(req.user.email));
  }));

  app.post('/api/security/passkeys', wrap(async (req, res) => {
    signedIn(req);
    fresh(req);
    const out = await security.registerPasskey(req.user.email, req.body?.response, req.body?.name);
    log(req, 'passkey-added', { name: out.name });
    res.json(out);
  }));

  app.delete('/api/security/passkeys/:id', wrap(async (req, res) => {
    signedIn(req);
    fresh(req);
    const removed = await security.removePasskey(req.user.email, req.params.id);
    if (removed) log(req, 'passkey-removed');
    res.json({ removed });
  }));

  app.get('/api/security/log', wrap(async (req, res) => {
    owner(req);
    const [entries, check] = await Promise.all([audit.entries(req.user.householdId), audit.verify(req.user.householdId)]);
    res.json({ verified: check, entries: entries.slice(-200).reverse().map(({ mac, chain, ...e }) => ({ ...e, mac: mac.slice(0, 12) })) });
  }));
}
