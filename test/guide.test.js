import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { createGuide, FACTS } from '../src/agent/guide.js';
import { createApp } from '../src/http/app.js';
import { testServices, testConfig } from './helpers.js';

test('the guide answers from Saathi\'s own facts and links to the source', async () => {
  const guide = createGuide();
  const privacy = await guide.ask({ message: 'Is my data private?' });
  assert.equal(privacy.brain, 'guide');
  assert.match(privacy.reply, /end-to-end encrypted/);
  assert.match(privacy.links[0], /PRIVACY\.md/);
  assert.match((await guide.ask({ message: 'Kitna paisa lagega? Is it free?' })).reply, /free and open source/);
  const unknown = await guide.ask({ message: 'What is the capital of Peru?' });
  assert.match(unknown.reply, /not sure/);
  assert.match(unknown.links[0], /#readme/);
  await assert.rejects(guide.ask({ message: '   ' }), /Ask me something/);
  assert.ok(FACTS.every((f) => f.link.startsWith('https://')));
});

test('in demo mode, questions about the elder are answered by the demo family', async () => {
  const guide = createGuide({ demoAsk: async (q) => `demo: ${q}` });
  assert.deepEqual(await guide.ask({ message: 'How was Aaji this week?' }), { reply: 'demo: How was Aaji this week?', links: [], brain: 'demo-family' });
  assert.equal((await guide.ask({ message: 'Is her data private?' })).brain, 'guide');
});

test('with a model, the guide is grounded in the facts and falls back when the model is down', async () => {
  let seen;
  const guide = createGuide({ llm: { provider: 'groq', create: async (params) => { seen = params; return { content: [{ type: 'text', text: 'Saathi is free.' }], stop_reason: 'end_turn' }; } } });
  const out = await guide.ask({ message: 'Is it free?' });
  assert.equal(out.reply, 'Saathi is free.');
  assert.match(seen.system, /ONLY these facts/);
  const down = createGuide({ llm: { provider: 'groq', create: async () => { throw Anthropic.APIError.generate(503, {}, 'down', new Headers()); } } });
  assert.equal((await down.ask({ message: 'Is it free?' })).brain, 'guide');
  const empty = createGuide({ llm: { provider: 'groq', create: async () => ({ content: [], stop_reason: 'end_turn' }) } });
  assert.equal((await empty.ask({ message: 'Is it free?' })).brain, 'guide');
  const broken = createGuide({ llm: { provider: 'groq', create: async () => { throw new TypeError('bug'); } } });
  await assert.rejects(broken.ask({ message: 'Is it free?' }), /bug/);
});

test('the /guide route is public, and answers 400 for an empty question and 404 without a guide', async () => {
  const open = async (guide) => {
    const app = createApp({ config: testConfig({ host: '127.0.0.1', web: { requireLogin: true } }), services: testServices(), guide });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const call = (message) => fetch(`http://127.0.0.1:${server.address().port}/guide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
    return { server, call };
  };
  const { server, call } = await open(createGuide());
  assert.equal((await call('What is Saathi?')).status, 200);
  assert.equal((await call('')).status, 400);
  server.close();
  const none = await open(null);
  assert.equal((await none.call('hi')).status, 404);
  none.server.close();
});
