import { randomUUID } from 'node:crypto';
import { bad } from './media.js';

const KINDS = ['fall', 'still'];

function locationOf(input) {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const accuracy = Number(input?.accuracy);
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null };
}

export function createRaksha({ services, clock = () => new Date(), answerSeconds = 45, setTimer = setTimeout }) {
  const recordsFor = (h) => services.forHousehold(h).featureStore('rakshaEvents');

  async function escalate(householdId, id) {
    const records = await recordsFor(householdId);
    const check = await records.get(id);
    if (!check || check.status !== 'waiting') return null;
    const out = await services.forHousehold(householdId).rakshaAlert({ kind: check.kind, location: check.location });
    await records.update(id, { status: 'escalated', alertId: out.alertId, resolvedAt: clock().toISOString() });
    return out;
  }

  return {
    answerSeconds,

    async settings(householdId) {
      const me = await services.forHousehold(householdId).elder();
      return me?.raksha ?? { enabled: false, stillness: false, stillHours: 3, from: '08:00', to: '20:00' };
    },

    async check(householdId, input = {}) {
      const kind = KINDS.includes(input.kind) ? input.kind : null;
      if (!kind) throw bad('Unknown check.');
      const settings = await this.settings(householdId);
      if (!settings.enabled) throw bad('Saathi Raksha is switched off for this household.', 409);
      if (kind === 'still' && !settings.stillness) throw bad('Stillness checks are switched off.', 409);
      const records = await recordsFor(householdId);
      const waiting = (await records.list()).find((r) => r.status === 'waiting');
      if (waiting) return { id: waiting.id, seconds: Math.max(0, Math.round((Date.parse(waiting.deadline) - clock().getTime()) / 1000)), duplicate: true };
      const id = `raksha-${randomUUID().slice(0, 8)}`;
      const deadline = new Date(clock().getTime() + answerSeconds * 1000).toISOString();
      await records.put({ id, kind, status: 'waiting', location: locationOf(input), createdAt: clock().toISOString(), deadline, source: String(input.source ?? 'device').slice(0, 20) });
      await services.forHousehold(householdId).rakshaAsk({ checkId: id, kind, seconds: answerSeconds });
      const timer = setTimer(() => { escalate(householdId, id).catch((err) => console.error('raksha escalation failed', err)); }, answerSeconds * 1000);
      timer?.unref?.();
      return { id, seconds: answerSeconds };
    },

    async answer(householdId, id, { fine, location } = {}) {
      const records = await recordsFor(householdId);
      const check = await records.get(String(id));
      if (!check) throw bad('No such check.', 404);
      if (check.status !== 'waiting') return { status: check.status, alertId: check.alertId ?? null };
      if (location && !check.location) await records.update(check.id, { location: locationOf(location) });
      if (fine === true) {
        await records.update(check.id, { status: 'fine', resolvedAt: clock().toISOString() });
        return { status: 'fine' };
      }
      const out = await escalate(householdId, check.id);
      return { status: 'escalated', alertId: out?.alertId ?? null };
    },

    async sweep(householdId) {
      const due = (await (await recordsFor(householdId)).list()).filter((r) => r.status === 'waiting' && Date.parse(r.deadline) <= clock().getTime());
      for (const r of due) await escalate(householdId, r.id);
      return due.length;
    },

    async recent(householdId) {
      return (await (await recordsFor(householdId)).list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10)
        .map((r) => ({ id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt, hasLocation: Boolean(r.location), ...(r.status === 'waiting' ? { secondsLeft: Math.max(0, Math.round((Date.parse(r.deadline) - clock().getTime()) / 1000)) } : {}) }));
    },
  };
}
