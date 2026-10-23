import { api, loadSettings, saveSettings, applyDisplay, bindToggle, onEvents, el, timeOf, EVENT_LABELS } from './common.js';

const settings = loadSettings({ language: 'mr', large: true, contrast: false, slow: true, voice: true });
applyDisplay(settings);

const $ = (id) => document.getElementById(id);
const ring = $('ring');
let languages = {};
let sessionId = `device-${Math.random().toString(36).slice(2, 8)}`;

const PHRASES = {
  en: {
    day: 'What day is it today?', tablets: 'Which tablet should I take now?', took: 'I took my tablet',
    messages: 'Any messages from my family?', who: 'Who is Riya?', feel: 'I feel a bit lonely today',
    story: 'When I was young, we made puran poli for every festival in our old wada in Satara.', help: 'Help, I fell down',
    send: 'Tell Riya that I am so proud of her', private: 'I feel sad today, but keep it between us', doctor: 'When do I see the doctor?',
  },
  hi: {
    day: 'आज कौन सा दिन है?', tablets: 'मुझे अभी कौन सी दवा लेनी है?', took: 'मैंने दवा ले ली',
    messages: 'परिवार से कोई संदेश आया?', who: 'रिया कौन है?', feel: 'आज मुझे अकेला लग रहा है',
    story: 'बचपन में हम सातारा के पुराने वाड़े में हर त्योहार पर पूरनपोली बनाते थे।', help: 'मदद करो, मैं गिर गई',
    send: 'Tell Riya मुझे उस पर बहुत गर्व है', private: 'आज मन उदास है, किसी को मत बताना', doctor: 'डॉक्टर के पास कब जाना है?',
  },
  mr: {
    day: 'आज कोणता दिवस आहे?', tablets: 'मला आता कोणती गोळी घ्यायची आहे?', took: 'मी गोळी घेतली',
    messages: 'घरच्यांचा काही निरोप आला का?', who: 'रिया कोण आहे?', feel: 'मला आज खूप एकटं वाटतंय',
    story: 'लहानपणी आम्ही साताऱ्याच्या जुन्या वाड्यात प्रत्येक सणाला पुरणपोळी करायचो.', help: 'मदत करा, मी पडले',
    send: 'Tell Riya मला तिचा खूप अभिमान वाटतो', private: 'मला उदास वाटतंय, कोणाला सांगू नका', doctor: 'मला डॉक्टरकडे कधी जायचं आहे?',
  },
};
const LABELS = {
  en: { day: '📅 What day is it?', tablets: '💊 My tablets', took: '✅ I took it', messages: '💌 Messages', who: '👧 Who is Riya?', feel: '💛 How I feel', story: '📖 Tell a story', send: '📨 Message Riya', private: '🤫 Just between us', doctor: '🩺 Doctor visits', help: '🆘 Help' },
  hi: { day: '📅 आज क्या दिन है?', tablets: '💊 मेरी दवा', took: '✅ दवा ले ली', messages: '💌 संदेश', who: '👧 रिया कौन है?', feel: '💛 मेरा मन', story: '📖 एक कहानी', send: '📨 रिया को संदेश', private: '🤫 सिर्फ़ हमारे बीच', doctor: '🩺 डॉक्टर', help: '🆘 मदद' },
  mr: { day: '📅 आज कोणता दिवस?', tablets: '💊 माझ्या गोळ्या', took: '✅ गोळी घेतली', messages: '💌 निरोप', who: '👧 रिया कोण?', feel: '💛 माझं मन', story: '📖 एक गोष्ट', send: '📨 रियाला निरोप', private: '🤫 आपल्यातच ठेवा', doctor: '🩺 डॉक्टर', help: '🆘 मदत' },
};
const YES_NO = { en: ['Yes, send it', 'No, not now'], hi: ['हाँ, भेज दो', 'नहीं, अभी नहीं'], mr: ['हो, पाठवा', 'नको, आत्ता नको'] };

function setRing(state, label) {
  ring.dataset.state = state;
  ring.setAttribute('aria-label', label);
}

function renderQuick() {
  const lang = PHRASES[settings.language] ? settings.language : 'en';
  $('quick').replaceChildren(...Object.keys(PHRASES.en).map((key) =>
    el('button', { type: 'button', class: key === 'help' ? 'help' : undefined, onclick: () => say(PHRASES[lang][key]) }, LABELS[lang][key])));
}

function tickClock() {
  const tz = 'Asia/Kolkata';
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  $('date').textContent = now.toLocaleDateString(languages[settings.language]?.bcp47 ?? 'en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
}

async function speak(text) {
  if (!settings.voice || !text) return;
  setRing('speaking', 'Alexa is speaking');
  try {
    const res = await fetch('/api/speak', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, language: settings.language, slow: settings.slow }),
    });
    if (res.status === 200) {
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; audio.play().catch(resolve); });
      return;
    }
  } catch {  }
  if (!('speechSynthesis' in window)) return;
  await new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = languages[settings.language]?.bcp47 ?? 'en-IN';
    u.rate = settings.slow ? 0.85 : 1;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

function renderTrace(result) {
  const trace = $('trace');
  if (!result.trace.length) {
    trace.prepend(el('div', { class: 'trace-item' }, el('code', {}, 'no tool call'), el('div', { class: 'muted' }, `brain: ${result.brain}`)));
    return;
  }
  for (const call of [...result.trace].reverse()) {
    trace.prepend(el('div', { class: 'trace-item' },
      el('div', {}, el('span', { class: 'pill' }, 'tools/call'), ' ', el('code', {}, call.tool)),
      el('pre', {}, `arguments: ${JSON.stringify(call.args)}\nresult: ${JSON.stringify(call.result, null, 1)?.slice(0, 900)}`)));
  }
  trace.querySelector('.empty')?.remove();
}

async function say(text) {
  if (!text?.trim()) return;
  $('you-said').textContent = `“${text}”`;
  $('talk-input').value = '';
  setRing('thinking', 'Alexa is thinking');
  try {
    await handleResult(await api('/alexa/turn', { text, language: settings.language, sessionId }));
  } catch (err) {
    $('alexa-said').textContent = "Sorry, I didn't catch that. Could you say it again?";
    setRing('idle', 'Alexa is idle');
    console.error(err);
  }
}

async function askToConfirm({ id, message }) {
  const lang = YES_NO[settings.language] ? settings.language : 'en';
  $('alexa-said').textContent = message;
  $('confirm-yes').textContent = YES_NO[lang][0];
  $('confirm-no').textContent = YES_NO[lang][1];
  $('confirm').hidden = false;
  $('quick').hidden = true;
  $('trace').prepend(el('div', { class: 'trace-item' }, el('span', { class: 'pill mcp' }, 'elicitation/create'), ' ', el('code', {}, message)));
  setRing('listening', 'Alexa is waiting for your answer');
  speak(message).then(() => setRing('listening', 'Alexa is waiting for your answer'));
  const accept = await new Promise((resolve) => {
    $('confirm-yes').onclick = () => resolve(true);
    $('confirm-no').onclick = () => resolve(false);
  });
  $('confirm').hidden = true;
  $('quick').hidden = false;
  setRing('thinking', 'Alexa is thinking');
  return api('/alexa/answer', { id, accept });
}

async function playVoiceNotes(notes) {
  for (const note of notes) {
    setRing('speaking', `Playing a voice message from ${note.from}`);
    $('progress').textContent = `🎤 ${note.from}`;
    await new Promise((resolve) => {
      const audio = new Audio(note.url);
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
    $('progress').textContent = '';
  }
}

async function handleResult(result) {
  while (result.elicitation) result = await askToConfirm(result.elicitation);
  {
    $('progress').textContent = '';
    $('alexa-said').textContent = result.reply;
    $('alexa-said').setAttribute('lang', settings.language);
    renderTrace(result);
    const alarm = result.trace.some((t) => t.tool === 'ask_family_for_help');
    await speak(result.reply);
    await playVoiceNotes(result.trace.flatMap((t) => t.result?.voiceNotes ?? []));
    setRing(alarm ? 'alert' : 'idle', alarm ? 'Help is on the way' : 'Alexa is idle');
    refreshNext();
  }
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer;
$('mic').addEventListener('click', () => {
  if (!Recognition) {
    $('alexa-said').textContent = 'Voice input needs Chrome or Edge. You can type instead.';
    return;
  }
  if (recognizer) { recognizer.stop(); return; }
  recognizer = new Recognition();
  recognizer.lang = languages[settings.language]?.bcp47 ?? 'en-IN';
  recognizer.interimResults = true;
  recognizer.onstart = () => { $('mic').setAttribute('aria-pressed', 'true'); setRing('listening', 'Alexa is listening'); };
  recognizer.onresult = (e) => {
    const transcript = [...e.results].map((r) => r[0].transcript).join('');
    $('you-said').textContent = `“${transcript}”`;
    if (e.results[e.results.length - 1].isFinal) say(transcript);
  };
  recognizer.onend = () => { $('mic').setAttribute('aria-pressed', 'false'); if (ring.dataset.state === 'listening') setRing('idle', 'Alexa is idle'); recognizer = null; };
  recognizer.start();
});

$('talk-form').addEventListener('submit', (e) => { e.preventDefault(); say($('talk-input').value); });

async function refreshNext() {
  try {
    const status = await api('/family/summary');
    const meds = status.medications.filter((m) => m.status === 'due' || m.status === 'missed');
    $('next').textContent = meds.length ? `💊 ${meds.map((m) => m.description).join(', ')}` : '✅ All tablets on track';
  } catch {  }
}

function addEvent(event) {
  const type = event['detail-type'];
  const label = EVENT_LABELS[type] ?? type;
  const d = event.detail ?? {};
  if (type === 'McpProgress') $('progress').textContent = `${d.message ?? ''} (${d.progress}/${d.total})`;
  if (type === 'McpResourceUpdated' && d.uri === 'saathi://today') refreshNext();
  const extra = type === 'McpLog' ? `${d.logger}: ${d.data?.event ?? ''} ${d.data?.state ?? ''}` : type === 'McpProgress' ? d.message
    : d.uri ?? d.state ?? d.kind ?? d.subject ?? d.medication ?? d.title ?? d.sentiment ?? d.status ?? '';
  const pillClass = type.startsWith('Mcp') ? 'pill mcp' : ['HelpRequested', 'EscalationStep'].includes(type) ? 'pill bad' : ['WellbeingConcern', 'QuietDay'].includes(type) ? 'pill warn' : 'pill';
  $('events').prepend(el('li', {}, el('time', {}, timeOf(event.time)), el('span', { class: pillClass }, label), el('span', { class: 'muted' }, extra)));
  if (event['detail-type'] === 'AlertAcknowledged') setRing('idle', 'Alexa is idle');
}

async function init() {
  const status = await api('/status');
  languages = status.languages;
  const select = $('language');
  select.replaceChildren(...Object.entries(languages).map(([code, l]) => el('option', { value: code, selected: code === settings.language }, `${l.native} · ${l.name}`)));
  select.addEventListener('change', () => { settings.language = select.value; saveSettings(settings); renderQuick(); tickClock(); sessionId = `device-${Math.random().toString(36).slice(2, 8)}`; });
  $('brain').textContent = status.brain;
  $('auth').textContent = status.auth;
  $('services').replaceChildren(...Object.entries(status.services).map(([k, v]) =>
    el('span', { class: /amazon|aws|dynamo/.test(v) ? 'pill aws' : 'pill', title: k }, `${k}: ${v}`)));
  renderQuick();
  tickClock();
  refreshNext();
  setInterval(tickClock, 15000);
}

bindToggle($('t-large'), settings, 'large', () => applyDisplay(settings));
bindToggle($('t-contrast'), settings, 'contrast', () => applyDisplay(settings));
bindToggle($('t-slow'), settings, 'slow');
bindToggle($('t-voice'), settings, 'voice');

$('sweep').addEventListener('click', () => api('/demo/sweep', {}));
$('ring-ding').addEventListener('click', async () => {
  const r = await api('/ring/simulate', { kind: 'ding' });
  if (r.say) { $('alexa-said').textContent = r.say; setRing('idle', 'Alexa is idle'); speak(r.say); }
});
$('ring-motion').addEventListener('click', () => api('/ring/simulate', { kind: 'motion' }));
$('reset').addEventListener('click', async () => {
  await api('/demo/reset', {});
  $('trace').replaceChildren(el('p', { class: 'empty' }, 'Say something to see which tools Alexa+ calls.'));
  $('events').replaceChildren();
  $('you-said').textContent = '';
  $('alexa-said').textContent = "Namaste, Aaji. I'm here whenever you want to talk.";
  setRing('idle', 'Alexa is idle');
  refreshNext();
});

onEvents(addEvent);
init();
