import { createHash, randomBytes } from 'node:crypto';
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

export const normaliseEmail = (email) => String(email ?? '').trim().toLowerCase();
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createAccounts({ store, services, cognito = null, demo = true, clock = () => new Date() }) {
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

  async function adopt({ email, name, provider, sub }) {
    let account = await store.get('accounts', email);
    if (!account) {
      account = { id: email, email, name: name || email.split('@')[0], provider, householdId: null, memberId: null, role: null, createdAt: clock().toISOString() };
      const invite = await store.get('invites', email);
      if (invite) {
        Object.assign(account, { householdId: invite.householdId, memberId: invite.memberId, role: 'member' });
        await store.remove('invites', email);
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
      if (local?.provider === 'local') {
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
        await store.put('invites', { id: member.email, householdId, memberId: member.id, invitedBy: account.email, createdAt: clock().toISOString() });
      }
      await saathi.subscribeMember?.({ email: account.email, memberId: ownerMemberId, role: 'family' });
      return publicAccount(updated);
    },

    async invite(ownerEmail, { email, name, relationship, language, role = 'family' }) {
      const owner = await store.get('accounts', normaliseEmail(ownerEmail));
      if (owner?.role !== 'owner') throw new AuthError('forbidden', 'Only the person who set up this household can invite others.');
      email = normaliseEmail(email);
      if (!EMAIL.test(email)) throw new AuthError('email', 'Please enter a valid email address.');
      const saathi = services.forHousehold(owner.householdId);
      const member = await saathi.addMember({ name, relationship, language, role, email });
      const existing = await store.get('accounts', email);
      if (existing && !existing.householdId) await store.update('accounts', email, { householdId: owner.householdId, memberId: member.id, role: 'member' });
      else if (!existing) await store.put('invites', { id: email, householdId: owner.householdId, memberId: member.id, invitedBy: owner.email, createdAt: clock().toISOString() });
      await saathi.subscribeMember?.({ email, memberId: member.id, role });
      return member;
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
