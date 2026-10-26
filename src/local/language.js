export function createLocalTranslator({ llmTranslate } = {}) {
  return {
    kind: llmTranslate ? 'claude' : 'passthrough',
    async translate(text, { to, from = 'auto' }) {
      if (!text || from === to) return { text, from, to, translated: false, engine: 'none' };
      if (llmTranslate) {
        try {
          const out = await llmTranslate(text, { from, to });
          if (out) return { text: out, from, to, translated: true, engine: 'claude' };
        } catch {
        }
      }
      return { text, from, to, translated: false, engine: 'passthrough' };
    },
  };
}

const POSITIVE = [
  'happy', 'good', 'great', 'wonderful', 'love', 'fine', 'better', 'lovely', 'nice', 'joy', 'proud', 'thank',
  'खुश', 'अच्छा', 'अच्छी', 'बढ़िया', 'प्यार', 'आनंद', 'छान', 'मस्त', 'बरं', 'बरे', 'आनंदी',
  'khush', 'accha', 'achha', 'chhan', 'mast', 'bara',
];
const NEGATIVE = [
  'sad', 'tired', 'lonely', 'alone', 'pain', 'hurt', 'bad', 'worried', 'scared', 'afraid', 'confused', 'sick', 'dizzy', 'miss', 'cry',
  'उदास', 'थकी', 'थका', 'अकेली', 'अकेला', 'दर्द', 'डर', 'बीमार', 'चक्कर', 'याद',
  'दुःख', 'दुखतंय', 'एकटं', 'एकटी', 'भीती', 'थकले', 'आजारी', 'आठवण',
  'udaas', 'akeli', 'dard', 'dar', 'ekta', 'ekti', 'bhiti', 'thakle',
];

export function createLocalSentiment() {
  return {
    kind: 'local-lexicon',
    async analyze(text) {
      const t = text.toLowerCase();
      const count = (words) => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
      const pos = count(POSITIVE);
      const neg = count(NEGATIVE);
      const total = pos + neg || 1;
      const sentiment = pos && neg ? 'MIXED' : neg ? 'NEGATIVE' : pos ? 'POSITIVE' : 'NEUTRAL';
      return {
        sentiment,
        scores: {
          positive: pos / total * (pos ? 0.9 : 0),
          negative: neg / total * (neg ? 0.9 : 0),
          neutral: pos || neg ? 0.1 : 1,
          mixed: pos && neg ? 0.5 : 0,
        },
        analysedLanguage: 'multi',
        engine: 'local-lexicon',
      };
    },
  };
}

export function createModelSentiment({ mood, fallback = createLocalSentiment() }) {
  return {
    kind: 'claude',
    async analyze(text, language) {
      try {
        const out = await mood(text, language);
        if (out) return { ...out, analysedLanguage: language ?? 'multi', engine: 'claude' };
      } catch {
      }
      return fallback.analyze(text, language);
    },
  };
}

export function createLocalSpeech() {
  return { kind: 'browser-speech', async synthesize() { return null; } };
}
