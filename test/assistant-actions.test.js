import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../src/http/app.js';
import { createAccounts, DEMO_PASSWORD } from '../src/accounts/accounts.js';
import { createSessions } from '../src/accounts/sessions.js';
import { createHouseholdVerifier } from '../src/auth/verifier.js';
import { createFamilyAssistant } from '../src/agent/familyAssistant.js';
import { createSahayQueue, onThisComputer } from '../src/agent/sahayQueue.js';
import { isTechHelp, languageOf, askedSahay, instructionFor } from '../src/agent/techHelp.js';
import { createGroqClient, createLlm } from '../src/agent/llm.js';
import { testServices, testConfig } from './helpers.js';

let server;
let base;
let services;
let assistant;
let modelAssistant;
let queue;
let script = [];
let cookie = '';
let which = 'offline';
const use = (w) => { which = w; };

const fakeLlm = { provider: 'test-model', async create() { return script.shift() ?? { content: [{ type: 'text', text: 'Done looking.' }], stop_reason: 'end_turn' }; } };
const toolUse = (name, input) => ({ content: [{ type: 'tool_use', id: `t-${name}`, name, input }], stop_reason: 'tool_use' });
const said = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

before(async () => {
  services = testServices();
  queue = createSahayQueue();
  const accounts = createAccounts({ store: services.store, services, demo: true });
  await accounts.ensureDemo();
  const app = createApp({
    config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }), services, sahayQueue: queue,
    accounts, sessions: createSessions('test-secret'), optionalVerifier: createHouseholdVerifier({ base: null, accounts }),
    assistantFor: async () => (which === 'model' ? modelAssistant : assistant),
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'riya@saathi.demo', password: DEMO_PASSWORD }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
  assistant = createFamilyAssistant({ mcpUrl: `${base}/mcp`, llm: null, householdId: 'default', sahay: { queue } });
  modelAssistant = createFamilyAssistant({ mcpUrl: `${base}/mcp`, llm: fakeLlm, householdId: 'default', sahay: { queue } });
});

after(async () => {
  await assistant.close();
  await modelAssistant.close();
  server.close();
});

const post = async (path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const get = async (path, headers = {}) => {
  const res = await fetch(`${base}${path}`, { headers: { cookie, ...headers } });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const ask = (message, headers) => post('/api/assistant', { message }, headers);
const confirm = (id) => post('/api/assistant/confirm', { id });

test('tech help is recognised in English, Hinglish, Hindi and Marathi, and not for care questions', () => {
  for (const m of ['Mei kaise whatsapp me message karungi?', 'group kaise banaunga whatsapp pe', 'How do I make a video call?', 'मैं व्हाट्सएप पर मैसेज कैसे करूँ?', 'व्हॉट्सअ‍ॅप वर ग्रुप कसा बनवायचा?']) assert.ok(isTechHelp(m), m);
  for (const m of ['Does she need a refill?', 'How was Aaji this week?', 'Someone asked for my OTP, how do I send it?', 'x'.repeat(500)]) assert.ok(!isTechHelp(m), m);
  assert.equal(languageOf('Mei kaise whatsapp me message karungi'), 'hi-Latn');
  assert.equal(languageOf('मैं मैसेज कैसे करूँ'), 'hi');
  assert.equal(languageOf('मला ग्रुप कसा बनवायचा आहे'), 'mr');
  assert.equal(languageOf('how do I print', 'en'), 'en');
  assert.equal(askedSahay('en'), "I've asked Sahay to do it for you.");
  assert.match(askedSahay('hi-Latn', { running: false }), /Sahay kholiye/);
  assert.match(askedSahay('hi-IN'), /सहाय/);
  assert.match(askedSahay('zz'), /asked Sahay/);
  assert.match(instructionFor('  print this '), /"print this"/);
});

test('the Sahay queue hands out tasks in order, tracks status and knows when Sahay is running', () => {
  let now = 1_000_000;
  const q = createSahayQueue({ clock: () => now });
  assert.equal(q.alive(), false);
  assert.throws(() => q.enqueue({ householdId: 'h', instruction: '  ' }), /Tell Sahay/);
  const a = q.enqueue({ householdId: 'h', instruction: 'first' });
  now += 1;
  q.enqueue({ householdId: 'h', instruction: 'second', original: 'o' });
  q.enqueue({ householdId: 'other', instruction: 'third' });
  assert.equal(q.next().instruction, 'first');
  assert.equal(q.alive(), true);
  assert.equal(q.next().instruction, 'second');
  assert.equal(q.update(a.id, { status: 'done', note: 'sent the message' }).note, 'sent the message');
  assert.throws(() => q.update(a.id, { status: 'weird' }), /status/);
  assert.equal(q.update('nope', { status: 'done' }), null);
  assert.deepEqual(q.list('h').map((t) => t.instruction), ['second', 'first']);
  now += 25 * 3600 * 1000;
  assert.equal(q.list('h').length, 0);
  assert.equal(q.alive(), false);
  assert.equal(q.next(), null);
});

test('only a direct connection from this computer counts as being at the Sahay PC', () => {
  const req = (address, headers = {}) => ({ socket: { remoteAddress: address }, headers });
  assert.ok(onThisComputer(req('127.0.0.1')));
  assert.ok(onThisComputer(req('::ffff:127.0.0.1')));
  assert.ok(onThisComputer(req('::1')));
  assert.ok(!onThisComputer(req('192.168.1.5')));
  assert.ok(!onThisComputer(req('127.0.0.1', { 'x-forwarded-for': '8.8.8.8' })));
  assert.ok(!onThisComputer(req('127.0.0.1', { 'cf-connecting-ip': '8.8.8.8' })));
  assert.ok(!onThisComputer(req('127.0.0.1'), { exposed: true }));
  assert.ok(!onThisComputer({}));
});

test('asked on the Sahay PC, a tech question goes straight to Sahay with one short message', async () => {
  use('offline');
  const { body } = await ask('Mei kaise whatsapp me message karungi?');
  assert.equal(body.brain, 'sahay');
  assert.match(body.reply, /Sahay se keh diya/);
  assert.equal(body.sahayTask.status, 'queued');

  assert.equal((await get('/sahay/next')).status, 403);
  assert.equal((await get('/sahay/next', { 'x-sahay': '1', origin: 'https://evil.example' })).status, 403);
  const next = await get('/sahay/next', { 'x-sahay': '1' });
  assert.equal(next.body.id, body.sahayTask.id);
  assert.match(next.body.instruction, /whatsapp/i);
  assert.equal((await get('/sahay/next', { 'x-sahay': '1' })).status, 204);
  assert.equal((await post(`/sahay/tasks/${next.body.id}`, { status: 'working' }, { 'x-sahay': '1' })).body.status, 'working');
  assert.equal((await post(`/sahay/tasks/${next.body.id}`, { status: 'nope' }, { 'x-sahay': '1' })).status, 400);
  assert.equal((await post('/sahay/tasks/missing', { status: 'done' }, { 'x-sahay': '1' })).status, 404);
  await post(`/sahay/tasks/${next.body.id}`, { status: 'done', note: 'Opened WhatsApp and showed how to send a message' }, { 'x-sahay': '1' });
  const list = await get('/api/sahay/tasks');
  assert.equal(list.body.running, true);
  assert.equal(list.body.tasks[0].status, 'done');
});

test('from another computer, Sahay needs a confirmation first', async () => {
  use('offline');
  const { body } = await ask('How do I make a WhatsApp group?', { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(body.sahayTask, null);
  assert.equal(body.proposals[0].action, 'ask_sahay');
  const done = await confirm(body.proposals[0].id);
  assert.equal(done.body.done, true);
  assert.match(done.body.sahayTask.instruction, /WhatsApp group/);
  assert.equal((await confirm(body.proposals[0].id)).status, 404);
});

test('the elder can ask on their own screen, and Sahay is told', async () => {
  const { body } = await post('/api/alexa/turn', { text: 'मैं व्हाट्सएप पर वीडियो कॉल कैसे करूँ?', language: 'hi', sessionId: 'assistant-1' });
  assert.match(body.reply, /सहाय/);
  assert.equal(body.sahayTask.language, 'hi');
});

test('offline, plain requests become confirmation cards that do the work when confirmed', async () => {
  use('offline');
  const msg = await ask("Send her a message that I'll call at 7 tonight");
  assert.equal(msg.body.proposals[0].action, 'send_message_to_elder');
  assert.match(msg.body.proposals[0].summary, /call at 7/);
  assert.equal((await confirm(msg.body.proposals[0].id)).body.done, true);

  const refill = await ask('I refilled her calcium');
  assert.equal(refill.body.proposals[0].action, 'record_refill');
  assert.equal((await confirm(refill.body.proposals[0].id)).body.done, true);

  const ack = await ask("I'm on it");
  assert.equal(ack.body.proposals[0].action, 'acknowledge_alert');
  const plain = await ask('How is she today?');
  assert.equal(plain.body.proposals.length, 0);
  assert.ok(plain.body.reply.length > 0);
  assert.equal((await post('/api/assistant/dismiss', { id: ack.body.proposals[0].id })).body.dismissed, true);
  assert.equal((await confirm('not-a-card')).status, 404);
});

test('with a model, the assistant proposes several changes and each one runs only after a tap', async () => {
  use('model');
  script = [
    { content: [{ type: 'tool_use', id: 'a1', name: 'add_medicine', input: { name: 'Metformin 500 mg', purpose: 'sugar', times: ['20:00', '08:00'], withFood: true } }, { type: 'tool_use', id: 'a2', name: 'add_doctor_visit', input: { with: 'Dr. Rao', at: '2026-11-20T10:30', place: 'Ruby Hall' } }], stop_reason: 'tool_use' },
    said('Both are ready for you to confirm.'),
  ];
  const first = await ask('Her doctor added Metformin twice a day with food, and wants a check-up with Dr. Rao on the 20th at 10:30');
  assert.equal(first.body.reply, 'Both are ready for you to confirm.');
  assert.deepEqual(first.body.proposals.map((p) => p.action), ['add_medicine', 'add_doctor_visit']);
  assert.match(first.body.proposals[0].summary, /08:00|20:00/);
  const med = await confirm(first.body.proposals[0].id);
  assert.deepEqual(med.body.medication.times, ['08:00', '20:00']);
  assert.equal((await confirm(first.body.proposals[1].id)).body.appointment.with, 'Dr. Rao');

  const step = async (name, input) => {
    script = [toolUse(name, input), said('Ready.')];
    const { body } = await ask(`please ${name}`);
    return confirm(body.proposals[0].id);
  };
  assert.deepEqual((await step('change_medicine', { medicine: 'metformin', times: ['09:00'] })).body.medication.times, ['09:00']);
  assert.equal((await step('change_medicine', { medicine: 'nothing like this' })).status, 404);
  assert.equal((await step('record_refill', { medicine: 'blood pressure', quantity: 60 })).body.done, true);
  assert.equal((await step('escort_doctor_visit', { visit: 'Joshi' })).body.done, true);
  assert.equal((await step('escort_doctor_visit', { visit: 'Dr. Nobody' })).status, 404);
  assert.equal((await step('stop_medicine', { medicine: 'Metformin' })).body.done, true);
  assert.equal((await step('send_message_to_elder', { text: 'Love you' })).body.done, true);
  assert.equal((await step('ask_sahay', { instruction: 'Open YouTube' })).body.sahayTask.original, 'Open YouTube');
  await post('/api/family/message', { text: 'x' });
  const alertId = 'test-alert';
  await services.store.put('alerts', { id: alertId, type: 'help', severity: 'high', createdAt: '2026-10-23T05:00:00.000Z', summary: 'Needs help', acknowledged: false });
  assert.equal((await step('acknowledge_alert', { alert: alertId })).body.done, true);
  assert.equal((await step('acknowledge_alert', { alert: 'about nothing at all' })).status, 404);

  script = [toolUse('get_medication_schedule', { language: 'en' }), said('She has two tablets today.')];
  const looked = await ask('What tablets today?');
  assert.equal(looked.body.trace[0].tool, 'get_medication_schedule');
  script = [{ content: [], stop_reason: 'refusal' }];
  assert.match((await ask('something odd')).body.reply, /can't help/);
  script = Array.from({ length: 7 }, () => ({ content: [], stop_reason: 'pause_turn' }));
  assert.match((await ask('take your time')).body.reply, /moment longer/);
  script = [];
});

test('when the model fails, the assistant falls back to offline answers', async () => {
  const failing = createFamilyAssistant({
    mcpUrl: `${base}/mcp`, householdId: 'default',
    llm: { provider: 'broken', create: async () => { throw Anthropic.APIError.generate(500, {}, 'down', new Headers()); } },
  });
  const out = await failing.ask({ message: 'How is she?', memberId: 'riya' });
  assert.equal(out.brain, 'offline (fallback)');
  const other = await failing.ask({ message: 'Send her a message that hi', memberId: 'riya' });
  await assert.rejects(failing.confirm({ id: other.proposals[0].id, memberId: 'someone-else', saathi: services.forHousehold() }), /Only the person who asked/);
  const sahayless = await failing.ask({ message: 'How do I print a PDF?', memberId: 'riya', onSahayPc: false });
  assert.equal(sahayless.proposals[0].action, 'ask_sahay');
  await assert.rejects(failing.confirm({ id: sahayless.proposals[0].id, memberId: 'riya', saathi: services.forHousehold() }), /not connected/);
  await failing.close();
  const crashing = createFamilyAssistant({ mcpUrl: `${base}/mcp`, llm: { provider: 'x', create: async () => { throw new TypeError('bug'); } } });
  await assert.rejects(crashing.ask({ message: 'hello', memberId: 'riya' }), /bug/);
  await crashing.close();
});

test('the Groq client speaks the OpenAI format and maps errors to the SDK error types', async () => {
  const sent = [];
  let reply = { ok: true, status: 200, body: { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'where_is', arguments: '{"item":"glasses"}' } }, { id: 'c2', function: { name: 'family_summary', arguments: 'not json' } }] } }] } };
  const fetchImpl = async (url, init) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return { ok: reply.ok, status: reply.status, headers: new Headers(), json: async () => reply.body }; };
  const create = createGroqClient({ apiKey: 'k', model: 'openai/gpt-oss-120b', fetchImpl });
  const out = await create({
    system: 'sys',
    tools: [{ name: 'where_is', description: 'find', input_schema: { type: 'object', properties: { item: { type: 'string' } } } }, { name: 'bare', description: 'no schema' }],
    messages: [
      { role: 'user', content: 'Where are her glasses?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Looking' }, { type: 'tool_use', id: 'c0', name: 'where_is', input: { item: 'glasses' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c0', content: 'On the table' }, { type: 'tool_result', tool_use_id: 'c9', content: [{ type: 'text', text: 'x' }] }, { type: 'text', text: 'and?' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c8', name: 'bare' }] },
    ],
  });
  assert.equal(sent[0].auth, 'Bearer k');
  assert.equal(sent[0].body.model, 'openai/gpt-oss-120b');
  assert.deepEqual(sent[0].body.messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'user', 'assistant']);
  assert.equal(sent[0].body.messages[2].tool_calls[0].function.arguments, '{"item":"glasses"}');
  assert.equal(sent[0].body.tools[1].function.parameters.type, 'object');
  assert.equal(out.stop_reason, 'tool_use');
  assert.deepEqual(out.content.map((b) => b.input ?? null), [{ item: 'glasses' }, {}]);

  reply = { ok: true, status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: 'They are on the table.' } }] } };
  assert.deepEqual(await create({ messages: [{ role: 'user', content: 'hi' }] }), { content: [{ type: 'text', text: 'They are on the table.' }], stop_reason: 'end_turn' });
  assert.equal(sent.at(-1).body.tools, undefined);
  reply = { ok: true, status: 200, body: { choices: [{ finish_reason: 'content_filter', message: {} }] } };
  assert.equal((await create({ messages: [] })).stop_reason, 'refusal');
  reply = { ok: true, status: 200, body: {} };
  assert.equal((await create({ messages: [] })).stop_reason, 'end_turn');
  reply = { ok: false, status: 429, body: { error: { message: 'slow down' } } };
  await assert.rejects(create({ messages: [] }), (e) => e instanceof Anthropic.RateLimitError);
  reply = { ok: false, status: 500, body: {} };
  await assert.rejects(create({ messages: [] }), (e) => e instanceof Anthropic.InternalServerError && e.status === 500);
  const offline = createGroqClient({ apiKey: 'k', model: 'm', fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  await assert.rejects(offline({ messages: [] }), (e) => e instanceof Anthropic.APIConnectionError);

  const llm = createLlm({ provider: 'groq', groqKey: 'k', groqModel: 'openai/gpt-oss-120b', fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'नमस्ते' } }] }) }) });
  assert.deepEqual([llm.provider, llm.model], ['groq', 'openai/gpt-oss-120b']);
  assert.equal(await llm.translate('hello', { from: 'en', to: 'hi' }), 'नमस्ते');
  assert.equal(createLlm({ provider: 'offline' }), null);
});
