import { EventEmitter } from 'node:events';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

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

const MEDIA_MAGIC = Buffer.from('SAATHI-MEDIA1');
const MEDIA_TYPES = { webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export function createLocalMedia({ dir, signingKey = null, encryptionKey = null, ttlSeconds = 3600, clock = () => Date.now() }) {
  const root = resolve(dir);
  const safePath = (key) => {
    const clean = String(key).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').some((part) => part === '..' || part === '.' || part === '') || !/^[\w\-./]+$/.test(clean)) return null;
    const full = resolve(root, clean);
    return full.startsWith(root + sep) ? full : null;
  };
  const sign = (path, exp) => createHmac('sha256', signingKey).update(`${path}|${exp}`).digest('base64url');

  return {
    kind: encryptionKey ? 'local-disk-encrypted' : 'local-disk',
    async save(key, body) {
      const path = safePath(key);
      if (!path) throw Object.assign(new Error('Bad media name.'), { status: 400 });
      await mkdir(dirname(path), { recursive: true });
      let data = Buffer.from(body);
      if (encryptionKey) {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
        cipher.setAAD(Buffer.from(key));
        const enc = Buffer.concat([cipher.update(data), cipher.final()]);
        data = Buffer.concat([MEDIA_MAGIC, iv, cipher.getAuthTag(), enc]);
      }
      await writeFile(path, data, { mode: 0o600 });
      return `/media/${key}`;
    },
    async playbackUrl(ref) {
      if (!signingKey || !String(ref).startsWith('/media/')) return ref;
      const bucket = 300;
      const exp = Math.ceil((clock() / 1000 + ttlSeconds) / bucket) * bucket;
      return `${ref}?exp=${exp}&sig=${sign(ref, exp)}`;
    },
    verify(urlPath, query = {}) {
      if (!signingKey) return true;
      const exp = Number(query.exp);
      if (!Number.isFinite(exp) || exp < clock() / 1000 || typeof query.sig !== 'string') return false;
      const expected = Buffer.from(sign(urlPath, exp));
      const given = Buffer.from(query.sig);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },
    async read(key) {
      const path = safePath(key);
      if (!path) return null;
      let data;
      try { data = await readFile(path); } catch { return null; }
      if (data.subarray(0, MEDIA_MAGIC.length).equals(MEDIA_MAGIC)) {
        if (!encryptionKey) return null;
        const at = MEDIA_MAGIC.length;
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(at, at + 12));
        decipher.setAAD(Buffer.from(key));
        decipher.setAuthTag(data.subarray(at + 12, at + 28));
        data = Buffer.concat([decipher.update(data.subarray(at + 28)), decipher.final()]);
      }
      return { body: data, contentType: MEDIA_TYPES[key.split('.').pop()?.toLowerCase()] ?? 'application/octet-stream' };
    },
  };
}
