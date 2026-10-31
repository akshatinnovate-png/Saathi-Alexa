import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { safeJsonReviver } from '../src/security/guards.js';
import { routeFor } from '../src/http/guard.js';
import { readCookie, createSessions } from '../src/accounts/sessions.js';
import { decide, coreCatalog, chainCheck, sessionState } from '../src/security/core.js';
import { verifySignature, sign as signWebhook, createReplayGuard } from '../src/ring/webhook.js';
import { verifyTotp, newTotpSecret } from '../src/security/totp.js';
import { createLocalMedia } from '../src/local/platform.js';
import { checkSvg } from '../public/trusted.js';
import { passwordProblem } from '../src/accounts/passwords.js';

const RUNS = Number(process.env.SAATHI_FUZZ_RUNS ?? 300);
const run = (prop) => fc.assert(prop, { numRuns: RUNS });
const catalog = coreCatalog();
const ACTIONS = catalog.actions.map((a) => a.name);
const LEVEL = Object.fromEntries(catalog.actions.map((a) => [a.name, a.level]));
const households = fc.constantFrom('h1', 'h2', 'default', '');
const principal = fc.oneof(
  fc.constant({ kind: 'anonymous' }),
  fc.record({ kind: fc.constant('open'), household: households }),
  fc.record({ kind: fc.constant('device'), household: households }),
  fc.record({ kind: fc.constant('user'), household: fc.option(households, { nil: null }), role: fc.constantFrom(null, 'owner', 'member', 'neighbour') }),
);

test('fuzz: no JSON payload can pollute object prototypes', () => {
  const poison = fc.constantFrom('__proto__', 'constructor', 'prototype');
  const value = fc.letrec((tie) => ({
    node: fc.oneof({ depthSize: 'small' }, fc.jsonValue(), fc.dictionary(fc.oneof(fc.string(), poison), tie('node'), { maxKeys: 5 })),
  })).node;
  run(fc.property(value, (v) => {
    const text = JSON.stringify(v).replaceAll('"constructor"', '"__proto__"');
    const parsed = JSON.parse(text, safeJsonReviver);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal({}.isAdmin, undefined);
    const walk = (o) => {
      if (o && typeof o === 'object') {
        assert.equal(Object.prototype.hasOwnProperty.call(o, '__proto__'), false);
        assert.equal(Object.getPrototypeOf(o) === Object.prototype || Array.isArray(o), true);
        Object.values(o).forEach(walk);
      }
    };
    walk(parsed);
  }));
});

test('fuzz: the route table never throws and only maps to actions the core knows', () => {
  const method = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE');
  const segment = fc.oneof(fc.constantFrom('care', 'security', 'vault', 'devices', '..', '%2e%2e', 'family', 'x'), fc.string({ maxLength: 12 }));
  const path = fc.array(segment, { maxLength: 6 }).map((parts) => `/${parts.join('/')}`);
  run(fc.property(method, path, (m, p) => {
    const route = routeFor(m, p);
    if (route && !route.public) assert.ok(ACTIONS.includes(route.action), `${m} ${p} -> ${route.action}`);
  }));
});

test('fuzz: the WebAssembly core agrees with the proved rules on every input', () => {
  run(fc.property(principal, fc.constantFrom(...ACTIONS), households, (p, action, household) => {
    const out = decide({ principal: p, action, household });
    if (p.kind === 'anonymous') assert.equal(out.code, 'not-signed-in');
    if (out.ok && p.kind !== 'user') assert.equal(p.household, household);
    if (out.ok && p.kind === 'user' && LEVEL[action] !== 'SignedIn') assert.equal(p.household, household);
    if (out.ok && LEVEL[action] === 'Owner') assert.equal(p.role, 'owner');
    if (out.ok && p.kind === 'device') assert.equal(LEVEL[action], 'Household');
    if (out.ok && p.role === 'neighbour') assert.ok(['Household', 'SignedIn'].includes(LEVEL[action]));
    if (!out.ok) assert.ok([401, 403].includes(out.status));
  }));
  run(fc.property(fc.string(), (junk) => {
    assert.throws(() => decide({ principal: { kind: junk }, action: junk, household: junk }));
  }));
});

test('fuzz: session lifetimes from the core are always bounded', () => {
  const t = fc.integer({ min: 0, max: 4_000_000_000_000 });
  run(fc.property(fc.constantFrom('user', 'device'), t, t, t, fc.option(t, { nil: null }), (kind, created, lastSeen, now, reauthAt) => {
    const out = sessionState({ kind, createdAt: created, lastSeenAt: lastSeen, reauthAt, now });
    const day = 86_400_000;
    if (out.valid) {
      assert.ok(now <= created + (kind === 'user' ? 30 : 400) * day);
      assert.ok(lastSeen >= created);
    }
    if (out.fresh) assert.ok(out.valid);
  }));
});

test('fuzz: any change to a history chain is detected', () => {
  run(fc.property(fc.array(fc.hexaString({ minLength: 4, maxLength: 8 }), { minLength: 1, maxLength: 8 }), fc.nat(), (macs, pick) => {
    const rows = macs.map((mac, i) => ({ seq: i + 1, expected: mac, mac }));
    const head = { seq: rows.length, mac: macs.at(-1) };
    assert.equal(chainCheck(rows, head).ok, true);
    const i = pick % rows.length;
    const edited = rows.map((r, j) => (j === i ? { ...r, expected: `${r.expected}x` } : r));
    assert.equal(chainCheck(edited, head).ok, false);
    const dropped = rows.filter((_, j) => j !== i);
    assert.equal(chainCheck(dropped, head).ok, false);
  }));
});

test('fuzz: cookie parsing and forged session tokens never crash or authenticate', async () => {
  const sessions = createSessions(randomBytes(32).toString('base64url'));
  run(fc.property(fc.string({ maxLength: 300 }), fc.string({ maxLength: 20 }), (header, name) => {
    const v = readCookie(header, name);
    assert.ok(v === null || v === undefined || typeof v === 'string');
  }));
  await fc.assert(fc.asyncProperty(fc.string({ maxLength: 200 }), async (token) => {
    assert.equal(await sessions.read(token), null);
    assert.equal(await sessions.resolve(token), null);
  }), { numRuns: RUNS });
});

test('fuzz: webhook signatures cannot be guessed or replayed', () => {
  const secret = randomBytes(24).toString('hex');
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  run(fc.property(fc.string(), fc.string(), (body, sig) => {
    assert.equal(verifySignature({ secret, signature: sig, timestamp: ts, rawBody: body, now }).ok, false);
    const replay = createReplayGuard();
    const good = signWebhook(secret, ts, body);
    assert.equal(verifySignature({ secret, signature: good, timestamp: ts, rawBody: body, now, replay }).ok, true);
    assert.equal(verifySignature({ secret, signature: good, timestamp: ts, rawBody: body, now, replay }).ok, false);
  }));
});

test('fuzz: two-step codes only accept the real code', () => {
  const secret = newTotpSecret();
  run(fc.property(fc.string({ maxLength: 10 }), (code) => {
    const step = verifyTotp(secret, code, { now: 0 });
    if (step !== null) assert.match(code.trim(), /^\d{6}$/);
  }));
});

test('fuzz: media names can never escape the media folder', async () => {
  const base = await mkdtemp(join(tmpdir(), 'saathi-fuzz-media-'));
  const keys = { signingKey: randomBytes(32), encryptionKey: randomBytes(32) };
  const piece = fc.oneof(fc.constantFrom('..', '.', '', '%2e%2e', '\\..', '..\\..', '/etc/passwd', 'C:\\Windows', 'voice', 'a.webm'), fc.string({ maxLength: 8 }));
  await fc.assert(fc.asyncProperty(fc.array(piece, { minLength: 1, maxLength: 5 }), async (parts) => {
    const dir = await mkdtemp(join(base, 'case-'));
    const root = resolve(dir);
    const media = createLocalMedia({ dir, ...keys });
    const key = parts.join('/');
    let saved = false;
    try {
      const ref = await media.save(key, Buffer.from('x'));
      const written = resolve(root, ref.slice('/media/'.length));
      assert.ok(written.startsWith(root + sep), `${key} escaped to ${written}`);
      saved = true;
    } catch (err) {
      assert.equal(err.status, 400);
    }
    const back = await media.read(key);
    if (saved) assert.equal(back.body.toString(), 'x');
    else assert.equal(back, null);
  }), { numRuns: RUNS });
});

test('fuzz: the icon gate never lets script-capable markup through', () => {
  const dangerous = fc.constantFrom('<script>x</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">', '<foreignObject>', '<iframe>', ' onload="x"', '<svg/onload=1>');
  run(fc.property(fc.string({ maxLength: 40 }), dangerous, fc.string({ maxLength: 40 }), (a, bad, b) => {
    const markup = `<svg viewBox="0 0 24 24">${a}${bad}${b}</svg>`;
    assert.throws(() => checkSvg(markup));
  }));
});

test('fuzz: password rules never crash and always reject the email as a password', () => {
  run(fc.property(fc.string({ maxLength: 80 }), fc.emailAddress(), (password, email) => {
    const problem = passwordProblem(password, { email });
    assert.ok(problem === null || typeof problem === 'string');
    assert.notEqual(passwordProblem(email, { email }), null);
  }));
});

test('the stricter icon gate still accepts every real icon and QR code', async () => {
  const { icon } = await import('../public/icons.js');
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../public/icons.js', import.meta.url), 'utf8'));
  const names = [...source.matchAll(/^\s{2}([a-zA-Z]+): '/gm)].map((m) => m[1]);
  assert.ok(names.length > 20);
  for (const name of names) assert.doesNotThrow(() => checkSvg(icon(name, { size: 24, label: name })), name);
  const QRCode = (await import('qrcode')).default;
  const qr = await QRCode.toString('https://saathi.example/device.html?code=123456', { type: 'svg', margin: 1, color: { dark: '#16181d', light: '#ffffff' } });
  assert.doesNotThrow(() => checkSvg(qr));
});
