import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = process.env.SAATHI_URL ?? process.argv[2];
if (!endpoint) {
  console.error('Usage: SAATHI_URL=https://<api>/mcp [SAATHI_TOKEN=... | SAATHI_OAUTH_DOMAIN=... SAATHI_CLIENT_ID=... SAATHI_CLIENT_SECRET=...] npm run smoke');
  process.exit(2);
}

const results = [];
const check = async (name, fn) => {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail, ms: Date.now() - started });
  } catch (err) {
    results.push({ ok: false, name, detail: err.message, ms: Date.now() - started });
  }
};

async function accessToken() {
  if (process.env.SAATHI_TOKEN) return process.env.SAATHI_TOKEN;
  const { SAATHI_OAUTH_DOMAIN: domain, SAATHI_CLIENT_ID: id, SAATHI_CLIENT_SECRET: secret } = process.env;
  if (!domain || !id || !secret) return null;
  const res = await fetch(`${domain.replace(/\/$/, '')}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: process.env.SAATHI_SCOPE ?? 'saathi/elder' }),
  });
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

const url = new URL(endpoint);
let token;
let client;

await check('OAuth token', async () => {
  token = await accessToken();
  return token ? 'obtained' : 'none configured (endpoint must allow anonymous access)';
});

await check('Protected resource metadata (RFC 9728)', async () => {
  const res = await fetch(new URL(`/.well-known/oauth-protected-resource${url.pathname}`, url));
  if (res.status === 404) return 'not served (expected only with Cognito auth)';
  if (!res.ok) throw new Error(`status ${res.status}`);
  const meta = await res.json();
  return `authorization servers: ${meta.authorization_servers?.join(', ') || 'none'}; scopes: ${meta.scopes_supported?.join(', ')}`;
});

if (token) {
  await check('Rejects requests without a token', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } }),
    });
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return `401, WWW-Authenticate: ${res.headers.get('www-authenticate') ?? '(missing)'}`;
  });
}

await check('Initialize over Streamable HTTP', async () => {
  client = new Client({ name: 'saathi-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined });
  await client.connect(transport);
  const info = client.getServerVersion();
  return `${info.name} ${info.version}, protocol ${transport.protocolVersion ?? 'negotiated'}`;
});

if (client) {
  await check('tools/list', async () => {
    const { tools } = await client.listTools();
    if (tools.length < 12) throw new Error(`only ${tools.length} tools`);
    return `${tools.length} tools, ${tools.filter((t) => t.outputSchema).length} with outputSchema`;
  });
  await check('what_day_is_it (Marathi)', async () => {
    const r = await client.callTool({ name: 'what_day_is_it', arguments: { language: 'mr' } });
    if (r.isError) throw new Error(r.content[0].text);
    return r.content[0].text;
  });
  await check('get_medication_schedule', async () => {
    const r = await client.callTool({ name: 'get_medication_schedule', arguments: { language: 'en' } });
    if (r.isError) throw new Error(r.content[0].text);
    return r.structuredContent.medications.map((m) => `${m.name}: ${m.status}`).join(', ');
  });
  await check('resources/read saathi://elder/profile', async () => {
    const r = await client.readResource({ uri: 'saathi://elder/profile' });
    return `preferred name: ${JSON.parse(r.contents[0].text).preferredName}`;
  });
  await check('Scope enforcement on family tools', async () => {
    const r = await client.callTool({ name: 'family_summary', arguments: { member: 'riya' } });
    return r.isError ? `blocked: ${r.content[0].text}` : 'allowed (token carries saathi/family)';
  });
  await client.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} (${r.ms} ms)\n      ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${url.href}`);
process.exit(failed ? 1 : 0);
