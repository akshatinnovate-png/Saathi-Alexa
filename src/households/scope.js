export const DEFAULT_HOUSEHOLD = 'default';

const VALID = /^[a-z0-9][a-z0-9-]{2,40}$/;

export function isHouseholdId(id) {
  return id === DEFAULT_HOUSEHOLD || VALID.test(id ?? '');
}

export function collectionFor(householdId, collection) {
  return !householdId || householdId === DEFAULT_HOUSEHOLD ? collection : `hh#${householdId}#${collection}`;
}

export function scopeStore(store, householdId) {
  if (!householdId || householdId === DEFAULT_HOUSEHOLD) return store;
  const key = (collection) => collectionFor(householdId, collection);
  return {
    kind: store.kind,
    householdId,
    list: (collection) => store.list(key(collection)),
    get: (collection, id) => store.get(key(collection), id),
    put: (collection, item) => store.put(key(collection), item),
    update: (collection, id, patch) => store.update(key(collection), id, patch),
    remove: (collection, id) => store.remove(key(collection), id),
    async seed(data) {
      for (const [collection, items] of Object.entries(data)) {
        for (const item of items) await store.put(key(collection), item);
      }
    },
    reset: () => { throw new Error('Only the demo household can be reset'); },
  };
}

export function scopeEvents(events, householdId) {
  return {
    kind: events.kind,
    publish: (type, detail = {}, options) => events.publish(type, { householdId, ...detail }, options),
    subscribe: (...args) => events.subscribe?.(...args),
  };
}

export function scopeNotifier(notifier, householdId) {
  return {
    kind: notifier.kind,
    notify: (n) => notifier.notify({ householdId, ...n }),
    subscribe: (subscription) => notifier.subscribe?.({ householdId, ...subscription }),
  };
}
