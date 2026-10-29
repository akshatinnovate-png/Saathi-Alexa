import { chainLink, chainCheck } from './core.js';

const GENESIS = 'saathi-audit-genesis';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
};

export function createAuditLog({ store, key = null, keyring = null, clock = () => new Date() }) {
  const queues = new Map();
  const link = keyring
    ? async (prev, text) => (await keyring.hmac('audit', Buffer.from(`${prev}\n${text}`, 'utf8'))).toString('base64url')
    : async (prev, text) => chainLink(key, prev, text);
  const sign = (prev, entry) => link(prev, canonical(entry));
  const scope = (householdId) => householdId ?? 'global';

  function append({ householdId = null, actor = null, action, detail = {}, ip = null }) {
    const chain = scope(householdId);
    const run = (queues.get(chain) ?? Promise.resolve()).then(async () => {
      const head = (await store.get('auditHeads', chain)) ?? { id: chain, seq: 0, mac: GENESIS };
      const seq = head.seq + 1;
      const entry = { chain, seq, at: clock().toISOString(), actor, action, detail, ip };
      const mac = await sign(head.mac, entry);
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
    const rows = [];
    let prev = GENESIS;
    for (const { id, mac, ...entry } of list) {
      rows.push({ seq: entry.seq, expected: await sign(prev, entry), mac });
      prev = mac;
    }
    const out = chainCheck(rows, head ? { seq: head.seq, mac: head.mac } : null);
    return out.ok ? { ok: true, entries: out.entries } : { ok: false, brokenAt: out.brokenAt, reason: out.reason };
  }

  return { append, entries, verify };
}
