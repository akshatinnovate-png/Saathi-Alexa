import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hashPassword, verifyPassword, passwordProblem } from './passwords.js';
import { AuthError } from './cognito.js';
import { DEFAULT_HOUSEHOLD, scopeStore } from '../households/scope.js';
import { buildHousehold, newHouseholdId, validateOnboarding } from '../households/onboarding.js';
import { ALL_SCOPES, SCOPES } from '../auth/scopes.js';

export const DEMO_PASSWORD = 'saathi-demo-2026';
const DEMO_ACCOUNTS = [
  { email: 'riya@saathi.demo', name: 'Riya', memberId: 'riya', role: 'owner' },
  { email: 'anand@saathi.demo', name: 'Anand', memberId: 'anand', role: 'member' },
  { email: 'meera@saathi.demo', name: 'Meera', memberId: 'meera', role: 'member' },
];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_DAYS = 30;
const PAIRING_MINUTES = 15;

export const normaliseEmail = (email) => String(email ?? '').trim().toLowerCase();
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createAccounts({ store, services, cognito = null, demo = true, clock = () => new Date(), onInvite = null }) {
  const publicAccount = (a) => a && ({
    email: a.email, name: a.name, householdId: a.householdId ?? null, memberId: a.memberId ?? null, role: a.role ?? null,
    provider: a.provider, avatar: a.avatar ?? null,
  });

  async function ensureDemo() {
    if (!demo) return;
    const hash = await hashPassword(DEMO_PASSWORD);
    for (const d of DEMO_ACCOUNTS) {
      if (await store.get('accounts', d.email)) continue;
      await store.put('accounts', { id: d.email, ...d, householdId: DEFAULT_HOUSEHOLD, provider: 'local', passwordHash: hash, demo: true, createdAt: clock().toISOString() });
    }
    if (!(await store.get('households', DEFAULT_HOUSEHOLD))) {
      await store.put('households', { id: DEFAULT_HOUSEHOLD, name: "Aaji's home (demo)", owner: 'riya@saathi.demo', createdAt: clock().toISOString() });
    }
  }

  async function issueInvite({ householdId, inviter, member }) {
    const token = randomBytes(24).toString('base64url');
    await store.put('invites', { id: member.email, householdId, memberId: member.id, invitedBy: inviter.email, createdAt: clock().toISOString() });
    await store.put('inviteTokens', {
      id: hashToken(token), email: member.email, householdId, memberId: member.id, invitedBy: inviter.email,
      expiresAt: new Date(clock().getTime() + INVITE_DAYS * 86400_000).toISOString(),
    });
    const sent = onInvite ? await onInvite({ householdId, inviterName: inviter.name ?? inviter.email, member, token }).catch((err) => ({ emailed: false, error: err.message })) : {};
    return { token, ...sent };
  }

  async function inviteFor(token) {
    const invite = token ? await store.get('inviteTokens', hashToken(String(token))) : null;
    if (!invite || invite.expiresAt < clock().toISOString()) return null;
    return invite;
  }

  async function joinHousehold(account, invite) {
    if (account.householdId) return account;
    const joined = await store.update('accounts', account.email, { householdId: invite.householdId, memberId: invite.memberId, role: 'member' });
    await store.remove('invites', invite.email);
    await store.remove('inviteTokens', invite.id);
    if (account.email !== invite.email) await scopeStore(store, invite.householdId).update('circle', invite.memberId, { email: account.email });
    return joined;
  }

  async function adopt({ email, name, provider, sub }) {
    let account = await store.get('accounts', email);
    if (!account) {
      account = { id: email, email, name: name || email.split('@')[0], provider, householdId: null, memberId: null, role: null, createdAt: clock().toISOString() };
      const invite = await store.get('invites', email);
      if (invite) {
        Object.assign(account, { householdId: invite.householdId, memberId: invite.memberId, role: 'member' });
        await store.remove('invites', email);
        for (const t of (await store.list('inviteTokens')).filter((x) => x.email === email)) await store.remove('inviteTokens', t.id);
      }
      await store.put('accounts', account);
    }
    if (sub && account.sub !== sub) {
      account = await store.update('accounts', email, { sub });
      await store.put('accountSubs', { id: sub, email });
    }
    return account;
  }

  return {
    providers: () => ({ cognito: Boolean(cognito), demo }),

    async googleLogin(identity, { invite: token } = {}) {
      let account = await adopt({ email: identity.email, name: identity.name, provider: 'google', sub: identity.sub });
      const invite = await inviteFor(token);
      if (invite) account = await joinHousehold(account, invite);
      return publicAccount(account);
    },

    async previewInvite(token) {
      const invite = await inviteFor(token);
      if (!invite) return null;
      const scoped = scopeStore(store, invite.householdId);
      const [profile, member, inviter] = await Promise.all([scoped.get('profile', 'elder'), scoped.get('circle', invite.memberId), store.get('accounts', invite.invitedBy)]);
      return { email: invite.email, elderName: profile?.preferredName ?? null, memberName: member?.name ?? null, language: member?.language ?? 'en', inviterName: inviter?.name ?? invite.invitedBy, exists: Boolean(await store.get('accounts', invite.email)) };
    },

    async acceptInvite(email, token) {
      const invite = await inviteFor(token);
      if (!invite) throw new AuthError('invite', 'This invite link has expired or was already used. Ask for a new one.');
      const account = await store.get('accounts', normaliseEmail(email));
      if (!account) throw new AuthError('account', 'Please log in again.');
      if (account.householdId && account.householdId !== invite.householdId) throw new AuthError('exists', 'You already belong to another household.');
      return publicAccount(await joinHousehold(account, invite));
    },

    async resendInvite(ownerEmail, memberId) {
      const owner = await store.get('accounts', normaliseEmail(ownerEmail));
      if (owner?.role !== 'owner') throw new AuthError('forbidden', 'Only the person who set up this household can send invites.');
      const member = await scopeStore(store, owner.householdId).get('circle', memberId);
      if (!member?.email) throw new AuthError('email', 'Add an email address for them first.');
      if (await store.get('accounts', member.email)) throw new AuthError('exists', `${member.name} has already joined.`);
      for (const t of (await store.list('inviteTokens')).filter((x) => x.email === member.email)) await store.remove('inviteTokens', t.id);
      const sent = await issueInvite({ householdId: owner.householdId, inviter: owner, member });
      return { link: sent.link, emailed: Boolean(sent.emailed), via: sent.via ?? null };
    },

    async pendingInvites(householdId) {
      return (await store.list('invites')).filter((i) => i.householdId === householdId).map((i) => ({ email: i.id, memberId: i.memberId, createdAt: i.createdAt }));
    },

    async createPairingCode(email) {
      const account = await store.get('accounts', normaliseEmail(email));
      if (!account?.householdId) throw new AuthError('account', 'Set up a household first.');
      const now = clock();
      for (const old of await store.list('pairingCodes')) if (old.expiresAt < now.toISOString() || old.createdBy === account.email) await store.remove('pairingCodes', old.id);
      let code;
      do code = String(randomInt(0, 1_000_000)).padStart(6, '0'); while (await store.get('pairingCodes', code));
      const expiresAt = new Date(now.getTime() + PAIRING_MINUTES * 60_000).toISOString();
      await store.put('pairingCodes', { id: code, householdId: account.householdId, createdBy: account.email, expiresAt, attempts: 0 });
      return { code, expiresAt };
    },

    async pairDevice(code, { label } = {}) {
      const entry = await store.get('pairingCodes', String(code ?? '').replace(/\D/g, ''));
      if (!entry || entry.expiresAt < clock().toISOString()) throw new AuthError('code', 'That code did not work. Check the number in the family app, or make a new one.');
      await store.remove('pairingCodes', entry.id);
      const profile = await scopeStore(store, entry.householdId).get('profile', 'elder');
      const device = {
        id: `dev_${randomBytes(12).toString('base64url')}`, householdId: entry.householdId, label: String(label || `${profile?.preferredName ?? 'Home'}'s Saathi`).slice(0, 60),
        pairedBy: entry.createdBy, pairedAt: clock().toISOString(),
      };
      await store.put('devices', device);
      return device;
    },

    async getDevice(id) {
      return id ? store.get('devices', id) : null;
    },

    async listDevices(householdId) {
      return (await store.list('devices')).filter((d) => d.householdId === householdId).sort((a, b) => b.pairedAt.localeCompare(a.pairedAt));
    },

    async removeDevice(householdId, id) {
      const device = await store.get('devices', id);
      if (!device || device.householdId !== householdId) return false;
      return store.remove('devices', id);
    },
    socialStart: cognito ? (provider) => cognito.socialStart(provider) : undefined,
    async socialFinish({ code, verifier }) {
      const identity = await cognito.socialFinish({ code, verifier });
      if (!identity.email) throw new AuthError('social', 'The provider did not share an email address.');
      return publicAccount(await adopt({ email: identity.email, name: identity.name, provider: 'cognito', sub: identity.sub }));
    },
    ensureDemo,
    async get(email) {
      return publicAccount(await store.get('accounts', normaliseEmail(email)));
    },
    async bySub(sub) {
      const link = await store.get('accountSubs', sub);
      return link ? publicAccount(await store.get('accounts', link.email)) : null;
    },

    async signUp({ email, password, name }) {
      email = normaliseEmail(email);
      if (!EMAIL.test(email)) throw new AuthError('email', 'Please enter a valid email address.');
      const problem = passwordProblem(password);
      if (problem) throw new AuthError('password', problem);
      if (email.endsWith('@saathi.demo')) throw new AuthError('exists', 'Demo accounts already exist. Log in instead.');
      if (cognito) {
        await cognito.signUp({ email, password, name });
        await store.put('pendingNames', { id: email, name });
        return { confirm: true };
      }
      if (await store.get('accounts', email)) throw new AuthError('exists', 'An account with this email already exists. Try logging in.');
      await adopt({ email, name, provider: 'local' });
      const account = await store.update('accounts', email, { passwordHash: await hashPassword(password) });
      return { account: publicAccount(account) };
    },

    async confirm({ email, code }) {
      email = normaliseEmail(email);
      if (!cognito) throw new AuthError('code', 'Email confirmation is only needed with Amazon Cognito.');
      await cognito.confirm({ email, code });
    },

    async resend({ email }) {
      if (cognito) await cognito.resend({ email: normaliseEmail(email) });
    },

    async login({ email, password }) {
      email = normaliseEmail(email);
      const local = await store.get('accounts', email);
      if (local && !local.passwordHash && local.provider === 'google') throw new AuthError('credentials', 'This account signs in with Google. Tap the Google button above.');
      if (local?.provider === 'local' || local?.passwordHash) {
        if (!(await verifyPassword(password ?? '', local.passwordHash))) throw new AuthError('credentials', 'That email and password do not match.');
        return publicAccount(local);
      }
      if (!cognito) throw new AuthError('credentials', 'That email and password do not match.');
      const identity = await cognito.login({ email, password });
      const pending = await store.get('pendingNames', email);
      return publicAccount(await adopt({ email: identity.email || email, name: identity.name ?? pending?.name, provider: 'cognito', sub: identity.sub }));
    },

    async socialLogin(identity) {
      if (!identity.email) throw new AuthError('social', 'The provider did not share an email address.');
      return publicAccount(await adopt({ email: identity.email, name: identity.name, provider: 'cognito', sub: identity.sub }));
    },

    async createHousehold(email, form) {
      const account = await store.get('accounts', normaliseEmail(email));
      if (!account) throw new AuthError('account', 'Please log in again.');
      if (account.householdId) throw new AuthError('exists', 'You already belong to a household.');
      const problems = validateOnboarding(form);
      if (problems.length) throw new AuthError('form', problems.join(' '));
      const householdId = newHouseholdId();
      const translate = async (text, to) => {
        const out = await services.translator.translate(text, { from: 'en', to });
        return out.translated ? out.text : null;
      };
      const data = await buildHousehold(form, { ownerEmail: account.email, translate, now: clock() });
      const { ownerMemberId, ...collections } = data;
      await scopeStore(store, householdId).seed(collections);
      await store.put('households', { id: householdId, name: `${collections.profile[0].preferredName}'s home`, owner: account.email, createdAt: clock().toISOString() });
      const updated = await store.update('accounts', account.email, { householdId, memberId: ownerMemberId, role: 'owner' });
      const saathi = services.forHousehold(householdId);
      for (const member of collections.circle.filter((m) => m.email && m.email !== account.email)) {
        await issueInvite({ householdId, inviter: account, member });
      }
      await saathi.subscribeMember?.({ email: account.email, memberId: ownerMemberId, role: 'family' });
      return publicAccount(updated);
    },

    async invite(ownerEmail, { email, name, relationship, language, role = 'family' }) {
      const owner = await store.get('accounts', normaliseEmail(ownerEmail));
      if (owner?.role !== 'owner') throw new AuthError('forbidden', 'Only the person who set up this household can invite others.');
      email = normaliseEmail(email);
      if (!EMAIL.test(email)) throw new AuthError('email', 'Please enter a valid email address.');
      const already = (await scopeStore(store, owner.householdId).list('circle')).find((p) => normaliseEmail(p.email) === email);
      if (already) throw new AuthError('exists', `${already.name} is already in the circle. Use "Send again" below if they need the link.`);
      const saathi = services.forHousehold(owner.householdId);
      const member = await saathi.addMember({ name, relationship, language, role, email });
      const existing = await store.get('accounts', email);
      let sent = { emailed: false, link: null };
      if (existing && !existing.householdId) await store.update('accounts', email, { householdId: owner.householdId, memberId: member.id, role: 'member' });
      else if (!existing) sent = await issueInvite({ householdId: owner.householdId, inviter: owner, member });
      await saathi.subscribeMember?.({ email, memberId: member.id, role });
      return { ...member, invite: { link: sent.link ?? null, emailed: Boolean(sent.emailed), via: sent.via ?? null, joined: Boolean(existing) } };
    },

    async issueDeviceToken(email, { label = 'Alexa+ device', scopes = ALL_SCOPES } = {}) {
      const account = await store.get('accounts', normaliseEmail(email));
      if (!account?.householdId) throw new AuthError('account', 'Set up a household first.');
      if (scopes.includes(SCOPES.elder) && account.role !== 'owner') throw new AuthError('forbidden', "Only the household owner can pair Aaji's device.");
      const token = `sth_${randomBytes(24).toString('base64url')}`;
      await store.put('deviceTokens', { id: hashToken(token), householdId: account.householdId, scopes, label, createdBy: account.email, createdAt: clock().toISOString() });
      return token;
    },

    async internalDeviceToken(householdId, label) {
      const token = `sth_${randomBytes(24).toString('base64url')}`;
      await store.put('deviceTokens', { id: hashToken(token), householdId, scopes: ALL_SCOPES, label, internal: true, createdAt: clock().toISOString() });
      return token;
    },

    async verifyDeviceToken(token) {
      if (!String(token).startsWith('sth_')) return null;
      return store.get('deviceTokens', hashToken(token));
    },
  };
}
