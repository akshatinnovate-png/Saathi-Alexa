import Anthropic from '@anthropic-ai/sdk';

const REPO = 'https://github.com/akshatinnovate-png/Saathi-Alexa';

export const FACTS = [
  { id: 'what', test: /what (is|does) saathi|about saathi|tell me about|who is it for|kya hai|काय आहे|क्या है/i, answer: 'Saathi is a companion for elders who live alone and the families who love them. It reminds them about tablets in their own language, explains who is who, reads family messages to them, warns them about scam calls and alerts the family when they need help.', link: `${REPO}#readme` },
  { id: 'languages', test: /language|hindi|marathi|english|tamil|bengali|bhasha|भाषा/i, answer: 'Saathi speaks English, Hindi and Marathi today. Family messages are translated into each person\'s own language. Tamil and Bengali are next on the roadmap.', link: `${REPO}/blob/main/ROADMAP.md` },
  { id: 'alexa', test: /alexa|echo|speaker|voice|claude|mcp|chatgpt/i, answer: 'Saathi works with Alexa+, and with Claude or any app that supports MCP. You can try it in one line: npx -y saathi-alexa runs it with a fictional demo family.', link: `${REPO}#try-it-in-your-mcp-client-30-seconds` },
  { id: 'privacy', test: /privacy|private|data|secure|security|safe|encrypt|who can see|sell/i, answer: 'Each family runs its own Saathi, so the data stays on their computer or cloud account. Health records are sealed with a key protected by the computer\'s security chip, private family messages are end-to-end encrypted, and Saathi never sells data or shows ads.', link: `${REPO}/blob/main/PRIVACY.md` },
  { id: 'scam', test: /scam|fraud|otp|cheat|digital arrest|kyc|thag|धोखा|फसवणूक/i, answer: 'When an elder mentions a call asking for an OTP, PIN, KYC update, money or an app install, or threatening "digital arrest", Saathi calmly tells them not to share or pay anything and alerts the family. Sahay will be able to stop a scam on the computer itself (Scam Guard, on the roadmap).', link: `${REPO}/blob/main/ROADMAP.md` },
  { id: 'help', test: /fall|fell|emergency|help|escalat|alone|neighbour|neighbor/i, answer: 'If the elder asks for help, Saathi alerts the family first, then the neighbour if nobody answers, then shares emergency guidance with everyone, until someone responds.', link: `${REPO}#readme` },
  { id: 'medicines', test: /medicine|tablet|pill|dose|refill|doctor|appointment|dawa|goli|दवा|गोळी/i, answer: 'Saathi knows each tablet by look and purpose, reminds at the right time, prevents double doses, warns the family when supply runs low and keeps track of doctor visits and who is taking them.', link: `${REPO}#readme` },
  { id: 'sahay', test: /sahay|computer|pc|windows|whatsapp|tech|laptop/i, answer: 'Sahay is Saathi\'s helper for the Windows computer. Ask it, or ask Saathi, how to do something like send a WhatsApp message, and Sahay does it on the screen for them and explains each step.', link: 'https://github.com/akshatinnovate-png/Sahay' },
  { id: 'cost', test: /cost|price|free|pay|money|subscription|plan|kitna|किंमत|कीमत/i, answer: 'Saathi is free and open source (MIT). A hosted version with daily phone calls is planned; safety features will always stay free, and the elder will never see a price or an ad.', link: `${REPO}/blob/main/ROADMAP.md` },
  { id: 'setup', test: /set ?up|install|start|download|get it|begin|sign ?up|how do i use|android|apk|docker/i, answer: 'On Windows, download the Saathi installer from the releases page and follow the guide. There is also an Android app and a Docker image. To try it first, use the demo family.', link: `${REPO}/blob/main/docs/INSTALL_WINDOWS.md` },
  { id: 'family', test: /family app|son|daughter|grand|abroad|far away|check on|how (is|was) (she|he|my)/i, answer: 'The family app shows today\'s tablets, mood, messages, doctor visits and alerts, and its assistant can make changes for you after you confirm them.', link: `${REPO}#readme` },
];

const FALLBACK = { answer: "I'm not sure about that one. The README explains everything Saathi does.", link: `${REPO}#readme` };
const ELDER_QUESTION = /\b(aaji|she|her|he|him|this week|today|tablet|refill|doctor visit|glasses)\b/i;

export function createGuide({ llm = null, demoAsk = null } = {}) {
  const lookup = (message) => FACTS.filter((f) => f.test.test(message));

  async function withModel(message) {
    const facts = FACTS.map((f) => `- ${f.answer} (source: ${f.link})`).join('\n');
    const response = await llm.create({
      max_tokens: 400,
      system: `You are the guide on Saathi's website. Answer in 2-3 short, warm sentences, in the language the visitor writes in, using ONLY these facts. If the facts do not cover the question, say you are not sure and point to the README. Never invent features, prices or dates.\n${facts}`,
      messages: [{ role: 'user', content: message }],
    });
    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
  }

  return {
    async ask({ message }) {
      const text = String(message ?? '').trim().slice(0, 500);
      if (!text) throw Object.assign(new Error('Ask me something about Saathi.'), { status: 400 });
      const hits = lookup(text);
      if (demoAsk && ELDER_QUESTION.test(text) && !hits.some((h) => ['what', 'privacy', 'cost', 'setup'].includes(h.id))) {
        return { reply: await demoAsk(text), links: [], brain: 'demo-family' };
      }
      const links = [...new Set((hits.length ? hits : [FALLBACK]).map((h) => h.link))].slice(0, 2);
      if (llm) {
        try {
          const reply = await withModel(text);
          if (reply) return { reply, links, brain: llm.provider };
        } catch (err) {
          if (!(err instanceof Anthropic.APIError)) throw err;
        }
      }
      return { reply: (hits.length ? hits.slice(0, 2) : [FALLBACK]).map((h) => h.answer).join(' '), links, brain: 'guide' };
    },
  };
}
