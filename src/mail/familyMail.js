import { scopeStore, DEFAULT_HOUSEHOLD } from '../households/scope.js';
import { inviteEmail, alertEmail, testEmail } from './templates.js';

const AUDIENCE_ROLES = { family: ['family'], neighbour: ['neighbour'], everyone: ['family', 'neighbour'] };

export function createFamilyMail({ store, mailer, google = null, vault = null, publicUrl }) {
  const senders = new Map();
  const household = (id) => scopeStore(store, id ?? DEFAULT_HOUSEHOLD);

  async function connection(householdId) {
    return store.get('mailConnections', householdId ?? DEFAULT_HOUSEHOLD);
  }

  async function senderFor(householdId) {
    const conn = await connection(householdId);
    if (!conn || !google || !vault) return null;
    const key = `${householdId}:${conn.connectedAt}`;
    if (!senders.has(key)) senders.set(key, google.gmailSender({ email: conn.email, name: conn.name, refreshToken: await vault.open(conn.refreshToken) }));
    return senders.get(key);
  }

  async function elderName(householdId) {
    return (await household(householdId).get('profile', 'elder'))?.preferredName ?? 'your family';
  }

  return {
    publicUrl,
    get kind() { return mailer.kind; },

    async status(householdId) {
      const conn = await connection(householdId);
      return {
        service: mailer.kind,
        real: mailer.real || Boolean(conn),
        from: conn?.email ?? mailer.from,
        gmail: conn ? { email: conn.email, connectedBy: conn.connectedBy, connectedAt: conn.connectedAt } : null,
        googleAvailable: Boolean(google),
      };
    },

    async connectGmail(householdId, { email, name, refreshToken, by, now = new Date() }) {
      if (!vault) throw new Error('Gmail connection needs a session secret.');
      await store.put('mailConnections', { id: householdId, email, name, refreshToken: await vault.seal(refreshToken), connectedBy: by, connectedAt: now.toISOString() });
    },

    async disconnectGmail(householdId) {
      return store.remove('mailConnections', householdId);
    },

    async sendInvite({ householdId, inviterName, member, token }) {
      const link = `${publicUrl}/join.html?invite=${encodeURIComponent(token)}`;
      if (!member.email) return { link, emailed: false };
      const mail = inviteEmail({ inviter: inviterName, elder: await elderName(householdId), link, language: member.language });
      try {
        const out = await mailer.send({ to: member.email, ...mail, fromName: `${inviterName} via Saathi` }, { via: await senderFor(householdId) });
        return { link, emailed: Boolean(out.id), via: out.kind };
      } catch (err) {
        console.error(`invite email to ${member.email} failed:`, err.message);
        return { link, emailed: false, error: err.message };
      }
    },

    async sendTest(householdId, { to, name }) {
      const out = await mailer.send({ to, ...testEmail({ name, link: `${publicUrl}/family.html` }) }, { via: await senderFor(householdId) });
      return { sent: Boolean(out.id), via: out.kind, skipped: Boolean(out.skipped) };
    },

    wrapNotifier(notifier) {
      return {
        ...notifier,
        kind: `${notifier.kind}+email`,
        async notify(n) {
          const id = await notifier.notify(n);
          const roles = AUDIENCE_ROLES[n.audience] ?? ['family'];
          try {
            const circle = await household(n.householdId).list('circle');
            const recipients = circle.filter((p) => p.email && roles.includes(p.role ?? 'family') && (!n.recipientId || n.recipientId === p.id));
            const via = await senderFor(n.householdId);
            const mail = alertEmail({ subject: n.subject, message: n.message, severity: n.severity, link: `${publicUrl}/family.html` });
            await Promise.all(recipients.map((p) => mailer.send({ to: p.email, ...mail }, { via }).catch((err) => console.error(`alert email to ${p.email} failed:`, err.message))));
          } catch (err) {
            console.error('alert emails failed:', err.message);
          }
          return id;
        },
      };
    },
  };
}
