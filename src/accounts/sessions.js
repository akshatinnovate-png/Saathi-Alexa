import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'saathi_session';
const MAX_AGE_SECONDS = 30 * 24 * 3600;

export async function sessionSecret(store, configured) {
  if (configured) return configured;
  const existing = await store.get('meta', 'session-secret');
  if (existing) return existing.value;
  const value = randomBytes(32).toString('base64url');
  await store.put('meta', { id: 'session-secret', value });
  return value;
}

export function createSessions(secret) {
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    issue(claims, maxAge = MAX_AGE_SECONDS) {
      const payload = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + maxAge })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    read(token) {
      const [payload, mac] = String(token ?? '').split('.');
      if (!payload || !mac) return null;
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(mac);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return claims.exp > Date.now() / 1000 ? claims : null;
      } catch {
        return null;
      }
    },
    maxAge: MAX_AGE_SECONDS,
  };
}

export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function cookieHeader(name, value, { maxAge, secure }) {
  return [
    `${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${maxAge}`, secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}
