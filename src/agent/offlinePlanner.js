import { assessConcerns } from '../domain/safety.js';

const RULES = [
  { tool: 'ask_family_for_help', test: { test: (t) => /\bhelp\b|मदद|मदत|बचाओ|madad|madat/i.test(t) || assessConcerns(t).level === 'urgent' }, args: (t) => {
    const urgent = assessConcerns(t).urgent;
    return { reason: t, urgency: urgent.some((k) => ['chest-pain', 'breathing', 'bleeding'].includes(k)) ? 'critical' : 'high' };
  } },
  { tool: 'get_upcoming_appointments', test: /doctor|appointment|clinic|check-?up|डॉक्टर|डॉक्टरकडे|अपॉइंटमेंट|दवाखान|हॉस्पिटल|अस्पताल/i, args: () => ({}) },
  { tool: 'confirm_medication_taken', test: /(took|taken|had) (my )?(tablet|pill|medicine)|गोली (ले|खा)ली|गोळी घेतली|दवा ले ली/i, args: () => ({}) },
  { tool: 'get_medication_schedule', test: /tablet|pill|medicine|दवा|गोली|गोळी|औषध/i, args: () => ({}) },
  { tool: 'what_day_is_it', test: /what day|which day|what time|date today|where am i|आज कौन|आज कोणता|किती वाजले|कितने बजे|what should i do/i, args: () => ({}) },
  { tool: 'who_is', test: /who is|who's|कौन है|कोण आहे/i, args: (t) => ({ person: t.replace(/.*(who is|who's|कौन है|कोण आहे)\s*/i, '').replace(/[?.!]/g, '').trim() || t }) },
  { tool: 'get_family_messages', test: /message|any news|what did .* say|संदेश|मेसेज|निरोप/i, args: () => ({}) },
  { tool: 'send_message_to_family', test: /^(tell|send|message) /i, args: (t) => {
    const m = t.match(/^(?:tell|send|message)\s+(?:a message to\s+)?(\w+)\s+(?:that\s+)?(.*)$/i);
    return m ? { to: m[1], message: m[2] } : { message: t };
  } },
  { tool: 'save_memory_story', test: /remember when|when i was|story|in my childhood|बचपन|लहानपणी|आठवतं|गोष्ट/i, args: (t) => ({ story: t }) },
  { tool: 'list_memory_stories', test: /memory book|my stories/i, args: () => ({}) },
  { tool: 'daily_check_in', test: /i feel|i'm feeling|i am feeling|lonely|sad|happy|tired|मुझे .* लग|मला .* वाटत|एकटं|उदास|छान/i, args: (t, lang) => ({ how_i_feel: t, language: lang }) },
];

const PRIVATE = /between us|don'?t tell|do not tell|keep (?:it|this) private|किसी को मत बता|किसी को न बता|कोणाला सांगू नको|कोणाला सांगू नका|sangu naka/i;

export function planOffline(text, language) {
  const rule = RULES.find((r) => r.test.test(text));
  if (!rule) return null;
  const args = rule.args(text, language);
  if (language) args.language = language;
  if (rule.tool === 'daily_check_in' && PRIVATE.test(text)) args.keep_private = true;
  return { tool: rule.tool, args };
}
