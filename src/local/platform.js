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

export function createLocalMedia({ dir, signingKey = null, encryptionKey = null, keyring = null, ttlSeconds = 3600, clock = () => Date.now() }) {
  const root = resolve(dir);
  const cleanKey = (key) => String(key).replace(/\\/g, '/').replace(/^\/+/, '');
  const safePath = (key) => {
    const clean = cleanKey(key);
    if (!clean || clean.split('/').some((part) => part === '..' || part === '.' || part === '') || !/^[\w\-./]+$/.test(clean)) return null;
    const full = resolve(root, clean);
    return full.startsWith(root + sep) ? full : null;
  };
  const signs = Boolean(keyring || signingKey);
  const encrypts = Boolean(keyring || encryptionKey);
  const sign = keyring
    ? async (path, exp) => (await keyring.hmac('media-links', Buffer.from(`${path}|${exp}`))).toString('base64url')
    : async (path, exp) => createHmac('sha256', signingKey).update(`${path}|${exp}`).digest('base64url');
  const seal = keyring
    ? (data, aad) => keyring.seal('media', data, aad)
    : async (data, aad) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(data), cipher.final()]);
      return { iv, tag: cipher.getAuthTag(), body };
    };
  const open = keyring
    ? (parts, aad) => keyring.open('media', parts, aad)
    : async ({ iv, tag, body }, aad) => {
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    };

  return {
    kind: encrypts ? 'local-disk-encrypted' : 'local-disk',
    async save(rawKey, body) {
      const key = cleanKey(rawKey);
      const path = safePath(key);
      if (!path) throw Object.assign(new Error('Bad media name.'), { status: 400 });
      await mkdir(dirname(path), { recursive: true });
      let data = Buffer.from(body);
      if (encrypts) {
        const { iv, tag, body: enc } = await seal(data, key);
        data = Buffer.concat([MEDIA_MAGIC, iv, tag, enc]);
      }
      await writeFile(path, data, { mode: 0o600 });
      return `/media/${key}`;
    },
    async playbackUrl(ref) {
      if (!signs || !String(ref).startsWith('/media/')) return ref;
      const bucket = 300;
      const exp = Math.ceil((clock() / 1000 + ttlSeconds) / bucket) * bucket;
      return `${ref}?exp=${exp}&sig=${await sign(ref, exp)}`;
    },
    async verify(urlPath, query = {}) {
      if (!signs) return true;
      const exp = Number(query.exp);
      if (!Number.isFinite(exp) || exp < clock() / 1000 || typeof query.sig !== 'string') return false;
      const expected = Buffer.from(await sign(urlPath, exp));
      const given = Buffer.from(query.sig);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },
    async read(rawKey) {
      const key = cleanKey(rawKey);
      const path = safePath(key);
      if (!path) return null;
      let data;
      try { data = await readFile(path); } catch { return null; }
      if (data.subarray(0, MEDIA_MAGIC.length).equals(MEDIA_MAGIC)) {
        if (!encrypts) return null;
        const at = MEDIA_MAGIC.length;
        data = await open({ iv: data.subarray(at, at + 12), tag: data.subarray(at + 12, at + 28), body: data.subarray(at + 28) }, key);
      }
      return { body: data, contentType: MEDIA_TYPES[key.split('.').pop()?.toLowerCase()] ?? 'application/octet-stream' };
    },
  };
}
