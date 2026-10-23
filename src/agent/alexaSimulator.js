import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ElicitRequestSchema, LoggingMessageNotificationSchema, ResourceUpdatedNotificationSchema, ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { planOffline } from './offlinePlanner.js';
import { languageName } from '../domain/languages.js';
import { t, spokenLanguage } from '../domain/i18n.js';

const TOOL_TIMEOUT_MS = 5 * 60 * 1000;

class Interaction {
  constructor() { this.queue = []; this.waiters = []; }
  push(item) { const w = this.waiters.shift(); if (w) w(item); else this.queue.push(item); }
  next() { return this.queue.length ? Promise.resolve(this.queue.shift()) : new Promise((r) => this.waiters.push(r)); }
}

export function createAlexaSimulator({ mcpUrl, headers, llm, translator, publish = async () => {} }) {
  let mcp;
  let connecting;
  let tools = [];
  let profile = null;
  let instructions = '';
  let active = null;
  const conversations = new Map();
  const paused = new Map();

  async function connect() {
    if (mcp) return;
    connecting ??= (async () => {
      const client = new Client({ name: 'alexa-plus-simulator', version: '2.0.0' }, { capabilities: { elicitation: { form: {} } } });

      client.setRequestHandler(ElicitRequestSchema, async ({ params }) => {
        const interaction = active;
        if (!interaction) return { action: 'decline' };
        return new Promise((resolve) => {
          interaction.push({ type: 'elicit', id: crypto.randomUUID(), message: params.message, schema: params.requestedSchema, resolve });
        });
      });
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, ({ params }) => publish('McpResourceUpdated', { uri: params.uri }));
      client.setNotificationHandler(ResourceListChangedNotificationSchema, () => publish('McpResourceListChanged', {}));
      client.setNotificationHandler(LoggingMessageNotificationSchema, ({ params }) => publish('McpLog', { level: params.level, logger: params.logger, data: params.data }));

      await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: headers ? { headers } : undefined }));
      instructions = client.getInstructions() ?? '';
      tools = (await client.listTools()).tools;
      profile = JSON.parse((await client.readResource({ uri: 'saathi://elder/profile' })).contents[0].text);
      await client.subscribeResource({ uri: 'saathi://today' });
      await client.setLoggingLevel('notice');
      mcp = client;
    })().finally(() => { connecting = undefined; });
    await connecting;
  }

  function systemPrompt(language) {
    return `You are Alexa+, speaking through a home Echo device with ${profile.preferredName} (${profile.name}).
Reply in ${languageName(language)} unless she switches language; if she does, follow her.
Your replies are spoken aloud: no lists, no markdown, at most three short sentences. Be warm and unhurried.
Accessibility: memory support ${profile.accessibility.memorySupport ? 'on' : 'off'}, hearing ${profile.accessibility.hearing}, pace ${profile.accessibility.preferredPace}.

Guidance from the Saathi MCP server:
${instructions}`;
  }

  async function callTool(name, args) {
    const result = await mcp.callTool({ name, arguments: args }, undefined, {
      timeout: TOOL_TIMEOUT_MS,
      resetTimeoutOnProgress: true,
      onprogress: (p) => publish('McpProgress', { tool: name, progress: p.progress, total: p.total, message: p.message }),
    });
    const text = result.content.filter((c) => c.type === 'text').map((c) => c.text);
    return { say: text[0] ?? '', data: result.structuredContent ?? null, isError: Boolean(result.isError), raw: text.join('\n') };
  }

  async function offlineTurn(text, language, trace) {
    const plan = planOffline(text, language);
    let say;
    let sayLanguage;
    if (!plan) {
      sayLanguage = spokenLanguage(language);
      say = t(sayLanguage, 'idle');
    } else {
      const result = await callTool(plan.tool, plan.args);
      trace.push({ tool: plan.tool, args: plan.args, result: result.data });
      say = result.say;
      sayLanguage = result.data?.sayLanguage ?? 'en';
    }
    if (sayLanguage !== language) say = (await translator.translate(say, { from: sayLanguage, to: language })).text;
    return say;
  }

  async function llmTurn(sessionId, text, language, trace) {
    const history = conversations.get(sessionId) ?? [];
    history.push({ role: 'user', content: text });
    const anthropicTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

    for (let i = 0; i < 8; i++) {
      const response = await llm.create({ system: systemPrompt(language), tools: anthropicTools, messages: history });
      history.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'refusal') {
        conversations.set(sessionId, history);
        return "I'm sorry, I can't help with that one. Shall I call someone in your family?";
      }
      if (response.stop_reason === 'pause_turn') continue;
      if (response.stop_reason !== 'tool_use') {
        conversations.set(sessionId, history);
        return response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      }

      const results = [];
      for (const block of response.content.filter((b) => b.type === 'tool_use')) {
        try {
          const result = await callTool(block.name, block.input);
          trace.push({ tool: block.name, args: block.input, result: result.data });
          results.push({ type: 'tool_result', tool_use_id: block.id, content: result.raw, is_error: result.isError });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: block.id, content: `Tool failed: ${err.message}`, is_error: true });
        }
      }
      history.push({ role: 'user', content: results });
    }
    conversations.set(sessionId, history);
    return "I'm still here with you.";
  }

  async function runTurn({ sessionId, text, language }) {
    const trace = [];
    let reply;
    let brain = llm ? llm.provider : 'offline-planner';
    if (llm) {
      try {
        reply = await llmTurn(sessionId, text, language, trace);
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) console.warn('model rate limited; using offline planner for this turn');
        else if (err instanceof Anthropic.APIError) console.warn(`model API error ${err.status}; using offline planner`, err.message);
        else throw err;
        conversations.delete(sessionId);
        brain = 'offline-planner (fallback)';
        reply = await offlineTurn(text, language, trace);
      }
    } else {
      reply = await offlineTurn(text, language, trace);
    }
    return { reply, language, brain, trace };
  }

  async function settle(work, interaction) {
    const outcome = await Promise.race([work.then((r) => ({ type: 'done', r })), interaction.next()]);
    if (outcome.type === 'done') {
      if (active === interaction) active = null;
      return outcome.r;
    }
    paused.set(outcome.id, { work, interaction, pause: outcome });
    return { elicitation: { id: outcome.id, message: outcome.message, schema: outcome.schema } };
  }

  return {
    async turn({ sessionId = 'default', text, language = 'en' }) {
      await connect();
      const interaction = new Interaction();
      active = interaction;
      const work = runTurn({ sessionId, text, language });
      work.catch(() => {});
      return settle(work, interaction);
    },
    async answer({ id, accept }) {
      const entry = paused.get(id);
      if (!entry) throw new Error('Nothing is waiting for an answer');
      paused.delete(id);
      const field = Object.keys(entry.pause.schema?.properties ?? { send: {} })[0];
      entry.pause.resolve(accept ? { action: 'accept', content: { [field]: true } } : { action: 'decline' });
      return settle(entry.work, entry.interaction);
    },
    reset(sessionId = 'default') {
      conversations.delete(sessionId);
    },
    async close() {
      await mcp?.close();
      mcp = undefined;
    },
  };
}
