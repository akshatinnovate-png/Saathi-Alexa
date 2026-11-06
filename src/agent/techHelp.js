const HOW = /\b(how (do|can|to|should) (i|we|you)|how to|show me how|teach me|help me (to |with )?|can you (help|show|set|make|send|open|install|change|turn)|kaise|kese|kaisey|kaisa|kar(o|na|du|dun|ungi|unga|enge)|karwa|bana(o|na|u|un|ungi|unga|dena)|kas[ae]|kasa|kara(yche|ycha)?)\b|कैसे|कैसा|करें|करूँ|करूं|करना|करुंगी|करूंगी|करूँगी|करूंगा|बनाऊं|बनाऊँ|बनाना|कसे|कसं|कसा|करायचे|करायचं|करू|बनवायचा|बनवायचे/iu;
const THING = /\b(whats ?app|youtube|video ?call|voice ?call|zoom|meet|skype|e-?mail|gmail|photo|picture|camera|wi-?fi|internet|bluetooth|printer|print|computer|laptop|\bpc\b|app|group|message|msg|chat|status|sticker|settings|volume|sound|font|text size|zoom in|password|browser|chrome|edge|google|facebook|insta(gram)?|telegram|upi|paytm|phonepe|gpay|pdf|download|upload|file|folder|screen|wallpaper|update|install|shortcut|desktop|contact|ringtone|alarm|reminder|calendar|bill|recharge|ticket|form|aadhaar|pension|bank site|net ?banking)\b|व्हाट्सएप|व्हॉट्सअ‍ॅप|व्हाट्सऐप|यूट्यूब|वीडियो|व्हिडिओ|कॉल|मैसेज|मेसेज|संदेश|ग्रुप|फोटो|कैमरा|इंटरनेट|वाईफाई|कंप्यूटर|संगणक|ईमेल|आवाज|अक्षर/iu;
const NOT_TECH = /\b(medicine|tablet|pill|dose|doctor|appointment|visit|refill|feel|pain|help me now|fell|fall|emergency|scam|otp)\b|दवा|गोळी|औषध|डॉक्टर|दर्द|दुख/iu;

export function isTechHelp(message) {
  const text = String(message ?? '');
  if (text.length > 400 || NOT_TECH.test(text)) return false;
  return HOW.test(text) && THING.test(text);
}

export function languageOf(message, fallback = 'en') {
  const text = String(message ?? '');
  if (/[ऀ-ॿ]/.test(text)) return /(आहे|कसे|कसं|कसा|करायचे|करायचं|मला|तुम्ही|बनवायचा|बनवायचे)/.test(text) ? 'mr' : 'hi';
  if (/\b(kaise|kese|karungi|karunga|karna|karo|mujhe|mei|mein|mai|kya|hai|bana(na|o|u)|bhejna|bhejo)\b/i.test(text)) return 'hi-Latn';
  return fallback;
}

const ASKED = {
  en: "I've asked Sahay to do it for you.",
  'hi-Latn': 'Maine Sahay se keh diya hai, woh aapke liye kar dega.',
  hi: 'मैंने सहाय से कह दिया है, वह आपके लिए कर देगा।',
  mr: 'मी सहायला सांगितलं आहे, तो तुमच्यासाठी करेल.',
};
const OPEN_SAHAY = {
  en: ' Open Sahay on this computer and it will start.',
  'hi-Latn': ' Is computer par Sahay kholiye, woh shuru kar dega.',
  hi: ' इस कंप्यूटर पर सहाय खोलिए, वह शुरू कर देगा।',
  mr: ' या संगणकावर सहाय उघडा, तो सुरू करेल.',
};

export function askedSahay(language, { running = true } = {}) {
  const key = ASKED[language] ? language : String(language ?? '').startsWith('hi') ? 'hi' : 'en';
  return ASKED[key] + (running ? '' : OPEN_SAHAY[key]);
}

export function instructionFor(message) {
  return `Someone at this computer asked: "${String(message).trim()}". Do it for them on this computer, step by step, and tell them simply what you did.`;
}
