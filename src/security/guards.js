import { randomUUID } from 'node:crypto';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const POISON = new Set(['__proto__', 'constructor', 'prototype']);

export const safeJsonReviver = (key, value) => (POISON.has(key) ? undefined : value);

export function crossSiteGuard({ allowedOrigins = [] } = {}) {
  return (req, res, next) => {
    if (!UNSAFE.has(req.method)) return next();
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/auth/')) return next();
    const site = req.get('sec-fetch-site');
    const origin = req.get('origin');
    const own = `${req.protocol}://${req.get('host')}`;
    if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'Blocked a request from another website.' });
    if (origin && origin !== 'null' && origin !== own && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Blocked a request from another website.' });
    if (origin === 'null') return res.status(403).json({ error: 'Blocked a request from another website.' });
    next();
  };
}

export function createRateLimiter({ now = () => Date.now() } = {}) {
  const buckets = new Map();
  const sweep = setInterval(() => {
    const t = now();
    for (const [key, b] of buckets) if (t - b.updated > 15 * 60 * 1000) buckets.delete(key);
  }, 5 * 60 * 1000);
  sweep.unref?.();

  function take(key, { capacity, perMinute }) {
    const t = now();
    const b = buckets.get(key) ?? { tokens: capacity, updated: t };
    b.tokens = Math.min(capacity, b.tokens + ((t - b.updated) / 60000) * perMinute);
    b.updated = t;
    buckets.set(key, b);
    if (b.tokens < 1) return Math.ceil(((1 - b.tokens) / perMinute) * 60);
    b.tokens -= 1;
    return 0;
  }

  const middleware = (rules) => (req, res, next) => {
    const rule = rules.find((r) => req.path.startsWith(r.prefix));
    if (!rule) return next();
    const wait = take(`${rule.prefix}|${req.ip}`, rule);
    if (!wait) return next();
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  };
  return { take, middleware, stop: () => clearInterval(sweep) };
}

export const RATE_RULES = [
  { prefix: '/auth/', capacity: 30, perMinute: 20 },
  { prefix: '/hooks/', capacity: 20, perMinute: 30 },
  { prefix: '/ring/', capacity: 20, perMinute: 30 },
  { prefix: '/mcp', capacity: 300, perMinute: 300 },
  { prefix: '/api/', capacity: 400, perMinute: 400 },
];

export function errorHandler({ log = console } = {}) {
  return (err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That was too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'That request could not be read.' });
    if (err.code && err.constructor?.name === 'AuthError') return res.status(err.code === 'forbidden' ? 403 : err.code === 'limit' ? 429 : 400).json({ error: err.message, code: err.code });
    if (err.status === 400) return res.status(400).json({ error: err.message });
    const id = randomUUID();
    log.error(`error ${id}`, err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.', id });
  };
}
