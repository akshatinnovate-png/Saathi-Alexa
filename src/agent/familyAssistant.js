import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const FAMILY_TOOLS = [
  'family_summary', 'weekly_family_letter', 'get_upcoming_appointments', 'get_medication_schedule',
  'list_memory_stories', 'where_is', 'claim_appointment_escort', 'record_refill',
];

const RULES = [
  { tool: 'weekly_family_letter', test: /week|letter|lately|recently/i, args: (m) => ({ member: m }) },
  { tool: 'get_upcoming_appointments', test: /doctor|appointment|clinic|visit|take (?:her|him|them)|check-?up/i, args: () => ({ language: 'en', days: 30 }) },
  { tool: 'get_medication_schedule', test: /tablet|medicine|pill|refill|dose|supply/i, args: () => ({ language: 'en' }) },
  { tool: 'list_memory_stories', test: /stor(y|ies)|memory book|memories/i, args: () => ({ limit: 5, language: 'en' }) },
  { tool: 'where_is', test: /where (is|are)|kept|find (?:her|his|their|the)/i, args: (_m, text) => ({ item: text.replace(/.*where (is|are)\s*(her|his|their|the|[\p{L}]+'s)?\s*/iu, '').replace(/[?.!]/g, '') || text, language: 'en' }) },
  { tool: 'family_summary', test: /.*/, args: (m) => ({ member: m }) },
];


export function createFamilyAssistant({ mcpUrl, headers, llm }) {
  let mcp;
  let tools = [];
  let elder;
  const conversations = new Map();

  async function connect() {
    if (mcp) return;
    const client = new Client({ name: 'saathi-family-assistant', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: headers ? { headers } : undefined }));
    tools = (await client.listTools()).tools.filter((t) => FAMILY_TOOLS.includes(t.name));
    elder = JSON.parse((await client.readResource({ uri: 'saathi://elder/profile' })).contents[0].text);
    mcp = client;
  }

  async function call(name, args) {
    const result = await mcp.callTool({ name, arguments: args });
    const text = result.content.filter((c) => c.type === 'text').map((c) => c.text);
    return { say: text[0] ?? '', data: result.structuredContent ?? null, raw: text.join('\n'), isError: Boolean(result.isError) };
  }

  async function offline(message, memberId, trace) {
    const rule = RULES.find((r) => r.test.test(message));
    const args = rule.args(memberId, message);
    const result = await call(rule.tool, args);
    trace.push({ tool: rule.tool, args, result: result.data });
    if (rule.tool === 'where_is') return result.say.replace(/^Your /, `${elder.preferredName}'s `);
    return result.say;
  }

  function systemPrompt(memberId, language) {
    return `You are Saathi's assistant inside the family app. You are talking with ${memberId}, a member of ${elder.preferredName}'s care circle.
${elder.preferredName} (${elder.name}) lives in ${elder.city}. Answer warmly and concisely, in ${language ?? 'the language the family member writes in'}.
Use the tools to look things up; never guess about tablets, appointments or alerts. Private check-ins are private: never speculate about them.
If something sounds urgent, say so plainly and suggest calling them. Use plain sentences, no markdown tables.`;
  }

  async function withModel(conversationId, message, memberId, language, trace) {
    const history = conversations.get(conversationId) ?? [];
    history.push({ role: 'user', content: message });
    const anthropicTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    for (let i = 0; i < 6; i++) {
      const response = await llm.create({ system: systemPrompt(memberId, language), tools: anthropicTools, messages: history });
      history.push({ role: 'assistant', content: response.content });
      if (response.stop_reason === 'refusal') return `I can't help with that one, but I can tell you how ${elder.preferredName} is doing today.`;
      if (response.stop_reason === 'pause_turn') continue;
      if (response.stop_reason !== 'tool_use') {
        conversations.set(conversationId, history.slice(-24));
        return response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      }
      const results = [];
      for (const block of response.content.filter((b) => b.type === 'tool_use')) {
        const input = ['family_summary', 'weekly_family_letter', 'claim_appointment_escort', 'record_refill'].includes(block.name) ? { ...block.input, member: memberId } : block.input;
        const result = await call(block.name, input);
        trace.push({ tool: block.name, args: input, result: result.data });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: result.raw, is_error: result.isError });
      }
      history.push({ role: 'user', content: results });
    }
    conversations.set(conversationId, history.slice(-24));
    return 'I looked into that but need a moment longer. Ask me again?';
  }

  return {
    get suggestions() { return suggestionsFor(elder?.preferredName); },
    async ask({ message, memberId = null, language, conversationId = 'default' }) {
      await connect();
      const trace = [];
      let reply;
      let brain = llm ? llm.provider : 'offline';
      if (llm) {
        try {
          reply = await withModel(`${memberId}:${conversationId}`, message, memberId, language, trace);
        } catch (err) {
          if (!(err instanceof Anthropic.APIError)) throw err;
          brain = 'offline (fallback)';
          reply = await offline(message, memberId, trace);
        }
      } else {
        reply = await offline(message, memberId, trace);
      }
      return { reply, brain, trace, suggestions: suggestionsFor(elder?.preferredName) };
    },
    async close() {
      await mcp?.close();
      mcp = undefined;
    },
  };
}
