import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES } from '../src/http/guard.js';

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const target = option('--target');
const reportFile = option('--report');
const PASSWORD = process.env.ATTACK_DEMO_PASSWORD ?? 'saathi-demo-2026';
const PUBLIC_HOST = 'saathi.attack.test';
const PORT = Number(process.env.ATTACK_PORT ?? 8799);

let base;
let hostHeader;
let server = null;
let serverLog = '';

if (target) {
  const url = new URL(target);
  base = url;
  hostHeader = url.host;
} else {
  const dir = mkdtempSync(join(tmpdir(), 'saathi-attack-'));
  server = spawn(process.execPath, ['src/index.js'], {
    env: {
      ...process.env, SAATHI_DEMO: 'true', SAATHI_BREACH_CHECK: 'off', SAATHI_METRICS: 'off', PORT: String(PORT), HOST: '127.0.0.1',
      SAATHI_DATA_FILE: join(dir, 'saathi.json'), SAATHI_PUBLIC_URL: `https://${PUBLIC_HOST}`, SAATHI_RING_WEBHOOK_SECRET: 'attack-suite-ring-secret-0123456789',
      SAATHI_SESSION_SECRET: 'attack-suite-session-secret-0123456789abcdef', SAATHI_ENV_FILE: join(dir, 'none.env'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  base = new URL(`http://127.0.0.1:${PORT}`);
  hostHeader = PUBLIC_HOST;
}

function call(method, path, { body, headers = {}, jar = null, raw = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body)));
    const send = base.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send({
      hostname: base.hostname, port: base.port || (base.protocol === 'https:' ? 443 : 80), method, path,
      headers: {
        host: hostHeader, 'x-forwarded-proto': 'https', 'user-agent': 'saathi-attack-suite',
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...(jar?.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        for (const c of [res.headers['set-cookie'] ?? []].flat()) {
          const [pair] = c.split(';');
          const at = pair.indexOf('=');
          if (jar && at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
        }
        let json = null;
        try { json = JSON.parse(text); } catch { }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(email, password = PASSWORD) {
  const jar = new Map();
  const res = await call('POST', '/auth/login', { body: { email, password }, jar });
  return { jar, res };
}

const results = [];
let section = '';
const check = (ok, name, detail = '') => {
  results.push({ section, name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${section}: ${name}${ok || !detail ? '' : `  (${String(detail).slice(0, 200)})`}`);
};
const skip = (name, why) => { results.push({ section, name, ok: true, skipped: why }); console.log(`SKIP  ${section}: ${name} (${why})`); };
const denied = (r) => r.status === 401 || r.status === 403 || r.status === 404;
const leaksInternals = (text) => /\bat [\w.<>]+ \(|node:internal|\/src\/[\w/]+\.js|[A-Z]:\\\\|stack/i.test(text);

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { if ((await call('GET', '/healthz')).status === 200) return true; } catch { }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function run() {
  if (!(await waitForServer())) throw new Error(`Saathi did not answer at ${base.href}`);

  section = 'Headers';
  const home = await call('GET', '/');
  const csp = home.headers['content-security-policy'] ?? '';
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) ?? '';
  check(csp && !/unsafe-inline|unsafe-eval/.test(scriptSrc), 'script-src has no unsafe-inline or unsafe-eval', scriptSrc);
  check(/frame-ancestors 'none'/.test(csp), "frame-ancestors 'none'", csp);
  check(/object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), "object-src and base-uri are 'none'", csp);
  check(/require-trusted-types-for 'script'/.test(csp), 'Trusted Types are required', csp);
  check(home.headers['x-frame-options'] === 'DENY', 'X-Frame-Options: DENY', home.headers['x-frame-options']);
  check(home.headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff');
  check(home.headers['referrer-policy'] === 'no-referrer', 'Referrer-Policy: no-referrer', home.headers['referrer-policy']);
  check(home.headers['cross-origin-opener-policy'] === 'same-origin', 'Cross-Origin-Opener-Policy: same-origin');
  check(/max-age=\d{8,}/.test(home.headers['strict-transport-security'] ?? ''), 'HSTS with a long max-age over https', home.headers['strict-transport-security']);
  check(!home.headers['x-powered-by'], 'no X-Powered-By banner', home.headers['x-powered-by']);
  check(Boolean(home.headers['permissions-policy']), 'Permissions-Policy is set');

  section = 'Host header';
  const hostLeaks = [];
  for (const path of ['/', '/login.html', '/api/session', '/mcp']) {
    const r = await call('GET', path, { headers: { host: 'evil.example' } });
    if (![400, 403, 421].includes(r.status)) hostLeaks.push(`${path} -> ${r.status}`);
  }
  check(hostLeaks.length === 0, 'pages, the API and MCP refuse a foreign Host header (DNS rebinding, cache poisoning)', hostLeaks.join(', '));

  section = 'Anonymous access';
  const anonymousOpen = [];
  for (const [method, pattern] of API_ROUTES) {
    const path = `/api${pattern.source.replace(/^\^|\$$/g, '').replace(/\\\//g, '/').replace('(/.*)?', '/status').replace(/\[\^\/\]\+|\[\\w-\]\+/g, 'x').replace(/\((\w+)\|[^)]*\)/g, '$1').replace(/\\/g, '')}`;
    const r = await call(method, path, { body: method === 'GET' || method === 'DELETE' ? undefined : {} });
    if (r.status !== 401 && r.status !== 403) anonymousOpen.push(`${method} ${path} -> ${r.status}`);
  }
  check(anonymousOpen.length === 0, `all ${API_ROUTES.length} API routes refuse a caller who is not signed in`, anonymousOpen.join(', '));
  const page = await call('GET', '/family.html');
  check(page.status === 302 && /login/.test(page.headers.location ?? ''), 'the family page redirects to sign-in', `${page.status} ${page.headers.location}`);
  const mcp = await call('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }, headers: { accept: 'application/json, text/event-stream' } });
  check(mcp.status === 401, 'MCP refuses a caller with no token when Saathi is public', mcp.status);
  const mcpFake = await call('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers: { accept: 'application/json, text/event-stream', authorization: 'Bearer saathi-guess-123' } });
  check(mcpFake.status === 401, 'MCP refuses a made-up token', mcpFake.status);

  section = 'Sign-in';
  const unknown = await call('POST', '/auth/login', { body: { email: 'nobody-here@attack.test', password: 'Wrong-password-123' } });
  const known = await call('POST', '/auth/login', { body: { email: 'anand@saathi.demo', password: 'Wrong-password-123' } });
  check(unknown.status === known.status && unknown.json?.error === known.json?.error, 'an unknown email and a wrong password look the same', `${unknown.status} "${unknown.json?.error}" vs ${known.status} "${known.json?.error}"`);
  const owner = await login('riya@saathi.demo');
  if (owner.res.status !== 200) throw new Error(`could not sign in as the demo owner (${owner.res.status}); is this a demo install?`);
  const setCookie = [owner.res.headers['set-cookie'] ?? []].flat().find((c) => /saathi_session/.test(c)) ?? '';
  check(/^__Host-/.test(setCookie), 'the session cookie uses the __Host- prefix', setCookie.split(';')[0]);
  check(/HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie) && /SameSite=(Lax|Strict)/i.test(setCookie) && /Path=\//.test(setCookie), 'the session cookie is HttpOnly, Secure, SameSite and Path=/', setCookie.replace(/=[^;]+/, '=…'));
  const redirect = await call('POST', '/auth/login', { body: { email: 'anand@saathi.demo', password: PASSWORD, next: '//evil.example/x' } });
  check(!String(redirect.json?.next ?? '').startsWith('//') && !/evil/.test(String(redirect.json?.next ?? '')), 'sign-in never sends people to another site', redirect.json?.next);
  const malformed = await call('POST', '/auth/login', { raw: Buffer.from('{"email": "x", '), headers: { 'content-type': 'application/json' } });
  check(malformed.status >= 400 && malformed.status < 500 && !leaksInternals(malformed.text), 'broken JSON gets a plain error, no stack trace', malformed.text.slice(0, 120));

  section = 'Cross-site requests';
  const csrf = await call('POST', '/api/family/message', { jar: owner.jar, body: { text: 'csrf' }, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  check(csrf.status === 403, 'a write from another site is refused', csrf.status);
  const nullOrigin = await call('POST', '/api/family/message', { jar: owner.jar, body: { text: 'csrf' }, headers: { origin: 'null' } });
  check(nullOrigin.status === 403, 'a write with Origin: null is refused', nullOrigin.status);

  section = 'Roles';
  const member = await login('anand@saathi.demo');
  const neighbour = await login('meera@saathi.demo');
  const profile = await call('PUT', '/api/household/profile', { jar: member.jar, body: { alexaPrivacy: { medicinePurposes: true } } });
  check(profile.status === 403, 'a family member cannot change owner settings', profile.status);
  const key = await call('POST', '/api/household/device-token', { jar: member.jar, body: {} });
  check(key.status === 403, 'a family member cannot make an Alexa+ key', key.status);
  const removeOwner = await call('DELETE', '/api/household/members/riya', { jar: member.jar });
  check(removeOwner.status === 403, 'a family member cannot remove people', removeOwner.status);
  if (neighbour.res.status === 200) {
    const care = await call('GET', '/api/care', { jar: neighbour.jar });
    check(care.status === 403, 'a neighbour cannot open medicines and visits', care.status);
    const summary = await call('GET', '/api/family/summary', { jar: neighbour.jar });
    const medsSeen = (await call('GET', '/api/care', { jar: owner.jar })).json?.medications?.map((m) => m.name).filter(Boolean) ?? [];
    check(summary.status === 200 && medsSeen.length > 0 && medsSeen.every((n) => !summary.text.includes(n)), "a neighbour's summary carries no medicine names", summary.text.slice(0, 160));
    const history = await call('GET', '/api/security/history', { jar: neighbour.jar });
    check(denied(history), 'a neighbour cannot read the security history', history.status);
  } else {
    skip('neighbour checks', 'the demo neighbour could not sign in');
  }

  section = 'Another family';
  const eve = new Map();
  const email = `eve-${Date.now()}@attack.test`;
  const eveSignup = await call('POST', '/auth/signup', { jar: eve, body: { email, password: 'Lantern-Orchard-Quiet-73', name: 'Eve' } });
  if (eveSignup.status === 200) {
    const made = await call('POST', '/api/onboarding', { jar: eve, body: { elder: { name: 'Test Elder', preferredName: 'Nani', language: 'en', city: 'Pune', home: 'Pune' }, owner: { name: 'Eve', relationship: 'granddaughter', language: 'en', city: 'Pune', timezone: 'Asia/Kolkata' } } });
    check(made.status === 200, 'a stranger can make their own family', made.status);
    const sneaky = [
      ['GET', '/api/family/summary?household=default'],
      ['GET', '/api/family/summary', { 'x-household': 'default', 'x-saathi-household': 'default' }],
      ['GET', '/api/care?householdId=default'],
      ['GET', '/api/family/messages?household=default'],
      ['GET', '/api/home?household=default'],
    ];
    const leaked = [];
    for (const [method, path, headers] of sneaky) {
      const r = await call(method, path, { jar: eve, headers });
      if (/Aaji|Riya|Amlodipine|Kabir|riya@saathi\.demo/.test(r.text)) leaked.push(path);
    }
    check(leaked.length === 0, "query strings and headers cannot reach another family's data", leaked.join(', '));
    const crossRemove = await call('DELETE', '/api/household/members/anand', { jar: eve });
    const stillThere = (await call('GET', '/api/status', { jar: owner.jar })).json?.circle?.some((p) => p.id === 'anand');
    check(stillThere !== false, "a stranger cannot remove someone from another family", `${crossRemove.status}`);
    const crossAck = await call('POST', '/api/family/alerts/alert-anything/ack', { jar: eve, body: {} });
    check(crossAck.status !== 500 && !leaksInternals(crossAck.text), 'acting on an alert id that is not yours fails cleanly', crossAck.status);
  } else {
    skip('cross-family checks', `sign-up refused (${eveSignup.status} ${eveSignup.json?.error ?? ''})`);
  }

  section = 'Sessions';
  const temp = await login('anand@saathi.demo');
  const before = await call('GET', '/api/status', { jar: temp.jar });
  await call('POST', '/auth/logout', { jar: new Map(temp.jar), body: {} });
  const after = await call('GET', '/api/status', { jar: temp.jar });
  check(before.status === 200 && after.status === 401, 'a session cookie stops working after sign-out', `${before.status} then ${after.status}`);
  const forged = await call('GET', '/api/status', { jar: new Map([['__Host-saathi_session', 'forged-session-value']]) });
  check(forged.status === 401, 'a made-up session cookie is refused', forged.status);

  section = 'Files and paths';
  const paths = ['/media/..%2f..%2fsaathi.json', '/media/%2e%2e/%2e%2e/saathi.json', '/vendor/fonts/..%2f..%2f..%2fpackage.json', '/%2e%2e/package.json', '/..%5c..%5cpackage.json', '/vendor/three/..%2f..%2f.env', '/public/../src/config.js'];
  const exposed = [];
  for (const p of paths) {
    const r = await call('GET', p);
    if (r.status === 200 && /"dependencies"|SAATHI_|export const config|"households"/.test(r.text)) exposed.push(p);
  }
  check(exposed.length === 0, 'path traversal does not reach files outside the web folders', exposed.join(', '));
  const unsigned = await call('GET', '/media/default/voice-anything.webm');
  check(unsigned.status === 403 || unsigned.status === 404, 'media without a signature is refused', unsigned.status);
  const trace = await call('TRACE', '/');
  check(trace.status !== 200, 'TRACE is not answered', trace.status);

  section = 'Input';
  const big = await call('POST', '/api/family/message', { jar: owner.jar, raw: Buffer.from(JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) })) });
  check(big.status === 413, 'a body over 1 MB is refused', big.status);
  await call('POST', '/api/family/message', { jar: owner.jar, raw: Buffer.from('{"text":"hello","__proto__":{"role":"owner","isAdmin":true},"constructor":{"prototype":{"isAdmin":true}}}') });
  const memberStatus = await call('GET', '/api/status', { jar: member.jar });
  const stillMember = await call('PUT', '/api/household/profile', { jar: member.jar, body: {} });
  check(memberStatus.status === 200 && stillMember.status === 403, 'prototype pollution in JSON gives nobody new powers', stillMember.status);
  const reflected = await call('GET', `/api/invite/${encodeURIComponent('<script>alert(1)</script>')}`);
  check(!/text\/html/.test(reflected.headers['content-type'] ?? '') || !reflected.text.includes('<script>alert(1)'), 'a script in the URL is not reflected as HTML', reflected.headers['content-type']);

  section = 'Doorbell webhook';
  const event = JSON.stringify({ kind: 'ding', deviceId: 'front-door', at: new Date().toISOString() });
  const ts = String(Math.floor(Date.now() / 1000));
  const noSig = await call('POST', '/ring/events', { raw: Buffer.from(event) });
  check(noSig.status === 401 || noSig.status === 403, 'an unsigned doorbell event is refused', noSig.status);
  const wrongSig = await call('POST', '/ring/events', { raw: Buffer.from(event), headers: { 'x-saathi-timestamp': ts, 'x-saathi-signature': createHmac('sha256', 'guessed-secret').update(`${ts}.${event}`).digest('hex') } });
  check(wrongSig.status === 401 || wrongSig.status === 403, 'a doorbell event signed with a guessed secret is refused', wrongSig.status);

  section = 'Device pairing';
  const guesses = [];
  for (let i = 0; i < 14; i++) guesses.push((await call('POST', '/auth/device', { body: { code: String(100000 + Math.floor(Math.random() * 900000)), label: 'attack' } })).status);
  check(!guesses.includes(200) || guesses.filter((s) => s === 200).length < 2, 'random pairing codes do not create devices', guesses.join(','));
  check(guesses.includes(429), 'pairing-code guessing is rate limited', guesses.join(','));

  section = 'Brute force';
  if (eveSignup.status === 200) {
    for (let i = 0; i < 6; i++) await call('POST', '/auth/login', { body: { email, password: `Not-the-password-${i}` } });
    const right = await call('POST', '/auth/login', { body: { email, password: 'Lantern-Orchard-Quiet-73' } });
    check(right.status !== 200, 'after repeated wrong passwords even the right one waits (lockout)', right.status);
  } else {
    skip('lockout', 'no test account');
  }
  const burst = [];
  for (let i = 0; i < 40; i++) burst.push((await call('POST', '/auth/login', { body: { email: 'anand@saathi.demo', password: `burst-${i}` } })).status);
  check(burst.includes(429), 'a burst of sign-in attempts is rate limited', burst.slice(-5).join(','));
}

let crashed = null;
try {
  await run();
} catch (err) {
  crashed = err;
  check(false, 'the attack suite ran to the end', err.message);
} finally {
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${results.some((r) => r.skipped) ? `, ${results.filter((r) => r.skipped).length} skipped` : ''}.`);
if (reportFile) {
  const lines = ['# Saathi attack suite report', '', `Target: ${target ?? 'a fresh local demo install in public mode'}`, `Run at: ${new Date().toISOString()}`, '', '| Area | Attack | Result |', '|---|---|---|',
    ...results.map((r) => `| ${r.section} | ${r.name} | ${r.skipped ? `skipped: ${r.skipped}` : r.ok ? 'stopped' : `**got through**: ${r.detail.replaceAll('|', '/')}`} |`), ''];
  writeFileSync(reportFile, lines.join('\n'));
}
if (failed.length) {
  if (server && crashed) console.log(serverLog.slice(-1500));
  process.exitCode = 1;
}
