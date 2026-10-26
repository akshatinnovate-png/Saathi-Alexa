import { api, loadSettings, saveSettings, applyDisplay, bindToggle, onEvents, el, timeOf, pronounsOf } from './common.js';
import { icon, iconEl } from './icons.js';

const settings = loadSettings({ member: 'riya', large: false, contrast: false });
applyDisplay(settings);
const $ = (id) => document.getElementById(id);

let status = null;
let circle = [];
let languages = {};
let elderName = '';
let pr = pronounsOf(null);
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
    'dose-missed': ['💊', `I'll remind ${pr.object}`, (a) => ack(a.id)],
    'quiet-day': ['🌤', `I'll call ${pr.object}`, (a) => ack(a.id)],
    refill: ['🧾', 'Refilled (30 days)', (a) => post('/family/refill', { medicationId: a.medicationId, quantity: 30 })],
    'appointment-escort': ['🚗', `I'll take ${pr.object}`, (a) => post('/family/escort', { appointmentId: a.appointmentId })],
  };
  $('alerts').replaceChildren(
    ...open.map((a) => {
      const idx = STAGES.findIndex(([s]) => s === a.escalationStage);
      return el('div', { class: `alert${a.acknowledged ? ' done' : ''}` },
        el('h3', {}, a.acknowledged ? (a.acknowledgedBy === 'front-door' ? `✅ Help reached ${pr.possessive} door (doorbell)` : `✅ ${nameOf(a.acknowledgedBy)} is on it`) : `🆘 ${elderName} needs help: ${a.reason}`),
        a.doorbellAt && !a.acknowledged ? el('div', {}, `🔔 ${pr.Possessive} doorbell rang at ${timeOf(a.doorbellAt)}`) : null,
        el('div', { class: 'muted' }, `“${a.words}” · ${timeOf(a.createdAt)}`),
        el('ol', { class: 'stepper', 'aria-label': 'Escalation progress' },
          ...STAGES.map(([, label], i) => el('li', { class: `step${a.acknowledged ? (i <= Math.max(idx, 0) ? ' done' : '') : i < idx ? ' done' : i === idx ? ' active' : ''}` }, label))),
        a.acknowledged ? null : el('button', { class: 'btn-danger', type: 'button', onclick: () => ack(a.id) }, `I'm on it - I'll call ${pr.object} now`));
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
    const sub = p.id === 'elder' ? `${p.city ?? ''} · ${localTime(status.elder.timezone ?? 'UTC')}` : `${p.relationship}${p.city ? ` · ${p.city}` : ''}${p.timezone ? ` · ${localTime(p.timezone)}` : ''}`;
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
      title: a.title, small: a.with, time: a.at.slice(11, 16), meta: a.escortName ? `${a.escortName} is taking ${pr.object}` : `Nobody taking ${pr.object} yet`,
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
    el('button', { class: 'row-link', type: 'button', onclick: () => openVisit(care.appointments.find((x) => x.id === a.id) ?? a) }, el('strong', {}, a.title), el('small', {}, `${new Date(`${a.at}:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${a.at.slice(11, 16)} · ${a.with}${a.place ? ` · ${a.place}` : ''}`)),
    a.escort ? el('span', { class: 'pill ok' }, `${nameOf(a.escort)} is taking ${pr.object}`) : el('button', { class: 'pill-action', type: 'button', onclick: () => post('/family/escort', { appointmentId: a.id }) }, `I'll take ${pr.object}`)))
    : [el('p', { class: 'empty' }, 'No doctor visits in the next two weeks.')]));
}

function renderMood(checkins) {
  $('mood').replaceChildren(...(checkins.length ? checkins.map((c) => el('div', { class: 'mood-item' },
    el('span', { class: `dot ${c.sentiment}`, 'aria-hidden': 'true' }),
    el('div', {},
      el('div', { lang: c.language }, `“${c.text}”`),
      c.english !== c.text ? el('div', { class: 'muted' }, c.english) : null,
      el('small', { class: 'muted' }, `${timeOf(c.at)} · ${c.sentiment === 'PRIVATE' ? `🤫 kept between ${pr.object} and Saathi` : c.sentiment.toLowerCase()}`))))
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
      lang !== s.language && mine.text !== s.text ? el('div', { class: 'orig', lang: s.language }, `In ${pr.possessive} words: ${s.text}`) : null,
      s.audio[lang] ? el('audio', { controls: true, src: s.audio[lang], preload: 'none' }) : null);
  }) : [el('p', { class: 'empty' }, `${pr.Possessive} first story is waiting to be told.`)]));
}

function renderLetter(letter) {
  $('letter').textContent = letter ? letter.text : `Every Sunday evening you get a letter about ${pr.possessive} week, in your language.`;
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

function toast(message, ms = 5000) {
  const node = $('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, ms);
}

async function call(path, method = 'GET') {
  const res = await fetch(`/api${path}`, { method });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

async function renderMailStatus() {
  const box = $('mail-status');
  try {
    const mail = await call('/mail');
    const owner = status.me?.role === 'owner';
    const parts = [];
    if (mail.gmail) parts.push(el('span', {}, `Invites and alerts are sent from your Gmail, ${mail.gmail.email}.`));
    else if (mail.real) parts.push(el('span', {}, `Invites and alerts are emailed by Saathi${mail.from ? ` (${mail.from})` : ''}.`));
    else parts.push(el('span', {}, "Email isn't set up on this Saathi yet, so you'll get a link to share instead."));
    if (owner && mail.googleAvailable && !mail.gmail) parts.push(el('a', { class: 'pill-action', href: '/auth/google?gmail=1' }, 'Send from my Gmail'));
    if (owner && mail.gmail) parts.push(el('button', { class: 'text-action', type: 'button', onclick: async () => { await call('/mail/gmail', 'DELETE'); renderMailStatus(); } }, 'Disconnect Gmail'));
    if (mail.real || mail.gmail) parts.push(el('button', { class: 'text-action', type: 'button', onclick: async () => { const r = await api('/mail/test', {}); toast(r.sent ? `Test email sent to ${status.me.email}.` : "That address can't receive email."); } }, 'Send me a test'));
    box.replaceChildren(...parts);
  } catch {
    box.replaceChildren();
  }
}

async function renderPending() {
  try {
    const pending = await call('/household/invites');
    $('pending-invites').hidden = !pending.length;
    $('pending-list').replaceChildren(...pending.map((p) => {
      const person = circle.find((c) => c.id === p.memberId);
      return el('li', {}, el('span', {}, `${person?.name ?? p.email} · ${p.email}`),
        status.me?.role === 'owner' ? el('button', { class: 'text-action', type: 'button', onclick: async () => {
          try { showInviteResult(person ?? { name: p.email, email: p.email }, await api(`/household/invite/${encodeURIComponent(p.memberId)}/resend`, {})); } catch (err) { toast(err.message); }
        } }, 'Send again') : '');
    }));
  } catch {
    $('pending-invites').hidden = true;
  }
}

function showInviteResult(member, invite) {
  $('invite-form').hidden = true;
  $('invite-done').hidden = false;
  const first = String(member.name ?? '').split(' ')[0] || 'them';
  if (invite.joined) {
    $('invite-done-h').textContent = `${first} is in the circle`;
    $('invite-done-text').textContent = `${first} already had a Saathi account, so they're part of ${elderName}'s circle now.`;
  } else {
    $('invite-done-h').textContent = invite.emailed ? 'Invite sent' : 'Share the invite';
    $('invite-done-text').textContent = invite.emailed
      ? `We emailed ${member.email}. You can also send ${first} the link yourself.`
      : `Send ${first} this link. It works for 30 days.`;
  }
  const link = invite.link;
  $('copy-link').hidden = !link;
  $('whatsapp-link').hidden = !link;
  if (link) {
    $('whatsapp-link').href = `https://wa.me/?text=${encodeURIComponent(`Join ${elderName}'s family circle on Saathi: ${link}`)}`;
    $('copy-link').onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast('Link copied.'); } catch { prompt('Copy this link', link); }
    };
  }
  $('invite-close').focus();
}

function setupInvite() {
  const dialog = $('invite-dialog');
  const select = dialog.querySelector('select[name="language"]');
  select.replaceChildren(...Object.entries(languages).map(([code, l]) => el('option', { value: code }, `${l.native} · ${l.name}`)));
  $('open-invite').addEventListener('click', () => {
    $('invite-error').hidden = true;
    $('invite-form').hidden = false;
    $('invite-done').hidden = true;
    renderMailStatus();
    renderPending();
    dialog.showModal();
  });
  $('invite-close').addEventListener('click', () => dialog.close());
  $('invite-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'send') return;
    e.preventDefault();
    const f = new FormData(e.target);
    $('invite-send').disabled = true;
    try {
      const member = await api('/household/invite', { name: f.get('name'), relationship: f.get('relationship'), email: f.get('email'), language: f.get('language'), role: f.get('neighbour') ? 'neighbour' : 'family' });
      e.target.reset();
      showInviteResult(member, member.invite ?? {});
      await init(false);
    } catch (err) {
      $('invite-error').textContent = err.message;
      $('invite-error').hidden = false;
    } finally {
      $('invite-send').disabled = false;
    }
  });
}

function setupDevices() {
  const dialog = $('device-dialog');
  let countdown;
  $('device-h').textContent = `Set up ${elderName}'s device`;
  $('open-devices').setAttribute('aria-label', `Set up ${elderName}'s device`);

  async function newCode() {
    $('pair-error').hidden = true;
    try {
      const { code, expiresAt, url, qr } = await api('/devices/pairing-code', {});
      $('pair-code').textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
      $('pair-url').textContent = url.replace(/^https?:\/\//, '');
      $('pair-qr').innerHTML = qr;
      clearInterval(countdown);
      const tick = () => {
        const left = Math.max(0, Math.round((new Date(expiresAt) - Date.now()) / 1000));
        $('pair-expiry').textContent = left ? `Works for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} more` : 'This code expired. Tap "New code".';
        if (!left) clearInterval(countdown);
      };
      tick();
      countdown = setInterval(tick, 1000);
    } catch (err) {
      $('pair-error').textContent = err.message;
      $('pair-error').hidden = false;
    }
  }

  let known = null;
  let watcher;
  async function renderDevices() {
    try {
      const devices = await call('/devices');
      if (known !== null && devices.length > known) {
        toast(`${devices[0].label} is connected.`);
        $('pair-code').textContent = '✓ Connected';
        $('pair-expiry').textContent = '';
        clearInterval(countdown);
      }
      known = devices.length;
      $('device-list').replaceChildren(...(devices.length ? devices.map((d) => el('li', {},
        el('span', {}, `${d.label} · since ${new Date(d.pairedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}`),
        el('button', { class: 'text-action', type: 'button', onclick: async () => { await call(`/devices/${encodeURIComponent(d.id)}`, 'DELETE'); renderDevices(); } }, 'Remove'))) : [el('li', { class: 'muted' }, 'None yet.')]));
    } catch {
      $('device-list').replaceChildren();
    }
  }

  $('open-devices').addEventListener('click', () => {
    $('device-key').hidden = true;
    known = null;
    newCode();
    renderDevices();
    clearInterval(watcher);
    watcher = setInterval(renderDevices, 3000);
    dialog.showModal();
  });
  $('pair-new').addEventListener('click', newCode);
  $('device-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { clearInterval(countdown); clearInterval(watcher); });
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

async function setupSettings() {
  const dialog = $('settings-dialog');
  const form = $('settings-form');
  const owner = status.me?.role === 'owner';
  $('open-settings').hidden = !owner;
  if (!owner) return;
  let reference = { countries: {} };
  try { reference = await (await fetch('/api/reference')).json(); } catch { }
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  function fill() {
    const e = status.elder;
    form.language.replaceChildren(...Object.entries(languages).map(([code, l]) => el('option', { value: code, selected: code === e.language }, `${l.native} · ${l.name}`)));
    form.country.replaceChildren(...Object.entries(reference.countries).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([code, c]) => el('option', { value: code, selected: code === e.country }, c.name)), el('option', { value: '', selected: !e.country }, 'Somewhere else'));
    form.timezone.replaceChildren(...[...new Set([e.timezone ?? 'UTC', ...zones])].sort().map((z) => el('option', { value: z, selected: z === (e.timezone ?? 'UTC') }, z.replaceAll('_', ' '))));
    form.name.value = e.name ?? '';
    form.preferredName.value = e.preferredName ?? '';
    form.pronoun.value = e.pronoun ?? 'they';
    form.emergencyNumber.value = e.emergencyNumber ?? reference.countries[e.country]?.emergency ?? '';
    form.city.value = e.city ?? '';
    form.home.value = e.home ?? '';
    form.pharmacyName.value = e.pharmacy?.name ?? '';
    form.pharmacyPhone.value = e.pharmacy?.phone ?? '';
    form.memorySupport.checked = Boolean(e.accessibility?.memorySupport);
    form.hearingLoss.checked = e.accessibility?.hearing === 'mild-loss';
    form.lowVision.checked = e.accessibility?.vision === 'low-vision';
    form.shareMoodWords.checked = e.privacy?.shareMoodWords !== false;
    $('member-list').replaceChildren(...circle.map((p) => el('li', {},
      el('span', {}, `${p.name} · ${p.relationship}${p.email ? ` · ${p.email}` : ''}`),
      p.id === status.memberId ? el('span', { class: 'muted' }, 'You') : el('button', { class: 'text-action', type: 'button', onclick: async () => {
        if (!confirm(`Remove ${p.name} from ${elderName}'s circle? They will stop getting updates.`)) return;
        try { await call(`/household/members/${encodeURIComponent(p.id)}`, 'DELETE'); await init(false); fill(); toast(`${p.name} was removed.`); } catch (err) { toast(err.message); }
      } }, 'Remove'))));
  }

  form.country.addEventListener('change', () => { form.emergencyNumber.value = reference.countries[form.country.value]?.emergency ?? form.emergencyNumber.value; });
  $('open-settings').addEventListener('click', () => { $('settings-error').hidden = true; fill(); renderDoorbell(); dialog.showModal(); });

  async function renderDoorbell() {
    const box = $('doorbell');
    let state;
    try { state = await call('/doorbell'); } catch { box.replaceChildren(); return; }
    const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const fail = (err) => { error.textContent = err.message; error.hidden = false; };
    const parts = [];
    if (state.ring.connected) {
      parts.push(el('p', {}, `Ring is connected (${state.ring.email ?? 'your account'})${state.ring.cameras?.length ? `: ${state.ring.cameras.join(', ')}` : ''}. When someone rings during an alert, the family is told, and once the neighbour has been sent for, the alert closes.`),
        state.ring.error ? el('p', { class: 'form-error' }, `Last problem: ${state.ring.error}`) : '',
        el('button', { class: 'text-action', type: 'button', onclick: async () => { await send('/doorbell/ring', 'DELETE'); renderDoorbell(); } }, 'Disconnect Ring'));
    } else {
      const email = el('input', { type: 'email', autocomplete: 'off', 'aria-label': 'Ring account email', placeholder: 'Ring account email' });
      const password = el('input', { type: 'password', autocomplete: 'off', 'aria-label': 'Ring account password', placeholder: 'Password' });
      const code = el('input', { inputmode: 'numeric', autocomplete: 'one-time-code', 'aria-label': 'Code from Ring', placeholder: 'Code from Ring' });
      const codeRow = el('div', { class: 'ring-row', hidden: true }, code, el('button', { class: 'pill-action', type: 'button', onclick: async () => {
        try { await send('/doorbell/ring/code', 'POST', { code: code.value }); toast('Ring connected.'); renderDoorbell(); } catch (err) { fail(err); }
      } }, 'Confirm code'));
      const prompt = el('p', { class: 'muted small', hidden: true });
      parts.push(el('p', { class: 'muted' }, 'Have a Ring doorbell? Connect the account so Saathi hears the bell. Your password is used once to get a key and is not stored.'),
        el('div', { class: 'ring-row' }, email, password, el('button', { class: 'pill-action', type: 'button', onclick: async () => {
          try {
            const out = await send('/doorbell/ring', 'POST', { email: email.value, password: password.value });
            password.value = '';
            if (out.needsCode) { prompt.textContent = out.prompt; prompt.hidden = false; codeRow.hidden = false; code.focus(); return; }
            toast('Ring connected.'); renderDoorbell();
          } catch (err) { fail(err); }
        } }, 'Connect Ring')), prompt, codeRow);
    }
    const hook = el('code', { class: 'hook-url' }, state.hookUrl ?? '');
    parts.push(el('details', { class: 'advanced' }, el('summary', {}, 'Another doorbell or smart-home system'),
      el('p', { class: 'muted' }, 'Any doorbell that can call a web link works: Home Assistant, IFTTT, SmartThings, Alexa routines through a webhook skill. Send a POST to this private link with {"event": "ding"} or {"event": "motion"}.'),
      hook,
      el('div', { class: 'share-row' },
        el('button', { class: 'pill-action', type: 'button', onclick: async () => { const out = await send('/doorbell/hook', 'POST'); hook.textContent = out.hookUrl; try { await navigator.clipboard.writeText(out.hookUrl); toast('New link copied. The old one stops working.'); } catch { } } }, state.hookUrl ? 'Make a new link' : 'Make a doorbell link'),
        state.hookUrl ? el('button', { class: 'text-action', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(hook.textContent); toast('Link copied.'); } catch { } } }, 'Copy') : '')));
    parts.push(error);
    box.replaceChildren(...parts);
  }
  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    try {
      const res = await fetch('/api/household/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        name: form.name.value, preferredName: form.preferredName.value, language: form.language.value, pronoun: form.pronoun.value,
        country: form.country.value, emergencyNumber: form.emergencyNumber.value, timezone: form.timezone.value, city: form.city.value, home: form.home.value,
        pharmacy: { name: form.pharmacyName.value, phone: form.pharmacyPhone.value },
        accessibility: { memorySupport: form.memorySupport.checked, hearingLoss: form.hearingLoss.checked, lowVision: form.lowVision.checked },
        shareMoodWords: form.shareMoodWords.checked,
      }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not save.');
      dialog.close();
      toast('Saved.');
      await init(false);
    } catch (err) {
      $('settings-error').textContent = err.message;
      $('settings-error').hidden = false;
    }
  });
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let care = { medications: [], appointments: [], routine: [] };

async function loadCare() {
  try {
    care = await call('/care');
  } catch {
    care = { medications: [], appointments: [], routine: [] };
  }
  $('routine').replaceChildren(...(care.routine.length
    ? care.routine.map((r) => el('li', {}, el('strong', {}, r.time), r.activity, r.days ? el('span', { class: 'muted' }, ` · ${r.days.map((d) => DAYS[d]).join(', ')}`) : ''))
    : [el('li', { class: 'muted' }, 'Nothing yet. Add meals, walks or regular calls.')]));
}

async function send(path, method, body) {
  const res = await fetch(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong.');
  return json;
}

function editor(title, ...content) {
  const dialog = $('edit-dialog');
  $('edit-body').replaceChildren(el('h2', { id: 'edit-h' }, title), ...content);
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function field(label, input) {
  return el('label', {}, label, input);
}

function dayPicker(selected) {
  return el('fieldset', { class: 'day-picks' }, el('legend', {}, 'Days (leave all unticked for every day)'),
    ...DAYS.map((d, i) => el('label', {}, el('input', { type: 'checkbox', value: String(i), checked: Boolean(selected?.includes(i)) }), d)));
}
const pickedDays = (root) => [...root.querySelectorAll('.day-picks input:checked')].map((x) => Number(x.value));

function openMedicines(editing = null) {
  const m = editing ?? {};
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const inputs = {
    name: el('input', { required: true, autocomplete: 'off', value: m.name ?? '', placeholder: 'Amlodipine 5 mg' }),
    purpose: el('input', { autocomplete: 'off', value: m.purpose ?? '', placeholder: 'blood pressure' }),
    description: el('input', { autocomplete: 'off', value: m.description ?? '', placeholder: 'small white round tablet' }),
    time1: el('input', { type: 'time', value: m.times?.[0] ?? '09:00' }),
    time2: el('input', { type: 'time', value: m.times?.[1] ?? '' }),
    time3: el('input', { type: 'time', value: m.times?.[2] ?? '' }),
    remaining: el('input', { type: 'number', min: '0', value: m.supply?.remaining ?? '' }),
    withFood: el('input', { type: 'checkbox', checked: Boolean(m.withFood) }),
  };
  const days = dayPicker(m.days);
  const form = el('form', { class: 'sheet-form inner' },
    el('div', { class: 'sheet-row' }, field('Medicine', inputs.name), field('For', inputs.purpose)),
    field('What it looks like (so it can be described to them)', inputs.description),
    el('div', { class: 'sheet-row three' }, field('Time', inputs.time1), field('Second time', inputs.time2), field('Third time', inputs.time3)),
    days,
    el('div', { class: 'sheet-row' }, field('Tablets left (leave empty if you do not track it)', inputs.remaining), el('label', { class: 'inline-check' }, inputs.withFood, ' Take with food')),
    error,
    el('div', { class: 'sheet-actions' },
      el('button', { class: 'text-action', type: 'button', onclick: () => $('edit-dialog').close() }, 'Close'),
      el('button', { class: 'pill-action dark', type: 'submit' }, editing ? 'Save changes' : 'Add medicine')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: inputs.name.value, purpose: inputs.purpose.value, description: inputs.description.value,
      times: [inputs.time1.value, inputs.time2.value, inputs.time3.value].filter(Boolean), days: pickedDays(form),
      remaining: inputs.remaining.value, withFood: inputs.withFood.checked,
    };
    try {
      await send(editing ? `/care/medications/${encodeURIComponent(editing.id)}` : '/care/medications', editing ? 'PUT' : 'POST', body);
      toast(editing ? 'Medicine updated.' : 'Medicine added.');
      await loadCare();
      await refresh();
      openMedicines();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  const list = el('ul', { class: 'edit-list' }, ...(care.medications.length ? care.medications.map((x) => el('li', {},
    el('div', {}, el('strong', {}, x.name), el('small', { class: 'muted' }, `${x.times.join(', ')}${x.days ? ` · ${x.days.map((d) => DAYS[d]).join(', ')}` : ' · every day'} · ${x.purpose}${x.daysLeft != null ? ` · ${x.daysLeft} days left` : ''}`)),
    el('div', { class: 'row-actions' },
      el('button', { class: 'text-action', type: 'button', onclick: () => openMedicines(x) }, 'Edit'),
      el('button', { class: 'text-action', type: 'button', onclick: async () => {
        if (!confirm(`Remove ${x.name}? ${elderName} will no longer be reminded about it.`)) return;
        await send(`/care/medications/${encodeURIComponent(x.id)}`, 'DELETE');
        await loadCare(); await refresh(); openMedicines();
      } }, 'Remove')))) : [el('li', { class: 'muted' }, 'No medicines yet.')]));
  editor(editing ? `Edit ${editing.name}` : 'Medicines', ...(editing ? [] : [list, el('h3', { class: 'devices-h' }, 'Add a medicine')]), form);
  inputs.name.focus();
}

function openVisit(editing = null) {
  const a = editing ?? {};
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const inputs = {
    title: el('input', { autocomplete: 'off', value: a.title ?? '', placeholder: 'Check-up' }),
    with: el('input', { required: true, autocomplete: 'off', value: a.with ?? '', placeholder: 'Dr. Mehta' }),
    place: el('input', { autocomplete: 'off', value: a.place ?? '', placeholder: 'Clinic and area' }),
    date: el('input', { type: 'date', value: a.at?.slice(0, 10) ?? tomorrow, required: true }),
    time: el('input', { type: 'time', value: a.at?.slice(11, 16) ?? '10:00', required: true }),
    notes: el('input', { autocomplete: 'off', value: a.notes ?? '', placeholder: 'Bring the old reports' }),
  };
  const form = el('form', { class: 'sheet-form inner' },
    el('div', { class: 'sheet-row' }, field('What for', inputs.title), field('With', inputs.with)),
    field('Where', inputs.place),
    el('div', { class: 'sheet-row' }, field(`Date (${elderName}'s time)`, inputs.date), field('Time', inputs.time)),
    field('Notes for whoever takes them', inputs.notes),
    error,
    el('div', { class: 'sheet-actions' },
      editing ? el('button', { class: 'text-action', type: 'button', onclick: async () => {
        if (!confirm('Remove this visit?')) return;
        await send(`/care/appointments/${encodeURIComponent(editing.id)}`, 'DELETE');
        $('edit-dialog').close(); await loadCare(); await refresh();
      } }, 'Remove visit') : '',
      el('button', { class: 'text-action', type: 'button', onclick: () => $('edit-dialog').close() }, 'Close'),
      el('button', { class: 'pill-action dark', type: 'submit' }, editing ? 'Save changes' : 'Add visit')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await send(editing ? `/care/appointments/${encodeURIComponent(editing.id)}` : '/care/appointments', editing ? 'PUT' : 'POST', {
        title: inputs.title.value, with: inputs.with.value, place: inputs.place.value, at: `${inputs.date.value}T${inputs.time.value}`, notes: inputs.notes.value,
      });
      $('edit-dialog').close();
      toast(editing ? 'Visit updated.' : `Visit added. ${elderName} will be reminded.`);
      await loadCare();
      await refresh();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  editor(editing ? 'Edit visit' : 'Add a doctor visit', form);
  inputs.with.focus();
}

function openRoutine() {
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const rows = el('div', { class: 'routine-rows' });
  const addRow = (item = {}) => {
    const time = el('input', { type: 'time', value: item.time ?? '' , 'aria-label': 'Time' });
    const activity = el('input', { autocomplete: 'off', value: item.activity ?? '', placeholder: 'Evening walk with Meera', 'aria-label': 'Activity' });
    const row = el('div', { class: 'routine-row' }, field('Time', time), field('Activity', activity),
      el('button', { class: 'text-action', type: 'button', onclick: () => row.remove() }, 'Remove'));
    row.dataset.days = JSON.stringify(item.days ?? []);
    rows.append(row);
  };
  care.routine.forEach(addRow);
  if (!care.routine.length) addRow();
  const form = el('form', { class: 'sheet-form inner' }, rows,
    el('button', { class: 'text-action', type: 'button', onclick: () => addRow() }, '+ Add another'),
    error,
    el('div', { class: 'sheet-actions' },
      el('button', { class: 'text-action', type: 'button', onclick: () => $('edit-dialog').close() }, 'Close'),
      el('button', { class: 'pill-action dark', type: 'submit' }, 'Save routine')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const routine = [...rows.children].map((row) => {
      const [time, activity] = row.querySelectorAll('input');
      const days = JSON.parse(row.dataset.days || '[]');
      return { time: time.value, activity: activity.value, days: days.length ? days : undefined };
    }).filter((r) => r.activity.trim());
    try {
      await send('/care/routine', 'PUT', { routine });
      $('edit-dialog').close();
      toast('Routine saved.');
      await loadCare();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  editor(`${elderName}'s day`, el('p', { class: 'muted' }, `Meals, walks, prayers, regular calls. When ${elderName} asks "what should I do now?", Saathi answers from this. Tablets are added on their own.`), form);
}

function setupCareEditing() {
  $('manage-meds').addEventListener('click', () => openMedicines());
  $('manage-appts').addEventListener('click', () => openVisit());
  $('manage-routine').addEventListener('click', () => openRoutine());
  const neighbour = circle.find((p) => p.id === status.memberId)?.role === 'neighbour';
  for (const id of ['manage-meds', 'manage-appts', 'manage-routine']) $(id).hidden = neighbour;
  loadCare();
}

function showReturnNotice() {
  const params = new URLSearchParams(location.search);
  const gmail = params.get('gmail');
  if (!gmail) return;
  const messages = {
    connected: 'Gmail connected. Invites and alerts will come from your address.',
    failed: 'Gmail did not connect. Please try again.',
    'no-permission': 'Google did not give permission to send email. Try again and tick "Send email on your behalf".',
    'owner-only': 'Only the person who set up this household can connect Gmail.',
  };
  toast(messages[gmail] ?? 'Done.', 7000);
  history.replaceState(null, '', location.pathname + location.hash);
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
  pr = pronounsOf(status.elder);
  $('translate-note').hidden = status.services?.translate !== 'passthrough';
  $('mood-h').textContent = `How ${elderName} has been feeling`;
  $('compose-text').placeholder = `Write in your language. ${elderName} hears it in theirs.`;
  $('record-status').textContent = `${elderName} hears your actual voice, not a translation.`;
  $('device-intro').textContent = `Use an Echo Show, a tablet or an old phone. Keep it plugged in near where ${elderName} sits.`;
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
    setupDevices();
    setupSettings();
    setupCareEditing();
    showReturnNotice();
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
