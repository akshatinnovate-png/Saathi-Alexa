import { chainLink, chainVerify } from './core.js';

const GENESIS = 'saathi-audit-genesis';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
};

export function createAuditLog({ store, key, clock = () => new Date() }) {
  const queues = new Map();
  const sign = (prev, entry) => chainLink(key, prev, canonical(entry));
  const scope = (householdId) => householdId ?? 'global';

  function append({ householdId = null, actor = null, action, detail = {}, ip = null }) {
    const chain = scope(householdId);
    const run = (queues.get(chain) ?? Promise.resolve()).then(async () => {
      const head = (await store.get('auditHeads', chain)) ?? { id: chain, seq: 0, mac: GENESIS };
      const seq = head.seq + 1;
      const entry = { chain, seq, at: clock().toISOString(), actor, action, detail, ip };
      const mac = sign(head.mac, entry);
      await store.put('audit', { id: `${chain}:${String(seq).padStart(9, '0')}`, ...entry, mac });
      await store.put('auditHeads', { id: chain, seq, mac });
      return { ...entry, mac };
    });
    queues.set(chain, run.catch(() => {}));
    return run;
  }

  async function entries(householdId) {
    const chain = scope(householdId);
    return (await store.list('audit')).filter((e) => e.chain === chain).sort((a, b) => a.seq - b.seq);
  }

  async function verify(householdId) {
    const chain = scope(householdId);
    const list = await entries(householdId);
    const head = await store.get('auditHeads', chain);
    const rows = list.map(({ id, mac, ...entry }) => ({ seq: entry.seq, canonical: canonical(entry), mac }));
    const out = chainVerify(key, rows, head ? { seq: head.seq, mac: head.mac } : null);
    return out.ok ? { ok: true, entries: out.entries } : { ok: false, brokenAt: out.brokenAt, reason: out.reason };
  }

  return { append, entries, verify };
}
