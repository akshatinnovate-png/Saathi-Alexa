import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'saathi_session';
export const SECURE_SESSION_COOKIE = '__Host-saathi_session';
const DAY = 24 * 3600;
const POLICY = {
  user: { idle: 7 * DAY, absolute: 30 * DAY },
  device: { idle: 90 * DAY, absolute: 400 * DAY },
};
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export async function sessionSecret(store, configured) {
  if (configured) return configured;
  const existing = await store.get('meta', 'session-secret');
  if (existing) return existing.value;
  const value = randomBytes(32).toString('base64url');
  await store.put('meta', { id: 'session-secret', value });
  return value;
}

function memoryStore() {
  const rows = new Map();
  return {
    async list() { return [...rows.values()].map((r) => structuredClone(r)); },
    async get(_c, id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
    async put(_c, item) { rows.set(item.id, structuredClone(item)); return item; },
    async update(_c, id, patch) { if (!rows.has(id)) return null; Object.assign(rows.get(id), patch); return structuredClone(rows.get(id)); },
    async remove(_c, id) { return rows.delete(id); },
  };
}

export function describeAgent(ua = '') {
  const text = String(ua);
  const browser = /Edg\//.test(text) ? 'Edge' : /OPR\//.test(text) ? 'Opera' : /Firefox\//.test(text) ? 'Firefox' : /Chrome\//.test(text) ? 'Chrome' : /Safari\//.test(text) ? 'Safari' : /Silk\//.test(text) ? 'Silk' : 'A browser';
  const os = /Windows/.test(text) ? 'Windows' : /Android/.test(text) ? 'Android' : /iPhone|iPad/.test(text) ? 'iPhone or iPad' : /Mac OS X/.test(text) ? 'Mac' : /CrOS/.test(text) ? 'Chromebook' : /Linux/.test(text) ? 'Linux' : 'an unknown system';
  return `${browser} on ${os}`;
}

export function createSessions(secret, { store = memoryStore(), clock = () => new Date() } = {}) {
  const mac = (value) => createHmac('sha256', secret).update(value).digest('base64url');
  const hashId = (id) => createHash('sha256').update(id).digest('base64url');
  const sameMac = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const now = () => clock().getTime();

  function issue(claims, maxAge = 600) {
    const payload = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(now() / 1000) + maxAge })).toString('base64url');
    return `${payload}.${mac(payload)}`;
  }

  function read(token) {
    const [payload, signature] = String(token ?? '').split('.');
    if (!payload || !signature || !sameMac(mac(payload), signature)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return claims.exp > now() / 1000 ? claims : null;
    } catch {
      return null;
    }
  }

  async function start({ email = null, deviceId = null, userAgent = '', mfa = [] }) {
    const kind = deviceId ? 'device' : 'user';
    const raw = randomBytes(32).toString('base64url');
    const at = now();
    const record = {
      id: hashId(raw), kind, email, deviceId, mfa,
      createdAt: new Date(at).toISOString(), lastSeenAt: new Date(at).toISOString(),
      expiresAt: new Date(at + POLICY[kind].absolute * 1000).toISOString(),
      agent: describeAgent(userAgent),
    };
    await store.put('sessions', record);
    return { cookie: `s1.${raw}.${mac(`s1.${raw}`)}`, maxAge: POLICY[kind].absolute, record };
  }

  async function resolve(cookie) {
    const [version, raw, signature] = String(cookie ?? '').split('.');
    if (version !== 's1' || !raw || !signature || !sameMac(mac(`s1.${raw}`), signature)) return null;
    const record = await store.get('sessions', hashId(raw));
    if (!record) return null;
    const at = now();
    const idleLimit = Date.parse(record.lastSeenAt) + POLICY[record.kind].idle * 1000;
    if (at > Date.parse(record.expiresAt) || at > idleLimit) {
      await store.remove('sessions', record.id);
      return null;
    }
    if (at - Date.parse(record.lastSeenAt) > TOUCH_EVERY_MS) {
      await store.update('sessions', record.id, { lastSeenAt: new Date(at).toISOString() });
    }
    return record;
  }

  return {
    issue,
    read,
    start,
    resolve,
    maxAge: POLICY.user.absolute,
    update: (id, patch) => store.update('sessions', id, patch),
    async revoke(id) {
      return store.remove('sessions', id);
    },
    async revokeWhere(match, { except = null } = {}) {
      let count = 0;
      for (const s of await store.list('sessions')) {
        if (s.id !== except && match(s)) {
          await store.remove('sessions', s.id);
          count += 1;
        }
      }
      return count;
    },
    async list(match) {
      return (await store.list('sessions')).filter(match).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    },
  };
}

export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try { return decodeURIComponent(v.join('=')); } catch { return null; }
    }
  }
  return null;
}

export function cookieHeader(name, value, { maxAge, secure, sameSite = 'Lax' }) {
  return [
    `${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`,
    `Max-Age=${maxAge}`, secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}
