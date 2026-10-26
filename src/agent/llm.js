import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { languageName } from '../domain/languages.js';

export function createLlm(agentConfig, region) {
  if (agentConfig.provider === 'offline') return null;

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

  return { provider: bedrock ? 'amazon-bedrock' : 'claude-api', model, create, translate, mood };
}
