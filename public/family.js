import { api, loadSettings, saveSettings, applyDisplay, bindToggle, onEvents, el, timeOf } from './common.js';
import { icon, iconEl } from './icons.js';

const settings = loadSettings({ member: 'riya', large: false, contrast: false });
applyDisplay(settings);
const $ = (id) => document.getElementById(id);

let status = null;
let circle = [];
let languages = {};
let elderName = 'Aaji';
let currentView = 'overview';
const loaded = { assistant: null, home: null };

const meId = () => status?.memberId ?? settings.member;
const me = () => circle.find((p) => p.id === meId());
const nameOf = (id) => (id === 'elder' ? elderName : id === 'front-door' ? 'The Ring doorbell' : circle.find((p) => p.id === id)?.name ?? id);
const initials = (name) => String(name ?? '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function avatar(person, size = '') {
  const shade = ['', 'c1', 'c2', 'c3'][[...String(person?.id ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 4];
  const node = el('span', { class: `avatar ${size} ${shade}`, 'aria-hidden': 'true' });
  if (person?.avatarUrl) node.append(el('img', { src: person.avatarUrl, alt: '' }));
  else node.textContent = initials(person?.preferredName ?? person?.name);
  return node;
}

function localTime(tz) {
  try { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz }); } catch { return ''; }
}

const STAGES = [['family-notified', 'Family alerted'], ['neighbour-notified', 'Neighbour alerted'], ['emergency-guidance-sent', 'Emergency guidance']];

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
        el('h3', {}, a.acknowledged ? (a.acknowledgedBy === 'front-door' ? '✅ Help reached her door (Ring doorbell)' : `✅ ${nameOf(a.acknowledgedBy)} is on it`) : `🆘 ${elderName} needs help: ${a.reason}`),
        a.doorbellAt && !a.acknowledged ? el('div', {}, `🔔 Her doorbell rang at ${timeOf(a.doorbellAt)}`) : null,
        el('div', { class: 'muted' }, `“${a.words}” · ${timeOf(a.createdAt)}`),
        el('ol', { class: 'stepper', 'aria-label': 'Escalation progress' },
          ...STAGES.map(([, label], i) => el('li', { class: `step${a.acknowledged ? (i <= Math.max(idx, 0) ? ' done' : '') : i < idx ? ' done' : i === idx ? ' active' : ''}` }, label))),
        a.acknowledged ? null : el('button', { class: 'btn-danger', type: 'button', onclick: () => ack(a.id) }, "I'm on it - I'll call her now"));
    }),
    ...nudges.map((a) => {
      const [emoji, label, act] = NUDGE[a.type];
      return el('div', { class: 'nudge' }, el('span', { 'aria-hidden': 'true' }, emoji), el('span', {}, a.summary), el('button', { class: 'pill-action', type: 'button', onclick: () => act(a) }, label));
    }),
  );
  const badge = $('alert-badge');
  badge.hidden = !(open.some((a) => !a.acknowledged) || nudges.length);
}

async function ack(id) {
  await api(`/family/alerts/${id}/ack`, { member: meId() });
  refresh();
}

async function post(path, body) {
  await api(path, { ...body, member: meId() });
  refresh();
}

function renderHero(s) {
  const elder = status.elder;
  const meds = s.medications;
  const taken = meds.filter((m) => m.status === 'taken').length;
  $('hero-avatar').replaceWith(Object.assign(avatar({ ...elder, id: 'elder' }, 'xs'), { id: 'hero-avatar' }));
  $('hero-chip-text').textContent = `${elderName} · tablets today`;
  $('hero-big').textContent = meds.length ? `${taken}/${meds.length}` : '–';
  const next = meds.filter((m) => ['due', 'upcoming', 'missed'].includes(m.status)).sort((a, b) => a.time.localeCompare(b.time))[0];
  $('hero-sub').replaceChildren(
    meds.length ? `taken so far today` : 'No tablets set up yet',
    next ? el('span', {}, ' · next ', el('strong', {}, next.short ?? next.name), ` at ${next.time}`) : '',
  );
  $('summary').textContent = s.text;
  $('summary').setAttribute('lang', s.language);
  $('summary-en').textContent = s.language !== 'en' ? s.english : '';
  $('days').replaceChildren(...(s.adherence ?? []).map((d) => el('li', {}, d.today ? 'Today' : d.weekday, el('strong', {}, `${d.taken}/${d.expected}`))));
  const urgent = s.alerts.find((a) => a.type === 'help' && !a.acknowledged);
  const action = $('insight-action');
  action.replaceChildren(urgent ? 'Open the alert ' : 'Send a voice note ', el('span', { 'aria-hidden': 'true' }, '→'));
  action.href = urgent ? '#care' : '#messages';
}

function renderPeople() {
  const elder = { ...status.elder, id: 'elder' };
  const everyone = [elder, ...circle];
  $('family-count').textContent = `${everyone.length} in the circle`;
  $('people').replaceChildren(...everyone.map((p) => {
    const mine = p.id === meId();
    const sub = p.id === 'elder' ? `${p.city ?? ''} · ${localTime('Asia/Kolkata')}` : `${p.relationship}${p.city ? ` · ${p.city}` : ''}${p.timezone ? ` · ${localTime(p.timezone)}` : ''}`;
    const body = [avatar(p), el('span', {}, el('strong', {}, p.id === 'elder' ? p.preferredName : p.name, mine ? ' (you)' : ''), el('small', {}, sub))];
    if (mine || p.id === 'elder') {
      return el('button', { class: 'person', type: 'button', title: 'Change photo', onclick: () => pickAvatar(p.id === 'elder' ? 'elder' : p.id) }, ...body, el('span', { class: 'sr-only' }, ', change photo'));
    }
    return el('div', { class: 'person' }, ...body);
  }));
}

function renderUpNext(s) {
  const items = [
    ...s.medications.filter((m) => ['due', 'upcoming', 'missed'].includes(m.status)).map((m) => ({
      kind: 'med', when: m.status === 'missed' ? 'Missed today' : 'Today', title: m.name, time: m.time,
      meta: m.daysLeft != null ? `${m.daysLeft} days left` : '', dots: m.daysLeft != null ? Math.min(7, Math.max(0, Math.round(m.daysLeft / 5))) : null,
    })),
    ...s.appointments.slice(0, 3).map((a) => ({
      kind: 'visit', when: a.daysAway === 0 ? 'Today' : a.daysAway === 1 ? 'Tomorrow' : new Date(`${a.at.slice(0, 10)}T12:00:00`).toLocaleDateString([], { weekday: 'long' }),
      title: a.title, small: a.with, time: a.at.slice(11, 16), meta: a.escortName ? `${a.escortName} is taking her` : 'Nobody taking her yet',
    })),
  ].slice(0, 4);
  if (!items.length) {
    $('upnext').replaceChildren(el('li', {}, el('p', { class: 'empty' }, `Nothing else planned for ${elderName} today.`)));
    return;
  }
  $('upnext').replaceChildren(...items.map((i) => el('li', { class: `next-card ${i.kind}` },
    el('span', { class: 'next-when' }, i.when),
    el('span', { class: 'next-time' }, i.time),
    el('span', { class: 'next-title' }, i.title, i.small ? el('small', {}, i.small) : null),
    el('span', { class: 'next-for' }, `For ${elderName}`),
    el('span', { class: 'next-meta' }, i.meta, i.dots != null ? el('span', { class: 'dots', 'aria-hidden': 'true' }, ...Array.from({ length: 7 }, (_, k) => el('i', { class: k < i.dots ? 'on' : '' }))) : null),
  )));
}

function renderMeds(meds) {
  const tone = { taken: 'ok', missed: 'bad', due: 'warn', upcoming: '' };
  $('meds').replaceChildren(...(meds.length ? meds.map((m) => el('div', { class: 'row-item' },
    el('div', {}, el('strong', {}, m.name), el('small', {}, `${m.time} · ${m.purpose}`)),
    el('div', { class: 'pills' },
      el('span', { class: `pill ${tone[m.status]}` }, m.status === 'taken' ? `taken ${m.takenAt.slice(11, 16)}` : m.status),
      m.daysLeft == null ? null : el('span', { class: `pill ${m.daysLeft <= (m.supply?.lowAtDays ?? 5) ? 'bad' : ''}` }, `${m.daysLeft} days left`))))
    : [el('p', { class: 'empty' }, 'No tablets set up yet.')]));
}

function renderAppointments(appointments) {
  $('appointments').replaceChildren(...(appointments.length ? appointments.map((a) => el('div', { class: 'row-item' },
    el('div', {}, el('strong', {}, a.title), el('small', {}, `${new Date(`${a.at}:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${a.at.slice(11, 16)} · ${a.with} · ${a.place}`)),
    a.escort ? el('span', { class: 'pill ok' }, `${nameOf(a.escort)} is taking her`) : el('button', { class: 'pill-action', type: 'button', onclick: () => post('/family/escort', { appointmentId: a.id }) }, "I'll take her")))
    : [el('p', { class: 'empty' }, 'No doctor visits in the next two weeks.')]));
}

function renderMood(checkins) {
  $('mood').replaceChildren(...(checkins.length ? checkins.map((c) => el('div', { class: 'mood-item' },
    el('span', { class: `dot ${c.sentiment}`, 'aria-hidden': 'true' }),
    el('div', {},
      el('div', { lang: c.language }, `“${c.text}”`),
      c.english !== c.text ? el('div', { class: 'muted' }, c.english) : null,
      el('small', { class: 'muted' }, `${timeOf(c.at)} · ${c.sentiment === 'PRIVATE' ? '🤫 kept between her and Alexa' : c.sentiment.toLowerCase()}`))))
    : [el('p', { class: 'empty' }, 'No check-ins yet today.')]));
}

async function renderDoor() {
  const events = await api('/family/door');
  $('door').replaceChildren(...(events.length ? events.slice(0, 6).map((e) => el('div', { class: 'row-item' },
    el('span', {}, e.kind === 'ding' ? '🔔 Doorbell rang' : '🚶 Movement at the door'), el('span', { class: 'pill' }, timeOf(e.at))))
    : [el('p', { class: 'empty' }, 'No front-door activity yet today.')]));
}

function renderStories(stories) {
  const lang = me()?.language ?? 'en';
  $('stories').replaceChildren(...(stories.length ? stories.map((s) => {
    const mine = s.translations[lang] ?? s.translations.en ?? s.translations[s.language];
    return el('article', { class: 'story' },
      el('h4', {}, s.title),
      el('div', { lang }, mine.text),
      lang !== s.language && mine.text !== s.text ? el('div', { class: 'orig', lang: s.language }, `In her words: ${s.text}`) : null,
      s.audio[lang] ? el('audio', { controls: true, src: s.audio[lang], preload: 'none' }) : null);
  }) : [el('p', { class: 'empty' }, 'Her first story is waiting to be told.')]));
}

function renderLetter(letter) {
  $('letter').textContent = letter ? letter.text : 'Every Sunday evening you get a letter about her week, in your language.';
}

async function renderThread() {
  const msgs = (await api('/family/messages')).filter((m) => m.from === meId() || m.to === meId()).reverse();
  $('thread').replaceChildren(...(msgs.length ? msgs.map((m) => {
    const mine = m.from === meId();
    if (m.system) return el('div', { class: 'notice' }, el('small', {}, `Saathi told ${elderName} · ${timeOf(m.createdAt)}`), el('span', { lang: m.language }, m.text));
    if (m.kind === 'voice') {
      return el('div', { class: `bubble${mine ? ' mine' : ''}` }, el('small', {}, `${nameOf(m.from)} · ${timeOf(m.createdAt)} · voice note${m.read ? ` · heard by ${elderName}` : ''}`), el('audio', { controls: true, src: m.audioUrl, preload: 'none' }));
    }
    const text = !mine && m.translated ? m.translated : m.text;
    return el('div', { class: `bubble${mine ? ' mine' : ''}` },
      el('small', {}, `${nameOf(m.from)} · ${timeOf(m.createdAt)}${!mine && m.translated && m.translated !== m.text ? ` · translated from ${languages[m.language]?.name ?? m.language}` : ''}`),
      text);
  }) : [el('p', { class: 'empty' }, 'No messages yet. Say hello.')]));
  $('thread').scrollTop = $('thread').scrollHeight;
}

async function refresh() {
  const s = await api(`/family/summary?member=${encodeURIComponent(meId())}`);
  renderHero(s);
  renderUpNext(s);
  renderAlerts(s.alerts);
  renderMeds(s.medications);
  renderAppointments(s.appointments ?? []);
  renderMood(s.checkins);
  renderStories(s.stories);
  renderLetter(s.letter);
  if (currentView === 'messages') renderThread();
  if (currentView === 'care') renderDoor();
}

function greet() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('hello').textContent = `${part}, ${me()?.name ?? 'there'}`;
  $('today').textContent = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function show(view) {
  currentView = ['overview', 'care', 'messages', 'memories', 'home', 'assistant'].includes(view) ? view : 'overview';
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== currentView; });
  document.querySelectorAll('[data-nav]').forEach((a) => (a.dataset.nav === currentView ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (currentView === 'messages') renderThread();
  if (currentView === 'care') renderDoor();
  if (currentView === 'assistant' && !loaded.assistant) {
    const { mountAssistant } = await import('./assistant.js');
    loaded.assistant = mountAssistant($('assistant-root'), {
      audience: 'family', name: me()?.name ?? 'there', elderName, initial: new URLSearchParams(location.search).get('ask'),
    });
  }
  if (currentView === 'home' && !loaded.home) {
    const { mountHome } = await import('./home3d.js');
    loaded.home = mountHome($('home-root'), { elderName, canEdit: true });
  }
}

function pickAvatar(forId) {
  const input = $('avatar-file');
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const res = await fetch(`/api/family/avatar?for=${encodeURIComponent(forId)}`, { method: 'POST', headers: { 'content-type': file.type }, body: file });
    input.value = '';
    if (res.ok) await init(false);
  };
  input.click();
}

function setupInvite() {
  const dialog = $('invite-dialog');
  const select = dialog.querySelector('select[name="language"]');
  select.replaceChildren(...Object.entries(languages).map(([code, l]) => el('option', { value: code }, `${l.native} · ${l.name}`)));
  $('open-invite').addEventListener('click', () => { $('invite-error').hidden = true; $('device-key').hidden = true; dialog.showModal(); });
  $('invite-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'send') return;
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/household/invite', { name: f.get('name'), relationship: f.get('relationship'), email: f.get('email'), language: f.get('language'), role: f.get('neighbour') ? 'neighbour' : 'family' });
      dialog.close();
      e.target.reset();
      await init(false);
    } catch (err) {
      $('invite-error').textContent = err.message;
      $('invite-error').hidden = false;
    }
  });
  $('pair-device').addEventListener('click', async () => {
    try {
      const { token, mcpUrl } = await api('/household/device-token', { label: `${elderName}'s Alexa+` });
      $('device-key').textContent = `MCP server: ${mcpUrl}\nAuthorization: Bearer ${token}\n\nShown once. Paste it into your Alexa+ MCP integration.`;
    } catch (err) {
      $('device-key').textContent = err.message;
    }
    $('device-key').hidden = false;
  });
}

let recorder;
let chunks = [];
let startedAt = 0;
$('record').addEventListener('click', async () => {
  const button = $('record');
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { $('record-status').textContent = 'This browser cannot record audio.'; return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      button.setAttribute('aria-pressed', 'false');
      button.textContent = '🎤 Record a voice note';
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const duration = Math.round((Date.now() - startedAt) / 1000);
      $('record-status').textContent = 'Sending…';
      const res = await fetch(`/api/family/voice-note?from=${encodeURIComponent(meId())}&duration=${duration}`, { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
      $('record-status').textContent = res.ok ? `Sent. ${elderName} will hear your voice (${duration}s).` : 'Could not send the voice note.';
      renderThread();
    };
    startedAt = Date.now();
    recorder.start();
    button.setAttribute('aria-pressed', 'true');
    button.textContent = '⏹ Stop and send';
    $('record-status').textContent = `Recording… speak to ${elderName}.`;
  } catch {
    $('record-status').textContent = 'Microphone permission was not given.';
  }
});

$('compose').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('compose-text').value.trim();
  if (!text) return;
  $('compose-text').value = '';
  await api('/family/message', { from: meId(), text });
  renderThread();
});
$('letter-preview').addEventListener('click', async () => renderLetter(await api('/family/letter', { member: meId() })));
$('insight-dismiss').addEventListener('click', () => { $('insight-dismiss').closest('.insight').querySelector('.insight-actions').hidden = true; });
$('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
bindToggle($('t-large'), settings, 'large', () => applyDisplay(settings));
bindToggle($('t-contrast'), settings, 'contrast', () => applyDisplay(settings));

function decorateRail() {
  const icons = { overview: 'overview', care: 'bell', memories: 'letter', messages: 'users', assistant: 'sparkle', home: 'home' };
  document.querySelectorAll('[data-nav]').forEach((a) => a.prepend(iconEl(icons[a.dataset.nav])));
  document.querySelectorAll('[data-icon]').forEach((b) => b.prepend(iconEl(b.dataset.icon)));
  $('live').innerHTML = icon('signal', { size: 22 });
  document.querySelector('#compose .round-btn').innerHTML = icon('send', { size: 20 });
}

async function init(first = true) {
  status = await api('/status');
  circle = status.circle;
  languages = status.languages;
  elderName = status.elder.preferredName;
  if (!status.me) {
    $('view-as').hidden = false;
    $('member').replaceChildren(...circle.map((p) => el('option', { value: p.id, selected: p.id === settings.member }, `${p.name} (${p.relationship})`)));
    if (first) $('member').addEventListener('change', () => { settings.member = $('member').value; saveSettings(settings); init(false); });
  }
  greet();
  renderPeople();
  await refresh();
  if (first) {
    setupInvite();
    $('open-invite').hidden = status.me && status.me.role !== 'owner';
  }
}

decorateRail();
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
let pending;
onEvents((event) => {
  $('live').classList.remove('off');
  clearTimeout(pending);
  pending = setTimeout(refresh, 250);
  if (loaded.home && ['HomeMapUpdated', 'HomeItemPlaced', 'HomeItemRemoved'].includes(event['detail-type'])) loaded.home.reload();
});
setInterval(() => { greet(); if (document.visibilityState === 'visible') refresh(); }, 30000);
init().then(() => show(location.hash.slice(1) || 'overview'));
