import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function inlineScriptHashes(publicDir) {
  const hashes = new Set();
  for (const file of readdirSync(publicDir).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(publicDir, file), 'utf8');
    for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      hashes.add(`'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
    }
  }
  return [...hashes].sort();
}

export function contentSecurityPolicy({ scriptHashes = [], https = false, mediaHosts = [] } = {}) {
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...scriptHashes],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'"],
    'style-src-attr': ["'none'"],
    'font-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:', ...mediaHosts],
    'connect-src': ["'self'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    'require-trusted-types-for': ["'script'"],
    'trusted-types': ['saathi'],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (https) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

export const PERMISSIONS_POLICY = [
  'camera=(self)', 'microphone=(self)', 'xr-spatial-tracking=(self)', 'screen-wake-lock=(self)', 'clipboard-write=(self)',
  'geolocation=()', 'payment=()', 'usb=()', 'serial=()', 'bluetooth=()', 'hid=()', 'midi=()', 'magnetometer=()', 'gyroscope=(self)', 'accelerometer=(self)',
  'display-capture=()', 'idle-detection=()', 'interest-cohort=()', 'browsing-topics=()',
].join(', ');

export function securityHeaders({ publicDir, https = false, mediaHosts = [] }) {
  const csp = contentSecurityPolicy({ scriptHashes: inlineScriptHashes(publicDir), https, mediaHosts });
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'Permissions-Policy': PERMISSIONS_POLICY,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Origin-Agent-Cluster': '?1',
      'X-DNS-Prefetch-Control': 'off',
      'X-Permitted-Cross-Domain-Policies': 'none',
    });
    if (https) res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path.startsWith('/media/')) res.set('Cache-Control', 'no-store');
    next();
  };
}
