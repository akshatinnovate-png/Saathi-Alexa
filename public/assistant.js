import { svg } from './trusted.js';
import { el } from './common.js';
import { icon } from './icons.js';

const BCP47 = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', bn: 'bn-IN', es: 'es-US', fr: 'fr-FR', ar: 'ar-AE' };

const ELDER_COPY = {
  en: { sub: 'How can I help you?', placeholder: 'Ask me anything…', suggestions: ['What day is it today?', 'Which tablet should I take now?', 'Where are my glasses?', 'Any messages from my family?'], yes: 'Yes, send it', no: 'Not now' },
  hi: { sub: 'मैं आपकी क्या मदद करूँ?', placeholder: 'कुछ भी पूछिए…', suggestions: ['आज कौन सा दिन है?', 'मुझे अभी कौन सी दवा लेनी है?', 'मेरा चश्मा कहाँ है?', 'परिवार से कोई संदेश आया?'], yes: 'हाँ, भेज दो', no: 'अभी नहीं' },
  mr: { sub: 'मी तुमची काय मदत करू?', placeholder: 'काहीही विचारा…', suggestions: ['आज कोणता दिवस आहे?', 'मला आता कोणती गोळी घ्यायची आहे?', 'माझा चष्मा कुठे आहे?', 'घरच्यांचा काही निरोप आला का?'], yes: 'हो, पाठवा', no: 'नको' },
};

const SAHAY_COPY = {
  en: { queued: 'Waiting for Sahay on this computer…', sent: 'Sahay is starting…', working: 'Sahay is doing it now…', done: 'Sahay finished.', failed: "Sahay couldn't finish this.", confirm: 'Confirm', skip: 'Not now', confirmed: 'Done.', skipped: 'Okay, I left it.' },
  hi: { queued: 'इस कंप्यूटर पर सहाय का इंतज़ार…', sent: 'सहाय शुरू कर रहा है…', working: 'सहाय अभी कर रहा है…', done: 'सहाय ने कर दिया।', failed: 'सहाय यह पूरा नहीं कर पाया।', confirm: 'हाँ, करो', skip: 'अभी नहीं', confirmed: 'हो गया।', skipped: 'ठीक है, छोड़ दिया।' },
  mr: { queued: 'या संगणकावर सहायची वाट पाहत आहे…', sent: 'सहाय सुरू करत आहे…', working: 'सहाय आता करत आहे…', done: 'सहायने केलं.', failed: 'सहाय हे पूर्ण करू शकला नाही.', confirm: 'हो, करा', skip: 'नको', confirmed: 'झालं.', skipped: 'ठीक आहे, राहू दिलं.' },
};

const ELDER_HELLO = { en: 'Namaste, ', hi: 'नमस्ते, ', mr: 'नमस्कार, ' };
const TILE_COPY = { en: { tablets: 'My tablets today', visit: 'Doctor' }, hi: { tablets: 'आज की दवा', visit: 'डॉक्टर' }, mr: { tablets: 'आजच्या गोळ्या', visit: 'डॉक्टर' } };

async function postJson(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong');
  return json;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'this morning' : h < 17 ? 'this afternoon' : 'this evening';
}

export function mountAssistant(root, { audience = 'family', name = 'there', elderName = 'them', language = 'en', avatar = null, initial = null, onClose = null, speak = null }) {
  const elder = audience === 'elder';
  const copy = ELDER_COPY[language] ?? ELDER_COPY.en;
  const suggestions = elder ? copy.suggestions : [`How was ${elderName} this week?`, `Who is taking ${elderName} to the doctor?`, `Does ${elderName} need a refill?`, `Where are ${elderName}'s glasses?`];
  const suggestIcons = elder ? ['calendar', 'pill', 'search', 'message'] : ['heart', 'calendar', 'pill', 'search'];
  const conversationId = Math.random().toString(36).slice(2);

  const convo = el('div', { class: 'a-convo', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  const input = el('input', { type: 'text', autocomplete: 'off', placeholder: elder ? copy.placeholder : 'Enter message…', 'aria-label': 'Message to Saathi' });
  const mic = el('button', { class: 'a-round', type: 'button', 'aria-label': 'Speak', 'aria-pressed': 'false' });
  mic.innerHTML = svg(icon('mic'));
  const plus = el('button', { class: 'a-round', type: 'button', 'aria-label': 'Show suggestions' });
  plus.innerHTML = svg(icon('plus'));
  const send = el('button', { class: 'a-round', type: 'submit', 'aria-label': 'Send' });
  send.innerHTML = svg(icon('arrowRight'));
  const bar = el('form', { class: 'a-bar a-glass' }, plus, input, mic, send);

  const sheet = el('div', { class: 'a-sheet a-glass' },
    el('h2', { id: 'assistant-title' }, elder ? copy.sub : `${name}, how can I help you ${greeting()}?`),
    el('ul', { class: 'a-suggest' }, ...suggestions.map((q, i) => {
      const b = el('button', { type: 'button', onclick: () => ask(q) }, el('span', { 'aria-hidden': 'true' }), el('span', {}, q), el('span', { 'aria-hidden': 'true' }, '›'));
      b.firstChild.innerHTML = svg(icon(suggestIcons[i % 4], { size: 18 }));
      return el('li', {}, b);
    })));

  const tiles = el('div', { class: 'a-tiles' });
  const head = el('div', { class: 'a-head' },
    el('div', {},
      el('h2', { class: 'a-hello' }, elder ? (ELDER_HELLO[language] ?? ELDER_HELLO.en) : 'Hello, ', avatar ?? '', el('span', {}, name)),
      el('p', { class: 'a-sub' }, elder ? copy.sub : `Here's ${elderName} today`)),
    onClose ? el('button', { class: 'a-close a-glass', type: 'button', 'aria-label': 'Close assistant', onclick: onClose }) : '');
  if (onClose) head.lastChild.innerHTML = svg(icon('close'));

  const shell = el('div', { class: `assistant${elder ? ' elder' : ''}`, lang: elder ? language : undefined }, head, tiles, convo, sheet, bar);
  root.replaceChildren(shell);

  async function loadTiles() {
    try {
      const s = await (await fetch('/api/family/summary')).json();
      const taken = s.medications.filter((m) => m.status === 'taken').length;
      const nextVisit = s.appointments?.[0];
      const latest = s.checkins?.[0];
      const unread = s.alerts.filter((a) => !a.acknowledged).length;
      const tile = (title, iconName, body) => {
        const t = el('article', { class: 'a-tile a-glass' }, el('h3', {}, title, el('span', { 'aria-hidden': 'true' })), ...body);
        t.querySelector('h3 span').innerHTML = svg(icon(iconName, { size: 16 }));
        return t;
      };
      if (elder) {
        const next = s.medications.find((m) => m.status !== 'taken');
        tiles.replaceChildren(
          tile(TILE_COPY[language]?.tablets ?? TILE_COPY.en.tablets, 'pill', [el('p', {}, next ? `${next.name} · ${next.time}` : '✓'), el('p', { class: 'big' }, `${taken}/${s.medications.length}`)]),
          tile(TILE_COPY[language]?.visit ?? TILE_COPY.en.visit, 'calendar', nextVisit ? [el('p', {}, nextVisit.with), el('div', { class: 'sub-card' }, `${nextVisit.at.slice(5, 10)} · ${nextVisit.at.slice(11, 16)}`)] : [el('p', {}, '–')]),
        );
        return;
      }
      tiles.replaceChildren(
        tile('Tablets', 'pill', [el('p', {}, 'taken today'), el('p', { class: 'big' }, `${taken}/${s.medications.length}`)]),
        tile('Next visit', 'calendar', nextVisit ? [el('p', {}, nextVisit.with), el('div', { class: 'sub-card' }, `${nextVisit.title} · ${nextVisit.at.slice(5, 10)} ${nextVisit.at.slice(11, 16)}`)] : [el('p', {}, 'Nothing booked')]),
        tile('Mood', 'heart', latest ? [el('p', {}, latest.sentiment === 'PRIVATE' ? 'Kept private, by choice' : `Feeling ${latest.sentiment.toLowerCase()}`), el('div', { class: 'sub-card', lang: latest.language }, latest.sentiment === 'PRIVATE' ? '🤫' : `“${latest.text}”`)] : [el('p', {}, 'No check-in yet today')]),
        tile('Alerts', 'bell', [el('p', {}, unread ? 'need someone' : 'all quiet'), el('p', { class: 'big' }, String(unread))]),
      );
    } catch {
      tiles.replaceChildren();
    }
  }

  function bubble(kind, text, extra) {
    const node = el('div', { class: `a-msg ${kind}${kind === 'bot' ? ' a-glass' : ''}`, lang: elder ? language : undefined }, text, extra ?? '');
    convo.append(node);
    convo.scrollTop = convo.scrollHeight;
    return node;
  }

  function confirmButtons(elicitation) {
    return new Promise((resolve) => {
      const row = el('div', { class: 'a-confirm' },
        el('button', { class: 'yes', type: 'button', onclick: () => { row.remove(); resolve(true); } }, copy.yes),
        el('button', { class: 'no', type: 'button', onclick: () => { row.remove(); resolve(false); } }, copy.no));
      bubble('bot', elicitation.message);
      convo.append(row);
      row.querySelector('.yes').focus();
    });
  }

  const sahayCopy = SAHAY_COPY[elder ? language : 'en'] ?? SAHAY_COPY.en;

  function watchSahay(taskId) {
    const line = el('div', { class: 'a-sahay', role: 'status' }, sahayCopy.queued);
    convo.append(line);
    convo.scrollTop = convo.scrollHeight;
    const started = Date.now();
    const tick = async () => {
      try {
        const { tasks } = await (await fetch('/api/sahay/tasks')).json();
        const task = tasks.find((t) => t.id === taskId);
        if (task) {
          line.textContent = task.note && ['done', 'failed'].includes(task.status) ? `${sahayCopy[task.status]} ${task.note}` : sahayCopy[task.status] ?? sahayCopy.queued;
          line.dataset.status = task.status;
          if (['done', 'failed'].includes(task.status)) { loadTiles(); return; }
        }
      } catch { }
      if (Date.now() - started < 10 * 60 * 1000) setTimeout(tick, 3000);
    };
    setTimeout(tick, 1500);
  }

  function proposalCard(p) {
    const status = el('p', { class: 'a-card-status', role: 'status' });
    const card = el('div', { class: 'a-card a-glass' },
      el('p', { class: 'a-card-text' }, p.summary),
      el('div', { class: 'a-confirm' },
        el('button', { class: 'yes', type: 'button', onclick: async () => {
          card.querySelector('.a-confirm').remove();
          status.textContent = '…';
          try {
            const out = await postJson('/api/assistant/confirm', { id: p.id });
            status.textContent = sahayCopy.confirmed;
            if (out.sahayTask) watchSahay(out.sahayTask.id);
            loadTiles();
          } catch (err) {
            status.textContent = err.message;
          }
        } }, sahayCopy.confirm),
        el('button', { class: 'no', type: 'button', onclick: () => {
          card.querySelector('.a-confirm').remove();
          status.textContent = sahayCopy.skipped;
          postJson('/api/assistant/dismiss', { id: p.id }).catch(() => {});
        } }, sahayCopy.skip)),
      status);
    convo.append(card);
    convo.scrollTop = convo.scrollHeight;
  }

  async function ask(text) {
    const message = String(text ?? '').trim();
    if (!message) return;
    sheet.hidden = true;
    input.value = '';
    bubble('me', message);
    const thinking = bubble('bot thinking', elder ? '…' : 'Looking into it…');
    try {
      let reply;
      let detail = '';
      let after = null;
      if (elder) {
        let result = await postJson('/api/alexa/turn', { text: message, language, sessionId: `assistant-${conversationId}` });
        while (result.elicitation) {
          thinking.remove();
          const accept = await confirmButtons(result.elicitation);
          result = await postJson('/api/alexa/answer', { id: result.elicitation.id, accept });
        }
        reply = result.reply;
        after = result;
      } else {
        const result = await postJson('/api/assistant', { message, conversationId });
        reply = result.reply;
        detail = result.trace?.length ? `Checked: ${result.trace.map((t) => t.tool.replaceAll('_', ' ')).join(', ')}` : '';
        after = result;
      }
      thinking.remove();
      bubble('bot', reply, detail ? el('small', {}, detail) : '');
      for (const p of after?.proposals ?? []) proposalCard(p);
      if (after?.sahayTask) watchSahay(after.sahayTask.id);
      speak?.(reply);
      loadTiles();
    } catch (err) {
      thinking.remove();
      bubble('bot', err.message);
    }
  }

  bar.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  plus.addEventListener('click', () => { sheet.hidden = !sheet.hidden; });

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer;
  mic.addEventListener('click', () => {
    if (!Recognition) { input.placeholder = 'Voice input needs Chrome or Edge'; return; }
    if (recognizer) { recognizer.stop(); return; }
    recognizer = new Recognition();
    recognizer.lang = BCP47[language] ?? 'en-IN';
    recognizer.onstart = () => mic.setAttribute('aria-pressed', 'true');
    recognizer.onresult = (e) => { const t = [...e.results].map((r) => r[0].transcript).join(''); input.value = t; if (e.results[e.results.length - 1].isFinal) ask(t); };
    recognizer.onend = () => { mic.setAttribute('aria-pressed', 'false'); recognizer = null; };
    recognizer.start();
  });

  loadTiles();
  if (initial) ask(initial);
  return { ask, reload: loadTiles, focus: () => input.focus() };
}
