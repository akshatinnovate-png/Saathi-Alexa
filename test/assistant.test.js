import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { createFamilyAssistant } from '../src/agent/familyAssistant.js';
import { testServices, testConfig } from './helpers.js';

let server;
let base;
let assistant;

before(async () => {
  const services = testServices();
  const app = createApp({ config: testConfig({ host: '127.0.0.1', web: { requireLogin: false } }), services, assistantFor: async () => assistant });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  assistant = createFamilyAssistant({ mcpUrl: `${base}/mcp`, llm: null });
});

after(async () => {
  await assistant.close();
  server.close();
});

test('the family assistant answers questions and offers suggestions with the elder\'s name', async () => {
  for (const message of ['How was she this week?', 'Does she need a refill?', 'Where are her glasses?']) {
    const res = await fetch(`${base}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
    assert.equal(res.status, 200, message);
    const out = await res.json();
    assert.ok(out.reply.length > 0, message);
    assert.equal(out.suggestions.length, 4);
    assert.ok(out.suggestions.every((s) => s.includes('Aaji')), JSON.stringify(out.suggestions));
  }
  assert.equal(assistant.suggestions.length, 4);
});
