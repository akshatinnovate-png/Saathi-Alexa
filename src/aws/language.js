import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { ComprehendClient, DetectSentimentCommand } from '@aws-sdk/client-comprehend';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { LANGUAGES } from '../domain/languages.js';

export function createAwsTranslator({ region, client } = {}) {
  const translate = client ?? new TranslateClient({ region });
  return {
    kind: 'amazon-translate',
    async translate(text, { to, from = 'auto' }) {
      if (!text || from === to) return { text, from, to, translated: false, engine: 'none' };
      const out = await translate.send(new TranslateTextCommand({
        Text: text,
        SourceLanguageCode: from,
        TargetLanguageCode: to,
        Settings: { Profanity: 'MASK' },
      }));
      return {
        text: out.TranslatedText,
        from: out.SourceLanguageCode ?? from,
        to,
        translated: (out.SourceLanguageCode ?? from) !== to,
        engine: 'amazon-translate',
      };
    },
  };
}

const COMPREHEND_SENTIMENT_LANGS = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'ar', 'hi', 'ja', 'ko', 'zh', 'zh-TW']);

export function createAwsSentiment({ region, client, translator } = {}) {
  const comprehend = client ?? new ComprehendClient({ region });
  return {
    kind: 'amazon-comprehend',
    async analyze(text, language) {
      let analysed = text;
      let lang = language;
      if (!COMPREHEND_SENTIMENT_LANGS.has(language)) {
        const t = await translator.translate(text, { from: language, to: 'en' });
        analysed = t.text;
        lang = 'en';
      }
      const out = await comprehend.send(new DetectSentimentCommand({ Text: analysed, LanguageCode: lang }));
      const s = out.SentimentScore ?? {};
      return {
        sentiment: out.Sentiment,
        scores: { positive: s.Positive ?? 0, negative: s.Negative ?? 0, neutral: s.Neutral ?? 0, mixed: s.Mixed ?? 0 },
        analysedLanguage: lang,
        engine: 'amazon-comprehend',
      };
    },
  };
}

export function createAwsSpeech({ region, client } = {}) {
  const polly = client ?? new PollyClient({ region });
  return {
    kind: 'amazon-polly',
    async synthesize(text, language, { slow = false } = {}) {
      const lang = LANGUAGES[language];
      if (!lang?.pollyVoice) return null;
      const ssml = `<speak><prosody rate="${slow ? '85%' : '100%'}">${escapeXml(text)}</prosody></speak>`;
      const out = await polly.send(new SynthesizeSpeechCommand({
        Engine: 'neural',
        OutputFormat: 'mp3',
        TextType: 'ssml',
        Text: ssml,
        VoiceId: lang.pollyVoice,
        LanguageCode: lang.pollyLanguage,
      }));
      return { audio: Buffer.from(await out.AudioStream.transformToByteArray()), contentType: 'audio/mpeg', voice: lang.pollyVoice };
    },
  };
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}
