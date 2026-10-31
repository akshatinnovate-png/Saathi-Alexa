import net from 'node:net';
import dns from 'node:dns';

export const DEFAULT_ALLOW = [
  '.googleapis.com', 'accounts.google.com', 'smtp.gmail.com', 'android.clients.google.com', 'mtalk.google.com',
  'api.anthropic.com',
  '.amazonaws.com', '.amazoncognito.com',
  'api.pwnedpasswords.com',
  '.ring.com',
];

const LOOPBACK_NAMES = new Set(['localhost', 'localhost.localdomain']);

export function isLoopback(address) {
  const a = String(address).replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(a)) return a.startsWith('127.');
  if (net.isIPv6(a)) return a === '::1' || a.startsWith('::ffff:127.');
  return LOOPBACK_NAMES.has(a);
}

export function isPrivate(address) {
  const a = String(address).replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number);
    return x === 0 || x === 10 || x === 127 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || x >= 224;
  }
  if (net.isIPv6(a)) {
    if (a.startsWith('::ffff:')) return isPrivate(a.slice(7));
    return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('ff');
  }
  return false;
}

export function hostAllowed(host, allow) {
  const h = String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  if (isLoopback(h)) return true;
  if (net.isIP(h)) return false;
  return allow.some((rule) => {
    const r = rule.toLowerCase();
    return r.startsWith('.') ? h.endsWith(r) && h.length > r.length : h === r;
  });
}

export function guardedLookup(original = dns.lookup) {
  return function lookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const opts = typeof options === 'number' ? { family: options } : { ...options };
    original(hostname, opts, (err, address, family) => {
      if (err) return callback(err);
      const all = Array.isArray(address) ? address : [{ address, family }];
      const bad = all.find((a) => isPrivate(a.address) && !isLoopback(hostname));
      if (bad) {
        const error = Object.assign(new Error(`Saathi refused to connect: ${hostname} resolved to a private address (${bad.address}).`), { code: 'ESAATHIEGRESS' });
        return callback(error);
      }
      callback(null, address, family);
    });
  };
}

function targetOf(args) {
  const first = args[0];
  if (Array.isArray(first)) return targetOf(first);
  if (first && typeof first === 'object') return first.path ? { path: first.path } : { host: first.host ?? 'localhost', port: first.port, options: first };
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first };
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
}

let installed = null;

export function installEgressGuard({ allow = DEFAULT_ALLOW, extra = [], env = process.env, onBlock = null } = {}) {
  if (installed) return installed;
  const rules = [...allow, ...extra.filter(Boolean)];
  for (const proxyVar of ['HTTPS_PROXY', 'https_proxy']) {
    if (env[proxyVar]) {
      try { rules.push(new URL(env[proxyVar]).hostname); } catch { }
    }
  }
  const blocked = new Map();
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const target = targetOf(args);
    if (target.path) return original.apply(this, args);
    if (!hostAllowed(target.host, rules)) {
      blocked.set(target.host, (blocked.get(target.host) ?? 0) + 1);
      onBlock?.(target.host);
      const error = Object.assign(new Error(`Saathi blocked a connection to ${target.host}: it is not on the list of services Saathi talks to.`), { code: 'ESAATHIEGRESS', host: target.host });
      process.nextTick(() => this.destroy(error));
      return this;
    }
    if (isLoopback(target.host) || net.isIP(target.host)) return original.apply(this, args);
    if (target.options) {
      target.options.lookup = guardedLookup(target.options.lookup ?? dns.lookup);
      return original.apply(this, args);
    }
    const callback = args.find((a) => typeof a === 'function');
    return original.call(this, { port: target.port, host: target.host, lookup: guardedLookup(dns.lookup) }, callback);
  };
  installed = {
    rules,
    blocked,
    uninstall() {
      net.Socket.prototype.connect = original;
      installed = null;
    },
  };
  return installed;
}
