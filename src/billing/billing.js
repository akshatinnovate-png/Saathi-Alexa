import { createHmac, timingSafeEqual } from 'node:crypto';

export const SAFETY = new Set(['help-escalation', 'scam-protection', 'scam-guard', 'scam-network', 'medicine-reminders', 'family-app', 'alexa', 'mcp']);

export const PLANS = {
  free: { name: 'Saathi Free', price: '₹0', elders: 1, features: [] },
  family: { name: 'Family', price: '₹299/month or ₹2,999/year', elders: 1, features: ['saathi-calls', 'whatsapp-summaries', 'insight', 'doctor-report', 'family-voice'] },
  'family-plus': { name: 'Family Plus', price: '₹599/month', elders: 2, features: ['saathi-calls', 'whatsapp-summaries', 'insight', 'doctor-report', 'family-voice', 'two-calls', 'unlimited-members'] },
  agency: { name: 'Care Agency', price: '₹149 per elder per month', elders: Infinity, features: ['saathi-calls', 'whatsapp-summaries', 'insight', 'doctor-report', 'family-voice', 'agency-console'] },
  clinic: { name: 'Clinic', price: 'from ₹2,999/month', elders: Infinity, features: ['insight', 'doctor-report', 'clinic-view'] },
  gift: { name: 'Gift a Saathi', price: 'Sponsored', elders: 1, features: ['saathi-calls', 'whatsapp-summaries', 'insight', 'doctor-report', 'family-voice'] },
};

const API = 'https://api.razorpay.com/v1';
const GRACE_MS = 7 * 24 * 3600 * 1000;
const STATUS = {
  'subscription.authenticated': 'active',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.resumed': 'active',
  'subscription.pending': 'past_due',
  'subscription.halted': 'past_due',
  'subscription.paused': 'paused',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'cancelled',
};

export function createBilling({ provider = null, keyId, keySecret, webhookSecret, planIds = {}, store, fetchImpl = fetch, clock = () => new Date(), onNotice = async () => {} } = {}) {
  const enabled = provider === 'razorpay' && Boolean(keyId && keySecret && webhookSecret);
  const auth = enabled ? `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` : null;

  async function razorpay(path, body) {
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch {
      throw Object.assign(new Error('The payment service could not be reached. Please try again in a minute.'), { status: 502 });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error?.description ?? `The payment service answered ${res.status}`), { status: 502 });
    return json;
  }

  const subscriptionOf = async (householdId) => (await store.get('subscriptions', householdId)) ?? { id: householdId, plan: 'free', status: 'active' };

  async function status(householdId) {
    const sub = await subscriptionOf(householdId);
    const now = clock().getTime();
    const inGrace = sub.status === 'past_due' && sub.graceUntil && Date.parse(sub.graceUntil) > now;
    const live = sub.status === 'active' || inGrace;
    return {
      enabled,
      plan: sub.plan,
      planName: PLANS[sub.plan]?.name ?? sub.plan,
      status: sub.status,
      paidExtras: enabled ? (live ? PLANS[sub.plan]?.features ?? [] : []) : 'all',
      renewsAt: sub.currentEnd ?? null,
      graceUntil: inGrace ? sub.graceUntil : null,
      plans: Object.entries(PLANS).filter(([id]) => id !== 'gift').map(([id, p]) => ({ id, name: p.name, price: p.price, features: p.features, available: id === 'free' || Boolean(planIds[id]) })),
    };
  }

  return {
    enabled,

    status,

    async entitled(householdId, feature) {
      if (!enabled || SAFETY.has(feature)) return true;
      const s = await status(householdId);
      return s.paidExtras.includes(feature);
    },

    async checkout(householdId, { plan, email }) {
      if (!enabled) throw Object.assign(new Error('Payments are not set up on this Saathi; everything is already included.'), { status: 400 });
      if (!planIds[plan]) throw Object.assign(new Error('That plan is not available.'), { status: 400 });
      const sub = await razorpay('/subscriptions', { plan_id: planIds[plan], total_count: 120, customer_notify: 1, notes: { householdId, plan, email: email ?? '' } });
      await store.put('subscriptions', { ...(await subscriptionOf(householdId)), id: householdId, pending: { plan, subscriptionId: sub.id, at: clock().toISOString() } });
      return { url: sub.short_url, subscriptionId: sub.id };
    },

    async cancel(householdId) {
      const sub = await subscriptionOf(householdId);
      if (!enabled || !sub.subscriptionId) return { plan: 'free', status: 'cancelled' };
      await razorpay(`/subscriptions/${encodeURIComponent(sub.subscriptionId)}/cancel`, { cancel_at_cycle_end: 0 });
      const next = { ...sub, plan: 'free', status: 'cancelled', cancelledAt: clock().toISOString() };
      await store.put('subscriptions', next);
      return { plan: 'free', status: 'cancelled' };
    },

    verify(rawBody, signature) {
      if (!enabled || !signature) return false;
      const expected = Buffer.from(createHmac('sha256', webhookSecret).update(String(rawBody ?? '')).digest('hex'));
      const given = Buffer.from(String(signature));
      return expected.length === given.length && timingSafeEqual(expected, given);
    },

    async webhook(event) {
      const status = STATUS[event?.event];
      const entity = event?.payload?.subscription?.entity;
      const householdId = entity?.notes?.householdId;
      if (!status || !householdId) return { ignored: true };
      const sub = await subscriptionOf(householdId);
      const plan = entity.notes?.plan && PLANS[entity.notes.plan] ? entity.notes.plan : sub.pending?.plan ?? sub.plan;
      const next = {
        ...sub, id: householdId, plan: status === 'cancelled' ? 'free' : plan, status, subscriptionId: entity.id,
        currentEnd: entity.current_end ? new Date(entity.current_end * 1000).toISOString() : sub.currentEnd ?? null,
        pending: null,
      };
      if (status === 'past_due' && sub.status !== 'past_due') {
        next.graceUntil = new Date(clock().getTime() + GRACE_MS).toISOString();
        await onNotice(householdId, `Saathi could not take this month's payment for the ${PLANS[plan]?.name ?? plan} plan. Everything that keeps your family safe keeps working. Daily calls and the other extras will pause in 7 days unless the payment goes through; you can update it from Settings, Plan.`);
      }
      if (status === 'active') next.graceUntil = null;
      await store.put('subscriptions', next);
      return { householdId, status, plan: next.plan };
    },
  };
}
