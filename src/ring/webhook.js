import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-saathi-ring-signature';
export const TIMESTAMP_HEADER = 'x-saathi-ring-timestamp';
const MAX_SKEW_SECONDS = 300;

export function sign(secret, timestamp, rawBody) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export function verifySignature({ secret, signature, timestamp, rawBody, now = Date.now() }) {
  if (!signature || !timestamp) return { ok: false, reason: 'missing signature' };
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: 'stale timestamp' };
  const expected = Buffer.from(sign(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad signature' };
  return { ok: true };
}

export function normaliseRingEvent(payload) {
  const kind = payload.kind ?? payload.event;
  if (!['ding', 'motion'].includes(kind)) throw new Error(`Unsupported Ring event kind: ${kind}`);
  return {
    kind,
    deviceId: String(payload.doorbot_id ?? payload.device_id ?? 'front-door'),
    at: payload.created_at ?? new Date().toISOString(),
  };
}

export function createRingSimulator({ url, secret, fetchImpl = fetch }) {
  return {
    async trigger(kind, deviceId = 'front-door') {
      const body = JSON.stringify({ kind, doorbot_id: deviceId, doorbot_description: 'Front Door', created_at: new Date().toISOString() });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign(secret, timestamp, body), [TIMESTAMP_HEADER]: timestamp },
        body,
      });
      if (!res.ok) throw new Error(`Ring webhook rejected: ${res.status}`);
      return res.json();
    },
  };
}
