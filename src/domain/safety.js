const URGENT = [
  {
    kind: 'fall',
    patterns: [
      /\bi(?:'ve| have| just)?\s+(?:fell|fallen|slipped|tripped)\b/i, /\b(?:can'?t|cannot) get up\b/i, /\bfallen down\b/i,
      /(?:मैं|में)\s+(?:\S+\s+)?गिर/, 'गिर गई हूँ', 'गिर गया हूँ', 'गिर गई हूं', 'गिर गया हूं',
      'मी पडले', 'मी पडलो', 'पडले', 'पडलो', 'घसरले', 'घसरलो',
      /\b(?:main|mai)\s+gir\b/i, /\bgir gay[ai]\b/i, /\bmi padl[eo]\b/i, /\bpadl[eo]\b/i,
    ],
  },
  {
    kind: 'chest-pain',
    patterns: [/\bchest (?:pain|hurts?|is hurting|feels tight)\b/i, 'सीने में दर्द', 'छाती में दर्द', 'छातीत दुख', /\bseene? m[ae]i?n? dard\b/i, /\bchhati\b/i],
  },
  {
    kind: 'breathing',
    patterns: [/\b(?:can'?t|cannot) breathe\b/i, /\bbreathless\b/i, /\bshort of breath\b/i, 'सांस नहीं', 'साँस नहीं', 'श्वास घेता येत नाही', /\bsaans nahi\b/i],
  },
  {
    kind: 'bleeding',
    patterns: [/\bbleeding\b/i, 'खून बह', 'रक्त येत', /\bkhoon beh\b/i],
  },
  {
    kind: 'lost',
    patterns: [/\b(?:don'?t|do not) know where i am\b/i, /\bi(?:'m| am) lost\b/i, /\bcan'?t find (?:my )?(?:way )?home\b/i, 'मैं कहाँ हूँ', 'मैं कहां हूं', 'मी कुठे आहे', 'घर सापडत नाही', /\braasta bhool\b/i],
  },
];

const GENTLE = [
  { kind: 'loneliness', patterns: [/\blonely\b/i, /\balone\b/i, /\bnobody (?:calls|visits)\b/i, /\bno one (?:calls|visits)\b/i, 'अकेली', 'अकेला', 'अकेलापन', 'एकटं', 'एकटी', 'कोणी नाही', /\bakel[ai]\b/i, /\bekti\b/i] },
  { kind: 'missing-family', patterns: [/\bmiss (?:you|her|him|them|my|\w+ so|[A-Z]\w+)\b/i, /\bi miss\b/i, 'याद आ', 'आठवण', /\byaad\b/i] },
  { kind: 'low-mood', patterns: [/\bsad\b/i, /\bcry(?:ing)?\b/i, /\bdepressed\b/i, 'उदास', 'रोना', 'रडू', 'दुःखी', /\budaas\b/i] },
  { kind: 'unwell', patterns: [/\bdizzy\b/i, /\btired\b/i, /\bnot (?:feeling )?well\b/i, /\bfever\b/i, 'चक्कर', 'बुखार', 'ताप', 'बरं नाही', /\bthakan\b/i] },
  { kind: 'confusion', patterns: [/\bconfused\b/i, /\bforg[eo]t(?:ting)?\b/i, 'भूल', 'विसरले', 'विसरते', /\bbhool\b/i] },
];

function match(text, groups) {
  return groups
    .filter((g) => g.patterns.some((p) => (typeof p === 'string' ? text.includes(p) : p.test(text))))
    .map((g) => g.kind);
}

export function assessConcerns(text, sentiment) {
  const urgent = match(text, URGENT);
  const gentle = match(text, GENTLE);
  if (sentiment?.sentiment === 'NEGATIVE' && (sentiment.scores?.negative ?? 0) >= 0.75 && !gentle.length) gentle.push('low-mood');
  const level = urgent.length ? 'urgent' : gentle.length ? 'gentle' : 'none';
  return { level, urgent, gentle };
}
