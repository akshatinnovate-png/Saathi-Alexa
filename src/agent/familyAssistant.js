import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isTechHelp, languageOf, askedSahay, instructionFor } from './techHelp.js';

const FAMILY_TOOLS = [
  'family_summary', 'weekly_family_letter', 'get_upcoming_appointments', 'get_medication_schedule', 'list_memory_stories', 'where_is',
];
const PROPOSAL_MS = 15 * 60 * 1000;

const str = (description) => ({ type: 'string', description });
const ACTIONS = [
  { name: 'add_medicine', description: 'Propose adding a medicine. Times are 24-hour HH:MM.', input_schema: { type: 'object', properties: { name: str('Medicine name'), purpose: str('What it is for'), times: { type: 'array', items: { type: 'string' } }, withFood: { type: 'boolean' }, description: str('How it looks, e.g. small white tablet') }, required: ['name', 'times'] } },
  { name: 'change_medicine', description: 'Propose changing an existing medicine (its times, name, purpose, food or look).', input_schema: { type: 'object', properties: { medicine: str('Current name or purpose'), name: str('New name'), purpose: str('New purpose'), times: { type: 'array', items: { type: 'string' } }, withFood: { type: 'boolean' }, description: str('New look') }, required: ['medicine'] } },
  { name: 'stop_medicine', description: 'Propose removing a medicine the doctor stopped.', input_schema: { type: 'object', properties: { medicine: str('Name or purpose') }, required: ['medicine'] } },
  { name: 'add_doctor_visit', description: 'Propose booking a doctor visit. at is local time YYYY-MM-DDTHH:MM.', input_schema: { type: 'object', properties: { with: str('Doctor or clinic'), at: str('YYYY-MM-DDTHH:MM'), place: str('Where'), title: str('What the visit is'), notes: str('Notes') }, required: ['with', 'at'] } },
  { name: 'send_message_to_elder', description: 'Propose sending the elder a message; it is translated into their language.', input_schema: { type: 'object', properties: { text: str('The message') }, required: ['text'] } },
  { name: 'record_refill', description: 'Propose recording that a medicine was refilled.', input_schema: { type: 'object', properties: { medicine: str('Name or purpose'), quantity: { type: 'number' } }, required: ['medicine'] } },
  { name: 'escort_doctor_visit', description: 'Propose that this family member takes the elder to a doctor visit.', input_schema: { type: 'object', properties: { visit: str('Doctor name or visit title') }, required: ['visit'] } },
  { name: 'acknowledge_alert', description: 'Propose acknowledging an open alert, which stops its escalation.', input_schema: { type: 'object', properties: { alert: str('Alert id or what it is about; empty for the newest') } } },
  { name: 'ask_sahay', description: "Ask Sahay, the helper on the elder's Windows computer, to do something on that computer: send a WhatsApp message, make a group, join a video call, open a website, change settings, print, and so on.", input_schema: { type: 'object', properties: { instruction: str('What Sahay should do, in plain English') }, required: ['instruction'] } },
];
const ACTION_NAMES = new Set(ACTIONS.map((a) => a.name));

const suggestionsFor = (name) => {
  const who = name || 'them';
  return [`How was ${who} this week?`, `Who is taking ${who} to the doctor?`, `Does ${who} need a refill?`, `Where are ${who}'s glasses?`];
};

const RULES = [
  { tool: 'weekly_family_letter', test: /week|letter|lately|recently/i, args: (m) => ({ member: m }) },
  { tool: 'get_upcoming_appointments', test: /doctor|appointment|clinic|visit|take (?:her|him|them)|check-?up/i, args: () => ({ language: 'en', days: 30 }) },
  { tool: 'get_medication_schedule', test: /tablet|medicine|pill|refill|dose|supply/i, args: () => ({ language: 'en' }) },
  { tool: 'list_memory_stories', test: /stor(y|ies)|memory book|memories/i, args: () => ({ limit: 5, language: 'en' }) },
  { tool: 'where_is', test: /where (is|are)|kept|find (?:her|his|their|the)/i, args: (_m, text) => ({ item: text.replace(/.*where (is|are)\s*(her|his|their|the|[\p{L}]+'s)?\s*/iu, '').replace(/[?.!]/g, '') || text, language: 'en' }) },
  { tool: 'family_summary', test: /.*/, args: (m) => ({ member: m }) },
];

const OFFLINE_ACTIONS = [
  { test: /^(?:please\s+)?(?:send|tell|message)\s+(?:her|him|them|aaji|nani|dadi|mum|mom|dad|papa)\s*(?:a message\s*)?(?:that|saying|:)?\s*(.+)$/i, action: (m) => ({ name: 'send_message_to_elder', input: { text: m[1].trim() } }) },
  { test: /\b(?:i(?:'ll| will)? take (?:her|him|them)|i can take (?:her|him|them))\b.*?(?:to|for)?\s*(?:dr\.?|doctor)?\s*([\p{L}.]+)?/iu, action: (m) => ({ name: 'escort_doctor_visit', input: { visit: m[1] ?? '' } }) },
  { test: /\b(?:refilled|bought more|got more|picked up)\b\s*(?:her|his|their|the)?\s*([\p{L}\s]+?)(?:\s+(?:tablets?|medicines?|pills?))?\s*$/iu, action: (m) => ({ name: 'record_refill', input: { medicine: m[1].trim() } }) },
  { test: /\b(?:acknowledge|i'?m on it|i saw (?:the|that) alert|got the alert)\b/i, action: () => ({ name: 'acknowledge_alert', input: {} }) },
];

const lower = (s) => String(s ?? '').toLowerCase().trim();
const matches = (query, ...fields) => {
  const q = lower(query);
  return Boolean(q) && fields.some((f) => lower(f) === q || lower(f).includes(q) || (lower(f) && q.includes(lower(f))));
};

function describe({ name, input }, elderName) {
  switch (name) {
    case 'add_medicine': return `Add ${input.name}${input.purpose ? ` (${input.purpose})` : ''} at ${(input.times ?? []).join(' and ')}${input.withFood ? ', with food' : ''}.`;
    case 'change_medicine': return `Change ${input.medicine}: ${[input.name && `name ${input.name}`, input.purpose && `for ${input.purpose}`, input.times?.length && `at ${input.times.join(' and ')}`, input.withFood !== undefined && (input.withFood ? 'with food' : 'without food'), input.description && `looks like ${input.description}`].filter(Boolean).join(', ') || 'no changes'}.`;
    case 'stop_medicine': return `Remove ${input.medicine} from ${elderName}'s medicines.`;
    case 'add_doctor_visit': return `Book a visit with ${input.with} on ${String(input.at).replace('T', ' at ')}${input.place ? ` at ${input.place}` : ''}.`;
    case 'send_message_to_elder': return `Send ${elderName}: "${input.text}"`;
    case 'record_refill': return `Record that ${input.medicine} was refilled${input.quantity ? ` (${input.quantity})` : ''}.`;
    case 'escort_doctor_visit': return `You take ${elderName} to ${input.visit || 'the next doctor visit'}.`;
    case 'acknowledge_alert': return `Acknowledge ${input.alert ? `the alert about ${input.alert}` : 'the newest open alert'} and tell ${elderName} someone is coming.`;
    case 'ask_sahay': return `Ask Sahay to do this on ${elderName}'s computer: ${input.instruction}`;
    default: return name;
  }
}

export function createFamilyAssistant({ mcpUrl, headers, llm, householdId = null, sahay = null }) {
  let mcp;
  let tools = [];
  let elder;
  const conversations = new Map();
  const proposals = new Map();

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

  function propose(action, memberId) {
    for (const [id, p] of proposals) if (Date.now() - p.at > PROPOSAL_MS) proposals.delete(id);
    const id = randomUUID();
    const summary = describe(action, elder?.preferredName ?? 'them');
    proposals.set(id, { ...action, memberId, at: Date.now(), summary });
    return { id, action: action.name, summary };
  }

  function delegate(message, { language, memberId, onSahayPc }) {
    const lang = languageOf(message, language ?? 'en');
    if (onSahayPc && sahay) {
      const task = sahay.queue.enqueue({ householdId, instruction: instructionFor(message), original: message, language: lang, requestedBy: memberId });
      return { reply: askedSahay(lang, { running: sahay.queue.alive() }), sahayTask: task, proposals: [] };
    }
    const card = propose({ name: 'ask_sahay', input: { instruction: message } }, memberId);
    return { reply: `I can ask Sahay to do this on ${elder?.preferredName ?? 'their'}'s computer. Confirm below and it will start when that computer is on.`, sahayTask: null, proposals: [card] };
  }

  async function offline(message, memberId, trace, cards) {
    for (const rule of OFFLINE_ACTIONS) {
      const m = message.match(rule.test);
      if (!m) continue;
      cards.push(propose(rule.action(m), memberId));
      return 'Here is what I can do. Check it and confirm below.';
    }
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
Use the lookup tools; never guess about tablets, appointments or alerts. Private check-ins are private: never speculate about them.
You can also act. To change anything (medicines, visits, refills, escorts, alerts, messages to ${elder.preferredName}) call the matching action tool: it only proposes the change, the family member confirms it with a tap. Never say a change is done; say it is ready to confirm. Several changes in one request become several proposals.
If they want something done on ${elder.preferredName}'s computer or phone apps (WhatsApp, video calls, settings, printing, websites), call ask_sahay.
If something sounds urgent, say so plainly and suggest calling them. Use plain sentences, no markdown tables.`;
  }

  async function withModel(conversationId, message, memberId, language, trace, cards) {
    const history = conversations.get(conversationId) ?? [];
    history.push({ role: 'user', content: message });
    const modelTools = [...tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })), ...ACTIONS];
    for (let i = 0; i < 6; i++) {
      const response = await llm.create({ system: systemPrompt(memberId, language), tools: modelTools, messages: history });
      history.push({ role: 'assistant', content: response.content });
      if (response.stop_reason === 'refusal') return `I can't help with that one, but I can tell you how ${elder.preferredName} is doing today.`;
      if (response.stop_reason === 'pause_turn') continue;
      if (response.stop_reason !== 'tool_use') {
        conversations.set(conversationId, history.slice(-24));
        return response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      }
      const results = [];
      for (const block of response.content.filter((b) => b.type === 'tool_use')) {
        if (ACTION_NAMES.has(block.name)) {
          const card = propose({ name: block.name, input: block.input ?? {} }, memberId);
          cards.push(card);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: `Proposed, waiting for ${memberId} to confirm: ${card.summary}` });
          continue;
        }
        const input = ['family_summary', 'weekly_family_letter'].includes(block.name) ? { ...block.input, member: memberId } : block.input;
        const result = await call(block.name, input);
        trace.push({ tool: block.name, args: input, result: result.data });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: result.raw, is_error: result.isError });
      }
      history.push({ role: 'user', content: results });
    }
    conversations.set(conversationId, history.slice(-24));
    return 'I looked into that but need a moment longer. Ask me again?';
  }

  async function resolveMedicine(saathi, query) {
    const meds = (await saathi.careSetup()).medications;
    const med = meds.find((m) => m.id === query) ?? meds.find((m) => matches(query, m.name, m.purpose));
    if (!med) throw Object.assign(new Error(`I could not find a medicine called "${query}".`), { status: 404 });
    return med;
  }

  async function execute(p, saathi) {
    const input = p.input ?? {};
    switch (p.name) {
      case 'add_medicine':
        return { done: true, medication: await saathi.saveMedication({ name: input.name, purpose: input.purpose, times: input.times, withFood: input.withFood, description: input.description }) };
      case 'change_medicine': {
        const med = await resolveMedicine(saathi, input.medicine);
        return { done: true, medication: await saathi.saveMedication({ ...med, ...Object.fromEntries(Object.entries({ name: input.name, purpose: input.purpose, times: input.times, withFood: input.withFood, description: input.description }).filter(([, v]) => v !== undefined && v !== '')), id: med.id }) };
      }
      case 'stop_medicine': {
        const med = await resolveMedicine(saathi, input.medicine);
        return { done: Boolean(await saathi.removeMedication(med.id)) };
      }
      case 'add_doctor_visit':
        return { done: true, appointment: await saathi.saveAppointment({ with: input.with, at: input.at, place: input.place, title: input.title, notes: input.notes }) };
      case 'send_message_to_elder':
        return { done: true, message: await saathi.messageFromFamily({ fromId: p.memberId, text: String(input.text ?? '').trim() }) };
      case 'record_refill': {
        const med = await resolveMedicine(saathi, input.medicine);
        return { done: Boolean(await saathi.recordRefill({ medicationId: med.id, quantity: Number(input.quantity) || 30, by: p.memberId })) };
      }
      case 'escort_doctor_visit': {
        const visits = (await saathi.careSetup()).appointments;
        const visit = visits.find((a) => a.id === input.visit) ?? visits.find((a) => matches(input.visit, a.with, a.title)) ?? (input.visit ? null : visits[0]);
        if (!visit) throw Object.assign(new Error('I could not find that doctor visit.'), { status: 404 });
        return { done: Boolean(await saathi.claimEscort({ appointmentId: visit.id, member: p.memberId })) };
      }
      case 'acknowledge_alert': {
        const open = (await saathi.familySummary({ forMemberId: p.memberId })).alerts.filter((a) => !a.acknowledged);
        const alert = open.find((a) => a.id === input.alert) ?? (input.alert ? open.find((a) => matches(input.alert, a.type, a.summary)) : open[0]);
        if (!alert) throw Object.assign(new Error('There is no open alert like that.'), { status: 404 });
        return { done: Boolean(await saathi.acknowledgeAlert({ alertId: alert.id, by: p.memberId })) };
      }
      case 'ask_sahay': {
        if (!sahay) throw Object.assign(new Error('Sahay is not connected to this Saathi.'), { status: 400 });
        const task = sahay.queue.enqueue({ householdId, instruction: instructionFor(input.instruction), original: input.instruction, requestedBy: p.memberId });
        return { done: true, sahayTask: task, running: sahay.queue.alive() };
      }
      default:
        throw Object.assign(new Error('Unknown action'), { status: 400 });
    }
  }

  return {
    get suggestions() { return suggestionsFor(elder?.preferredName); },

    async ask({ message, memberId = null, language, conversationId = 'default', onSahayPc = false }) {
      await connect();
      if (isTechHelp(message)) {
        const out = delegate(message, { language, memberId, onSahayPc });
        return { ...out, brain: 'sahay', trace: [], suggestions: suggestionsFor(elder?.preferredName) };
      }
      const trace = [];
      const cards = [];
      let reply;
      let brain = llm ? llm.provider : 'offline';
      if (llm) {
        try {
          reply = await withModel(`${memberId}:${conversationId}`, message, memberId, language, trace, cards);
        } catch (err) {
          if (!(err instanceof Anthropic.APIError)) throw err;
          brain = 'offline (fallback)';
          reply = await offline(message, memberId, trace, cards);
        }
      } else {
        reply = await offline(message, memberId, trace, cards);
      }
      return { reply, brain, trace, proposals: cards, sahayTask: null, suggestions: suggestionsFor(elder?.preferredName) };
    },

    async confirm({ id, memberId, saathi }) {
      const p = proposals.get(String(id));
      if (!p || Date.now() - p.at > PROPOSAL_MS) throw Object.assign(new Error('That suggestion expired. Ask me again.'), { status: 404 });
      if (p.memberId !== memberId) throw Object.assign(new Error('Only the person who asked can confirm this.'), { status: 403 });
      proposals.delete(String(id));
      return { ...(await execute(p, saathi)), summary: p.summary };
    },

    peek(id) {
      const p = proposals.get(String(id));
      return p ? { name: p.name, summary: p.summary } : null;
    },

    dismiss(id) {
      return proposals.delete(String(id));
    },

    async close() {
      await mcp?.close();
      mcp = undefined;
    },
  };
}
