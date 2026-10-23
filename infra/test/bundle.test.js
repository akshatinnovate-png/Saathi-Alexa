import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bundleServer, LAMBDA_ENTRIES } from '../lib/saathi-stack.js';

const out = mkdtempSync(join(tmpdir(), 'saathi-bundle-'));
bundleServer(out);

function invoke(script, env = {}) {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: out,
    env: { PATH: process.env.PATH, SAATHI_METRICS: 'off', SAATHI_DATA_FILE: join(out, 'data.json'), ...env },
  });
  return JSON.parse(stdout.toString().trim().split('\n').at(-1));
}

const apiEvent = (method, path, body, headers = {}) => JSON.stringify({
  rawPath: path, rawQueryString: '', isBase64Encoded: false,
  headers: { host: 'abc123.execute-api.us-east-1.amazonaws.com', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  requestContext: { http: { method } },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('every Lambda entry point is a self-contained ESM bundle', () => {
  for (const name of Object.keys(LAMBDA_ENTRIES)) assert.ok(existsSync(join(out, `${name}.mjs`)), name);
});

test('the MCP Lambda bundle answers initialize, tools/list and a Marathi tools/call as API Gateway would send them', () => {
  const result = invoke(`
    const { handler } = await import('./mcp.mjs');
    const init = await handler(${apiEvent('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'apigw', version: '1' } } })});
    const list = await handler(${apiEvent('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { 'mcp-protocol-version': '2025-11-25' })});
    const call = await handler(${apiEvent('POST', '/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'what_day_is_it', arguments: { language: 'mr' } } }, { 'mcp-protocol-version': '2025-11-25' })});
    const meta = await handler(${apiEvent('GET', '/.well-known/oauth-protected-resource/mcp')});
    console.log(JSON.stringify({
      init: init.statusCode, version: JSON.parse(init.body).result.protocolVersion,
      tools: JSON.parse(list.body).result.tools.length,
      say: JSON.parse(call.body).result.content[0].text,
      meta: meta.statusCode,
    }));
  `, { SAATHI_AUTH_MODE: 'none' });
  assert.equal(result.init, 200);
  assert.equal(result.version, '2025-11-25');
  assert.equal(result.tools, 16);
  assert.match(result.say, /आज/);
  assert.equal(result.meta, 200);
});

test('the MCP Lambda bundle enforces bearer auth', () => {
  const result = invoke(`
    const { handler } = await import('./mcp.mjs');
    const denied = await handler(${apiEvent('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })});
    const allowed = await handler(${apiEvent('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { authorization: 'Bearer t0k3n', 'mcp-protocol-version': '2025-11-25' })});
    console.log(JSON.stringify({ denied: denied.statusCode, challenge: denied.headers['www-authenticate'], allowed: allowed.statusCode }));
  `, { SAATHI_AUTH_MODE: 'static', SAATHI_MCP_TOKEN: 't0k3n' });
  assert.equal(result.denied, 401);
  assert.match(result.challenge, /resource_metadata=/);
  assert.equal(result.allowed, 200);
});

test('the Ring, sweep and weekly-letter Lambda bundles run', () => {
  const result = invoke(`
    const { createHmac } = await import('node:crypto');
    const { handler: ring } = await import('./ring.mjs');
    const { handler: sweep } = await import('./sweep.mjs');
    const body = JSON.stringify({ kind: 'motion', doorbot_id: 'front-door' });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = 'sha256=' + createHmac('sha256', 's3cret').update(ts + '.' + body).digest('hex');
    const ok = await ring({ headers: { 'x-saathi-ring-signature': sig, 'x-saathi-ring-timestamp': ts }, body });
    const bad = await ring({ headers: { 'x-saathi-ring-signature': 'sha256=00', 'x-saathi-ring-timestamp': ts }, body });
    const swept = await sweep();
    const { handler: digest } = await import('./digest.mjs');
    const letters = await digest();
    console.log(JSON.stringify({ ok: ok.statusCode, bad: bad.statusCode, swept: Array.isArray(swept.raised) && Array.isArray(swept.refills), letters: letters.sent.map((l) => l.memberId).sort() }));
  `, { SAATHI_RING_WEBHOOK_SECRET: 's3cret' });
  assert.deepEqual(result, { ok: 200, bad: 401, swept: true, letters: ['anand', 'riya'] });
});
