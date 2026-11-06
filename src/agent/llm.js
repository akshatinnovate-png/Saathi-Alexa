import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { languageName } from '../domain/languages.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function toOpenAiMessages(system, messages) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) });
      else if (b.type === 'text') out.push({ role: 'user', content: b.text });
    }
  }
  return out;
}

function fromOpenAiChoice(choice) {
  const message = choice?.message ?? {};
  const content = [];
  if (message.content) content.push({ type: 'text', text: message.content });
  for (const call of message.tool_calls ?? []) {
    let input;
    try { input = JSON.parse(call.function?.arguments || '{}'); } catch { input = {}; }
    content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input });
  }
  const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : choice?.finish_reason === 'content_filter' ? 'refusal' : 'end_turn';
  return { content, stop_reason: stop };
}

export function createGroqClient({ apiKey, model, fetchImpl = fetch, timeoutMs = 30_000 }) {
  return async function create({ system, tools, messages, max_tokens: maxTokens = 2048 }) {
    const body = {
      model,
      messages: toOpenAiMessages(system, messages),
      max_tokens: maxTokens,
      temperature: 0.3,
      ...(tools?.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema ?? { type: 'object', properties: {} } } })) } : {}),
    };
    let res;
    try {
      res = await fetchImpl(GROQ_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Anthropic.APIConnectionError({ message: `Groq could not be reached: ${err.message}`, cause: err });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Anthropic.APIError.generate(res.status, json, json.error?.message ?? `Groq answered ${res.status}`, res.headers);
    return fromOpenAiChoice(json.choices?.[0]);
  };
}

export function createLlm(agentConfig, region) {
  if (agentConfig.provider === 'offline') return null;

  if (agentConfig.provider === 'groq') {
    const create = createGroqClient({ apiKey: agentConfig.groqKey, model: agentConfig.groqModel, fetchImpl: agentConfig.fetchImpl });
    return withHelpers({ provider: 'groq', model: agentConfig.groqModel, create });
  }

  const bedrock = agentConfig.provider === 'bedrock';
  const client = bedrock ? new AnthropicBedrockMantle({ awsRegion: region }) : new Anthropic();
  const model = bedrock ? agentConfig.bedrockModel : agentConfig.model;

  async function create(params) {
    if (bedrock) {
      return client.messages.create({ model, max_tokens: 16000, output_config: { effort: 'low' }, ...params });
    }
    return client.beta.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      ...params,
    });
  }

  return withHelpers({ provider: bedrock ? 'amazon-bedrock' : 'claude-api', model, create });
}

function withHelpers({ provider, model, create }) {
  async function translate(text, { from, to }) {
    const response = await create({
      system: 'You translate short personal messages between family members. Keep the warmth, names and terms of endearment (Aaji, Nani, beta and so on). Output only the translation.',
      messages: [{ role: 'user', content: `Translate from ${from === 'auto' ? 'the detected language' : languageName(from)} to ${languageName(to)}:\n\n${text}` }],
    });
    if (response.stop_reason === 'refusal') return null;
    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim() || null;
  }

  async function mood(text) {
    const response = await create({
      system: 'You read how an older person says they feel. Reply with only a JSON object: {"sentiment": "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED", "positive": 0-1, "negative": 0-1, "neutral": 0-1, "mixed": 0-1}. Scores add up to 1. Judge the feeling, not the topic; any language.',
      messages: [{ role: 'user', content: text }],
    });
    const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    if (!['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED'].includes(json.sentiment)) return null;
    const n = (v) => Math.max(0, Math.min(1, Number(v) || 0));
    return { sentiment: json.sentiment, scores: { positive: n(json.positive), negative: n(json.negative), neutral: n(json.neutral), mixed: n(json.mixed) } };
  }

  return { provider, model, create, translate, mood };
}
