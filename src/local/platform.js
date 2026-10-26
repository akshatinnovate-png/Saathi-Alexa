import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function createLocalEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  const recent = [];
  return {
    kind: 'local-bus',
    async publish(detailType, detail, { mirrorOnly = false } = {}) {
      const event = { id: crypto.randomUUID(), time: new Date().toISOString(), 'detail-type': detailType, detail, mirrorOnly };
      recent.push(event);
      if (recent.length > 200) recent.shift();
      emitter.emit('event', event);
      return event.id;
    },
    subscribe(handler) {
      emitter.on('event', handler);
      return () => emitter.off('event', handler);
    },
    recent: () => [...recent],
  };
}

export function createLocalNotifier({ bus }) {
  return {
    kind: 'local-notifier',
    async subscribe(subscription) {
      await bus.publish('NotificationSubscription', subscription);
      return `local:${subscription.householdId}:${subscription.email}`;
    },
    async notify(notification) {
      const id = crypto.randomUUID();
      await bus.publish('NotificationSent', { id, ...notification });
      return id;
    },
  };
}

export function createLocalMedia({ dir }) {
  return {
    kind: 'local-disk',
    async save(key, body) {
      const path = join(dir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return `/media/${key}`;
    },
    async playbackUrl(ref) {
      return ref;
    },
  };
}
