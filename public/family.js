import { api, loadSettings, saveSettings, applyDisplay, bindToggle, onEvents, el, timeOf } from './common.js';

const settings = loadSettings({ member: 'riya', large: false, contrast: false });
applyDisplay(settings);
const $ = (id) => document.getElementById(id);

let circle = [];
let languages = {};
const nameOf = (id) => (id === 'elder' ? 'Aaji' : id === 'front-door' ? 'The Ring doorbell' : circle.find((p) => p.id === id)?.name ?? id);
const me = () => circle.find((p) => p.id === settings.member);

const STAGES = [
  ['family-notified', 'Family alerted'],
  ['neighbour-notified', 'Neighbour alerted'],
  ['emergency-guidance-sent', 'Emergency guidance'],
];

function renderAlerts(alerts) {
  const open = alerts.filter((a) => a.type === 'help' && (!a.acknowledged || Date.now() - new Date(a.acknowledgedAt) < 10 * 60e3));
  const nudges = alerts.filter((a) => ['dose-missed', 'quiet-day', 'refill', 'appointment-escort'].includes(a.type) && !a.acknowledged);
  const NUDGE = {
    'dose-missed': ['💊', "I'll remind her", (a) => ack(a.id)],
    'quiet-day': ['🌤', "I'll call her", (a) => ack(a.id)],
    refill: ['🧾', 'Refilled (30 days)', (a) => post('/family/refill', { medicationId: a.medicationId, quantity: 30 })],
    'appointment-escort': ['🚗', "I'll take her", (a) => post('/family/escort', { appointmentId: a.appointmentId })],
  };
  $('alerts').replaceChildren(
    ...open.map((a) => {
      const idx = STAGES.findIndex(([s]) => s === a.escalationStage);
      return el('div', { class: `alert${a.acknowledged ? ' done' : ''}` },
        el('h3', {}, a.acknowledged ? (a.acknowledgedBy === 'front-door' ? '✅ Help reached her door (Ring doorbell)' : `✅ ${nameOf(a.acknowledgedBy)} is on it`) : `🆘 Aaji needs help: ${a.reason}`),
        a.doorbellAt && !a.acknowledged ? el('div', {}, `🔔 Her doorbell rang at ${timeOf(a.doorbellAt)}`) : null,
        el('div', { class: 'muted' }, `“${a.words}” · ${timeOf(a.createdAt)}`),
        el('div', { class: 'stepper', role: 'list', 'aria-label': 'Escalation progress' },
          ...STAGES.map(([, label], i) => el('div', { role: 'listitem', class: `step${a.acknowledged ? (i <= Math.max(idx, 0) ? ' done' : '') : i < idx ? ' done' : i === idx ? ' active' : ''}` }, label))),
        a.acknowledged ? null : el('div', {}, el('button', { class: 'btn danger', type: 'button', onclick: () => ack(a.id) }, "I'm on it - I'll call her now")));
    }),
    ...nudges.map((a) => {
      const [icon, label, act] = NUDGE[a.type];
      return el('div', { class: 'card nudge' },
        el('span', { 'aria-hidden': 'true' }, icon), el('span', {}, a.summary),
        el('button', { class: 'btn secondary', type: 'button', onclick: () => act(a) }, label));
    }),
  );
}

async function ack(id) {
  await api(`/family/alerts/${id}/ack`, { member: settings.member });
  refresh();
}

async function post(path, body) {
  await api(path, { ...body, member: settings.member });
  refresh();
}

function renderMeds(meds) {
  const tone = { taken: 'ok', missed: 'bad', due: 'warn', upcoming: '' };
  $('meds').replaceChildren(...meds.map((m) => el('div', { class: 'med' },
    el('div', {}, el('strong', {}, m.name), el('div', { class: 'muted', style: 'font-size:0.85rem' }, `${m.time} · ${m.purpose}`)),
    el('div', { class: 'med-pills' },
      el('span', { class: `pill ${tone[m.status]}` }, m.status === 'taken' ? `taken ${m.takenAt.slice(11, 16)}` : m.status),
      m.daysLeft === null || m.daysLeft === undefined ? null
        : el('span', { class: `pill ${m.daysLeft <= (m.supply?.lowAtDays ?? 5) ? 'bad' : ''}`, title: 'Days of supply left' }, `${m.daysLeft} days left`)))));
}

function renderAppointments(appointments) {
  $('appointments').replaceChildren(...(appointments.length ? appointments.map((a) => el('div', { class: 'med' },
    el('div', {},
      el('strong', {}, a.title),
      el('div', { class: 'muted', style: 'font-size:0.85rem' }, `${new Date(`${a.at}:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${a.at.slice(11, 16)} · ${a.with} · ${a.place}`)),
    a.escort
      ? el('span', { class: 'pill ok' }, `${nameOf(a.escort)} is taking her`)
      : el('button', { class: 'btn secondary', type: 'button', onclick: () => post('/family/escort', { appointmentId: a.id }) }, "I'll take her")))
    : [el('p', { class: 'empty' }, 'No doctor visits in the next two weeks.')]));
}

function renderLetter(letter) {
  $('letter').textContent = letter ? letter.text : 'Every Sunday evening you get a letter about her week, in your language. Preview this week’s below.';
}

function renderMood(checkins) {
  if (!checkins.length) { $('mood').replaceChildren(el('p', { class: 'empty' }, 'No check-ins yet today.')); return; }
  $('mood').replaceChildren(...checkins.map((c) => el('div', { class: 'mood-item' },
    el('span', { class: `dot ${c.sentiment}`, 'aria-hidden': 'true' }),
    el('div', {},
      el('div', {}, `“${c.text}”`),
      c.english !== c.text ? el('div', { class: 'muted' }, c.english) : null,
      el('div', { class: 'muted', style: 'font-size:0.82rem' }, `${timeOf(c.at)} · ${c.sentiment === 'PRIVATE' ? '🤫 she asked to keep this between her and Alexa' : c.sentiment.toLowerCase()}${c.concerns.level !== 'none' ? ` · ${[...c.concerns.urgent, ...c.concerns.gentle].join(', ')}` : ''}`)))));
}

function renderStories(stories) {
  const lang = me()?.language ?? 'en';
  if (!stories.length) { $('stories').replaceChildren(el('p', { class: 'empty' }, 'Her first story is waiting to be told. Try “Tell a story” on her Alexa.')); return; }
  $('stories').replaceChildren(...stories.map((s) => {
    const mine = s.translations[lang] ?? s.translations.en ?? s.translations[s.language];
    return el('article', { class: 'story' },
      el('h3', {}, s.title),
      el('div', { lang }, mine.text),
      lang !== s.language && mine.text !== s.text ? el('div', { class: 'orig', lang: s.language }, `In her words: ${s.text}`) : null,
      s.audio[lang] ? el('audio', { controls: true, src: s.audio[lang], preload: 'none' }) : null,
      el('div', { class: 'muted', style: 'font-size:0.8rem' }, `${new Date(s.createdAt).toLocaleDateString()} · ${Object.keys(s.translations).map((l) => languages[l]?.name ?? l).join(' · ')}`));
  }));
}

async function renderThread() {
  const msgs = (await api('/family/messages')).filter((m) => m.from === settings.member || m.to === settings.member).reverse();
  $('thread').replaceChildren(...(msgs.length ? msgs.map((m) => {
    const mine = m.from === settings.member;
    if (m.system) {
      return el('div', { class: 'notice' }, el('small', {}, `Saathi told Aaji · ${timeOf(m.createdAt)}`), el('span', { lang: m.language }, m.text));
    }
    if (m.kind === 'voice') {
      return el('div', { class: `bubble${mine ? ' mine' : ''}` },
        el('small', {}, `${nameOf(m.from)} · ${timeOf(m.createdAt)} · voice note${m.read ? ' · heard by Aaji' : ''}`),
        el('audio', { controls: true, src: m.audioUrl, preload: 'none' }));
    }
    const text = !mine && m.translated ? m.translated : m.text;
    return el('div', { class: `bubble${mine ? ' mine' : ''}` },
      el('small', {}, `${nameOf(m.from)} · ${timeOf(m.createdAt)}${!mine && m.translated && m.translated !== m.text ? ` · translated from ${languages[m.language]?.name ?? m.language}` : ''}`),
      text,
      !mine && m.translated && m.translated !== m.text ? el('small', { lang: m.language }, m.text) : null);
  }) : [el('p', { class: 'empty' }, 'No messages yet.')]));
  $('thread').scrollTop = $('thread').scrollHeight;
}

async function renderDoor() {
  const events = await api('/family/door');
  $('door').replaceChildren(...(events.length ? events.slice(0, 6).map((e) => el('div', { class: 'med' },
    el('span', {}, e.kind === 'ding' ? '🔔 Doorbell rang' : '🚶 Movement at the door'),
    el('span', { class: 'pill' }, timeOf(e.at)))) : [el('p', { class: 'empty' }, 'No front-door activity yet today.')]));
}

async function refresh() {
  const s = await api(`/family/summary?member=${settings.member}`);
  $('summary').textContent = s.text;
  $('summary').setAttribute('lang', s.language);
  $('summary-en').textContent = s.language !== 'en' ? s.english : '';
  renderAlerts(s.alerts);
  renderMeds(s.medications);
  renderMood(s.checkins);
  renderStories(s.stories);
  renderAppointments(s.appointments ?? []);
  renderLetter(s.letter);
  renderThread();
  renderDoor();
}

$('compose').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('compose-text').value.trim();
  if (!text) return;
  $('compose-text').value = '';
  await api('/family/message', { from: settings.member, text });
  renderThread();
});

$('letter-preview').addEventListener('click', async () => {
  renderLetter(await api('/family/letter', { member: settings.member }));
});

let recorder;
let chunks = [];
let startedAt = 0;
$('record').addEventListener('click', async () => {
  const button = $('record');
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    $('record-status').textContent = 'This browser cannot record audio.';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      button.setAttribute('aria-pressed', 'false');
      button.textContent = '🎤 Record a voice note';
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const duration = Math.round((Date.now() - startedAt) / 1000);
      $('record-status').textContent = 'Sending…';
      const res = await fetch(`/api/family/voice-note?from=${encodeURIComponent(settings.member)}&duration=${duration}`, { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
      $('record-status').textContent = res.ok ? `Sent. Aaji will hear your voice (${duration}s).` : 'Could not send the voice note.';
      renderThread();
    };
    startedAt = Date.now();
    recorder.start();
    button.setAttribute('aria-pressed', 'true');
    button.textContent = '⏹ Stop and send';
    $('record-status').textContent = 'Recording… speak to Aaji.';
  } catch {
    $('record-status').textContent = 'Microphone permission was not given.';
  }
});

bindToggle($('t-large'), settings, 'large', () => applyDisplay(settings));
bindToggle($('t-contrast'), settings, 'contrast', () => applyDisplay(settings));

async function init() {
  const status = await api('/status');
  circle = status.circle;
  languages = status.languages;
  $('member').replaceChildren(...circle.map((p) => el('option', { value: p.id, selected: p.id === settings.member }, `${p.name} (${p.relationship}, ${languages[p.language]?.name})`)));
  $('member').addEventListener('change', () => { settings.member = $('member').value; saveSettings(settings); refresh(); });
  await refresh();
}

let pending;
onEvents(() => { clearTimeout(pending); pending = setTimeout(refresh, 250); });
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
init();
