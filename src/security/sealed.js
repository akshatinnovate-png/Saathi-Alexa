export const CLASS_B = {
  medications: ['name', 'purpose', 'description', 'phrase', 'short', 'i18n'],
  appointments: ['title', 'with', 'place', 'i18n'],
  checkins: ['text', 'english'],
  stories: ['title', 'text', 'translations'],
  homeItems: ['name', 'note', 'aliases', 'i18n'],
  messages: ['text', 'translations', 'translated'],
  letters: ['text', 'html', 'sections'],
  alerts: ['words', 'reason'],
  profile: ['medical'],
};

const MARK = 'b1.';

export function sealRecords(store, { keyring, householdId, plan = CLASS_B }) {
  if (!keyring) return store;
  const aad = (collection, id) => `class-b|${householdId ?? 'default'}|${collection}|${id}`;

  async function seal(collection, item) {
    const fields = plan[collection];
    if (!fields || !item || typeof item !== 'object' || item.id == null) return item;
    const secret = {};
    const rest = { ...item };
    for (const f of fields) {
      if (f in rest) {
        secret[f] = rest[f];
        delete rest[f];
      }
    }
    delete rest.$b;
    if (!Object.keys(secret).length) return rest;
    const { iv, tag, body } = await keyring.seal('class-b', Buffer.from(JSON.stringify(secret), 'utf8'), aad(collection, item.id));
    rest.$b = MARK + Buffer.concat([iv, tag, body]).toString('base64url');
    return rest;
  }

  async function open(collection, item) {
    if (!item || typeof item !== 'object' || typeof item.$b !== 'string') return item;
    if (!item.$b.startsWith(MARK)) throw new Error(`Unknown sealed format in ${collection}/${item.id}`);
    const raw = Buffer.from(item.$b.slice(MARK.length), 'base64url');
    let secret;
    try {
      secret = JSON.parse((await keyring.open('class-b', { iv: raw.subarray(0, 12), tag: raw.subarray(12, 28), body: raw.subarray(28) }, aad(collection, item.id))).toString('utf8'));
    } catch {
      throw new Error(`The sealed record ${collection}/${item.id} was changed or belongs elsewhere.`);
    }
    const { $b, ...rest } = item;
    return { ...rest, ...secret };
  }

  const sealed = (collection) => Boolean(plan[collection]);

  return {
    ...store,
    kind: store.kind,
    householdId: store.householdId ?? householdId,
    sealing: true,
    async list(collection) {
      const items = await store.list(collection);
      return sealed(collection) ? Promise.all(items.map((i) => open(collection, i))) : items;
    },
    async get(collection, id) {
      const item = await store.get(collection, id);
      return sealed(collection) ? open(collection, item) : item;
    },
    async put(collection, item) {
      await store.put(collection, sealed(collection) ? await seal(collection, item) : item);
      return item;
    },
    async update(collection, id, patch) {
      if (!sealed(collection)) return store.update(collection, id, patch);
      const current = await this.get(collection, id);
      if (!current) return null;
      const next = { ...current, ...patch };
      await store.put(collection, await seal(collection, next));
      return next;
    },
    remove: (collection, id) => store.remove(collection, id),
    async migrate() {
      let count = 0;
      for (const collection of Object.keys(plan)) {
        for (const item of await store.list(collection)) {
          if (item && item.$b === undefined && plan[collection].some((f) => f in item)) {
            await store.put(collection, await seal(collection, item));
            count++;
          }
        }
      }
      return count;
    },
    async seed(data) {
      for (const [collection, items] of Object.entries(data)) {
        for (const item of items) await this.put(collection, item);
      }
    },
  };
}
