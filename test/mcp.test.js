import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/http/app.js';
import { createAlexaSimulator } from '../src/agent/alexaSimulator.js';
import { handler, _reset } from '../src/lambda/mcp.js';
import { createStaticVerifier } from '../src/auth/verifier.js';
import { createRingSimulator } from '../src/ring/webhook.js';
import { testServices, testConfig } from './helpers.js';

let server;
let base;
let services;
let simulator;
let ringSimulator;
const TOKEN = 'test-token-123';
const FAMILY_TOKEN = 'family-token-456';
const verifier = createStaticVerifier({ elderToken: TOKEN, familyToken: FAMILY_TOKEN });
const RING_SECRET = 'ring-secret';

before(async () => {
  services = testServices();
  const config = testConfig({ host: '127.0.0.1', ring: { webhookSecret: RING_SECRET } });
  const proxy = { turn: (...a) => simulator.turn(...a), answer: (...a) => simulator.answer(...a), reset: (...a) => simulator.reset(...a) };
  const ringProxy = { trigger: (...a) => ringSimulator.trigger(...a) };
  const app = createApp({ config, services, simulator: proxy, verifier, ringSimulator: ringProxy });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  simulator = createAlexaSimulator({
    mcpUrl: `${base}/mcp`, headers: { Authorization: `Bearer ${TOKEN}` }, llm: null, translator: services.translator,
    publish: (type, detail) => services.localBus.publish(type, detail),
  });
  ringSimulator = createRingSimulator({ url: `${base}/ring/events`, secret: RING_SECRET });
});

after(async () => {
  await simulator.close();
  server.close();
});

const initialize = (version = '2025-11-25') => ({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
});

test('rejects requests without the bearer token', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(initialize()),
  });
  assert.equal(res.status, 401);
});

test('negotiates MCP protocol 2025-11-25 over Streamable HTTP and issues a session id', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(initialize()),
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('mcp-session-id'));
  const body = await res.text();
  const payload = JSON.parse(body.split('\n').find((l) => l.startsWith('data: ')).slice(6));
  assert.equal(payload.result.protocolVersion, '2025-11-25');
  assert.equal(payload.result.serverInfo.name, 'saathi');
  assert.match(payload.result.instructions, /short, warm sentences/);
});

test('an MCP client can list and call every kind of capability', async () => {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'acknowledge_alert', 'ask_family_for_help', 'confirm_medication_taken', 'daily_check_in', 'family_summary',
    'get_family_messages', 'get_medication_schedule', 'list_memory_stories', 'save_memory_story', 'send_message_to_family',
    'what_day_is_it', 'who_is',
  ]);
  assert.equal(tools.find((t) => t.name === 'what_day_is_it').annotations.readOnlyHint, true);

  const who = await client.callTool({ name: 'who_is', arguments: { person: 'Meera' } });
  assert.match(who.content[0].text, /next door/);
  assert.equal(who.structuredContent.person.relationship, 'neighbour');

  const bad = await client.callTool({ name: 'who_is', arguments: {} });
  assert.equal(bad.isError, true);

  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((r) => r.uri).sort(), ['saathi://circle', 'saathi://elder/profile', 'saathi://today']);
  const profile = JSON.parse((await client.readResource({ uri: 'saathi://elder/profile' })).contents[0].text);
  assert.equal(profile.preferredName, 'Aaji');

  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), ['gentle_morning_check_in', 'memory_lane']);
  await client.close();
});

test('Alexa+ simulator (offline planner) routes speech to MCP tools', async () => {
  const day = await simulator.turn({ text: 'What day is it today?', language: 'en' });
  assert.equal(day.trace[0].tool, 'what_day_is_it');
  assert.match(day.reply, /Friday/);

  const pill = await simulator.turn({ text: 'I took my tablet', language: 'en' });
  assert.equal(pill.trace[0].tool, 'confirm_medication_taken');

  const help = await simulator.turn({ text: 'मी पडले, मदत करा', language: 'mr' });
  assert.equal(help.trace[0].tool, 'ask_family_for_help');
  await services.escalation.wait(help.trace[0].result.alertId);
});

test('family dashboard API: summary, message to Aaji and acknowledging an alert', async () => {
  const summary = await (await fetch(`${base}/api/family/summary?member=riya`)).json();
  assert.match(summary.english, /tablets taken/);
  const msg = await fetch(`${base}/api/family/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'riya', text: 'Love you Aaji' }) });
  assert.equal(msg.status, 200);
  const missing = await fetch(`${base}/api/family/alerts/nope/ack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(missing.status, 404);
});

test('Lambda handler serves stateless Streamable HTTP for API Gateway', async () => {
  _reset();
  const overrides = { store: services.store, metrics: { emit() {} }, verifier };
  const event = (body) => ({
    rawPath: '/mcp', rawQueryString: '',
    headers: { host: 'abc.execute-api.us-east-1.amazonaws.com', 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}`, 'mcp-protocol-version': '2025-11-25' },
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify(body), isBase64Encoded: false,
  });
  const init = await handler(event(initialize()), {}, overrides);
  assert.equal(init.statusCode, 200);
  assert.equal(JSON.parse(init.body).result.protocolVersion, '2025-11-25');

  const call = await handler(event({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_medication_schedule', arguments: {} } }), {}, overrides);
  assert.equal(call.statusCode, 200);
  assert.ok(JSON.parse(call.body).result.structuredContent.medications.length === 3);

  const denied = await handler({ ...event(initialize()), headers: { host: 'x' } }, {}, overrides);
  assert.equal(denied.statusCode, 401);
  assert.match(denied.headers['www-authenticate'], /resource_metadata=/);

  const meta = await handler({ rawPath: '/.well-known/oauth-protected-resource/mcp', headers: { host: 'abc.example' }, requestContext: { http: { method: 'GET' } } }, {}, overrides);
  assert.deepEqual(JSON.parse(meta.body).scopes_supported, ['saathi/elder', 'saathi/family']);
  _reset();
});
