import { el } from './common.js';
import { iconEl } from './icons.js';

const $ = (id) => document.getElementById(id);
const TAB_KEY = 'saathi-care-tab';
const CARD_ALIASES = { appointments: 'appts', tablets: 'meds', medicines: 'meds', scams: 'ssn', notifications: 'push', 'medical-id': 'mid' };

const request = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error ?? 'That did not work.'), { status: res.status });
  return out;
};

let noticeTimer;
function notice(message, action = null) {
  let node = $('notice');
  if (!node) {
    node = el('div', { class: 'notice', id: 'notice', role: 'status' });
    document.body.append(node);
  }
  node.replaceChildren(el('span', {}, message), action ? el('button', { type: 'button', class: 'notice-action', onclick: () => { node.hidden = true; action.run(); } }, action.label) : null);
  node.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { node.hidden = true; }, action ? 12000 : 5000);
}

const cards = () => [...document.querySelectorAll('#care-grid [data-card]')];
const tabs = () => [...document.querySelectorAll('#care-tabs [role=tab]')];

function selectTab(name, { focus = false } = {}) {
  const known = tabs().some((t) => t.dataset.tab === name) ? name : 'today';
  for (const t of tabs()) {
    const on = t.dataset.tab === known;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  for (const c of cards()) c.classList.toggle('tab-off', c.dataset.tab !== known);
  $('care-grid').setAttribute('aria-labelledby', `tab-${known}`);
  try { localStorage.setItem(TAB_KEY, known); } catch { return; }
}

function openCard(key) {
  const card = cards().find((c) => c.dataset.card === (CARD_ALIASES[key] ?? key));
  if (!card) return false;
  selectTab(card.dataset.tab);
  if (card.hidden) return true;
  requestAnimationFrame(() => {
    card.scrollIntoView({ behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth', block: 'start' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1800);
    card.querySelector('h3')?.setAttribute('tabindex', '-1');
    card.querySelector('h3')?.focus({ preventScroll: true });
  });
  return true;
}

function setupTabs() {
  const list = $('care-tabs');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const tab = e.target.closest('[role=tab]');
    if (tab) selectTab(tab.dataset.tab);
  });
  list.addEventListener('keydown', (e) => {
    const all = tabs();
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? all[(i + 1) % all.length] : e.key === 'ArrowLeft' ? all[(i - 1 + all.length) % all.length] : e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    selectTab(next.dataset.tab, { focus: true });
  });
  let saved;
  try { saved = localStorage.getItem(TAB_KEY) ?? 'today'; } catch { saved = 'today'; }
  selectTab(saved);
  window.addEventListener('saathi:view', (e) => {
    if (e.detail.view !== 'care' || !e.detail.sub) return;
    if (tabs().some((t) => t.dataset.tab === e.detail.sub)) selectTab(e.detail.sub);
    else openCard(e.detail.sub);
  });
}

function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

function paletteItems() {
  const items = [
    { label: 'Home', hint: 'Page', run: () => go('#overview') },
    { label: 'Care', hint: 'Page', run: () => go('#care') },
    { label: 'Messages', hint: 'Page', run: () => go('#messages') },
    { label: 'Memories and letters', hint: 'Page', run: () => go('#memories') },
    { label: 'More', hint: 'Page', run: () => go('#more') },
  ];
  for (const t of tabs()) items.push({ label: `Care: ${t.textContent}`, hint: 'Section', run: () => go(`#care/${t.dataset.tab}`) });
  for (const c of cards()) {
    if (c.hidden) continue;
    items.push({ label: c.querySelector('h3')?.textContent ?? c.dataset.card, hint: 'Card', words: c.querySelector('.muted')?.textContent ?? '', run: () => go(`#care/${c.dataset.card}`) });
  }
  for (const t of document.querySelectorAll('#view-more .tile')) {
    if (t.hidden) continue;
    items.push({ label: t.querySelector('strong').textContent, hint: t.tagName === 'A' ? 'Open' : 'Action', words: t.querySelector('span')?.textContent ?? '', run: () => t.click() });
  }
  for (const q of document.querySelectorAll('.quick-actions .qa')) items.push({ label: q.textContent.trim(), hint: 'Quick action', words: q.id === 'share-day' ? 'whatsapp summary send' : '', run: () => q.click() });
  return items;
}

function setupPalette() {
  const dialog = $('palette');
  const input = $('palette-input');
  const list = $('palette-list');
  if (!dialog) return;
  let items = [];
  let shown = [];
  let active = 0;

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    shown = items
      .map((it) => {
        const hay = `${it.label} ${it.words ?? ''} ${it.hint}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        return { it, score: it.label.toLowerCase().startsWith(q) ? 0 : it.label.toLowerCase().includes(q) ? 1 : 2 };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .slice(0, 9)
      .map((x) => x.it);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length
      ? shown.map((it, i) => el('li', { role: 'option', id: `palette-${i}`, 'aria-selected': String(i === active), onclick: () => choose(i) }, el('span', {}, it.label), el('small', {}, it.hint)))
      : [el('li', { class: 'palette-empty', role: 'option', 'aria-selected': 'false', 'aria-disabled': 'true' }, 'Nothing matches. Try "tablets" or "settings".')]));
    if (shown.length) input.setAttribute('aria-activedescendant', `palette-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const choose = (i) => {
    const it = shown[i];
    if (!it) return;
    dialog.close();
    it.run();
  };
  const open = () => {
    if (dialog.open) return;
    items = paletteItems();
    input.value = '';
    active = 0;
    draw();
    dialog.showModal();
    input.focus();
  };
  input.addEventListener('input', () => { active = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('open-palette').addEventListener('click', open);
  return open;
}

function setupShortcuts(openPalette) {
  const help = $('shortcuts-dialog');
  $('open-shortcuts')?.addEventListener('click', () => help.showModal());
  const jumps = { h: '#overview', c: '#care', m: '#messages', y: '#memories', o: '#more' };
  let waiting = false;
  let timer;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette?.(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    if (document.querySelector('dialog[open]')) return;
    if (waiting) {
      waiting = false;
      clearTimeout(timer);
      if (jumps[e.key]) { e.preventDefault(); go(jumps[e.key]); }
      return;
    }
    if (e.key === '/') { e.preventDefault(); openPalette?.(); }
    else if (e.key === '?') { e.preventDefault(); help.showModal(); }
    else if (e.key === 'g') { waiting = true; timer = setTimeout(() => { waiting = false; }, 1200); }
  });
}

const SEVERITY_LABEL = { urgent: 'Now', soon: 'Soon', info: 'FYI' };

async function loadAttention() {
  const list = $('attention');
  if (!list) return;
  try {
    const { items } = await request('/attention');
    $('offline').hidden = true;
    $('attention-count').hidden = !items.length;
    $('attention-count').textContent = String(items.length);
    list.replaceChildren(...(items.length
      ? items.map((it) => el('li', { class: `attention-item ${it.severity}` },
        el('span', { class: `sev ${it.severity}` }, SEVERITY_LABEL[it.severity] ?? ''),
        el('div', { class: 'attention-text' }, el('strong', {}, it.title), it.detail ? el('span', {}, it.detail) : null),
        it.action.href
          ? el('a', { class: 'pill-action', href: it.action.href }, it.action.label)
          : el('button', { class: 'pill-action', type: 'button', onclick: (e) => act(e.currentTarget, it) }, it.action.label)))
      : [el('li', { class: 'all-clear' }, iconEl('check', { size: 22 }), el('div', { class: 'attention-text' }, el('strong', {}, 'All clear'), el('span', {}, 'Nothing needs you right now.')))]));
  } catch (err) {
    if (err.status) list.replaceChildren(el('li', { class: 'all-clear' }, el('div', { class: 'attention-text' }, el('strong', {}, 'Could not load this'), el('span', {}, err.message))));
    else $('offline').hidden = false;
  }
}

async function act(button, item) {
  button.disabled = true;
  try {
    await request(item.action.post, { method: 'POST', body: item.action.body ?? {} });
    notice(`Done: ${item.title}`);
    await loadAttention();
  } catch (err) {
    button.disabled = false;
    notice(err.message);
  }
}

const OPENERS = { settings: 'open-settings', invite: 'open-invite', devices: 'open-devices', security: 'open-security', recommended: 'open-recommended' };

async function loadSetup() {
  const card = $('setup-card');
  if (!card) return;
  try {
    const { steps, done, total } = await request('/setup');
    card.hidden = !total || done === total;
    if (card.hidden) return;
    const pct = Math.round((done / total) * 100);
    $('setup-ring').style.setProperty('--pct', String(pct));
    $('setup-ring').textContent = `${done}/${total}`;
    $('setup-ring').setAttribute('aria-label', `${done} of ${total} steps done`);
    $('setup-steps').replaceChildren(...steps.map((s) => el('li', { class: s.done ? 'done' : '' },
      el('span', { class: 'step-mark', 'aria-hidden': 'true' }, s.done ? iconEl('check', { size: 16 }) : ''),
      el('div', { class: 'attention-text' }, el('strong', {}, s.title, s.done ? el('span', { class: 'sr-only' }, ' (done)') : null), s.done ? null : el('span', {}, s.detail)),
      s.done ? null : s.action.href
        ? el('a', { class: 'text-action', href: s.action.href }, s.action.label)
        : el('button', { class: 'text-action', type: 'button', onclick: () => $(OPENERS[s.action.open])?.click() }, s.action.label))));
  } catch {
    card.hidden = true;
  }
}

function renderTimeline(summary, care) {
  const list = $('timeline');
  if (!list) return;
  const today = new Date();
  const day = today.getDay();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const rows = [];
  for (const m of summary.medications ?? []) rows.push({ time: m.time, title: m.name, detail: m.purpose ?? 'Tablet', state: m.status });
  for (const r of care?.routine ?? []) if (!r.days || r.days.includes(day)) rows.push({ time: r.time, title: r.activity, detail: 'Routine', state: 'routine' });
  for (const a of summary.appointments ?? []) if (a.at.slice(0, 10) === ymd) rows.push({ time: a.at.slice(11, 16), title: a.title, detail: a.with ?? 'Visit', state: 'visit' });
  rows.sort((a, b) => a.time.localeCompare(b.time));
  const now = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`;
  const nextIndex = rows.findIndex((r) => r.time >= now);
  const label = { taken: 'Taken', missed: 'Not confirmed', due: 'Due now', upcoming: 'Later', routine: '', visit: 'Visit' };
  list.replaceChildren(...(rows.length
    ? rows.map((r, i) => el('li', { class: `tl ${r.state}${i === nextIndex ? ' next' : ''}` },
      el('time', {}, r.time),
      el('div', { class: 'attention-text' }, el('strong', {}, r.title), el('span', {}, r.detail)),
      label[r.state] ? el('span', { class: `chip ${r.state === 'taken' ? 'done' : r.state === 'missed' ? 'late' : ''}` }, label[r.state]) : null))
    : [el('li', { class: 'all-clear' }, el('div', { class: 'attention-text' }, el('strong', {}, 'Nothing planned today'), el('span', {}, 'Add tablets or a routine in Care.')))]));
}

function setupHome() {
  let lastSummary = null;
  let care = null;
  let timer;
  window.addEventListener('saathi:summary', (e) => {
    lastSummary = e.detail;
    renderTimeline(lastSummary, care);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      loadAttention();
      loadSetup();
      try { care = await request('/care'); renderTimeline(lastSummary, care); } catch { care = null; }
    }, 150);
  });
  $('share-day')?.addEventListener('click', async () => {
    const text = lastSummary?.english ?? lastSummary?.text;
    if (!text) return notice('Nothing to share yet.');
    try {
      if (navigator.share) await navigator.share({ title: 'Saathi', text });
      else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } catch {
      return;
    }
  });
}

function setupRecommended() {
  const dialog = $('recommended-dialog');
  if (!dialog) return;
  const error = $('recommended-error');
  const draw = (changes) => {
    $('recommended-list').replaceChildren(...changes.map((c) => el('li', { class: c.on ? 'done' : '' },
      el('span', { class: 'step-mark', 'aria-hidden': 'true' }, c.on ? iconEl('check', { size: 16 }) : ''),
      el('div', { class: 'attention-text' }, el('strong', {}, c.title, el('span', { class: 'state' }, c.on ? ' · already on' : ' · will be turned on')), el('span', {}, c.detail)))));
    $('recommended-apply').hidden = changes.every((c) => c.on);
    $('recommended-close').textContent = changes.every((c) => c.on) ? 'Close' : 'Not now';
  };
  const fail = (err) => {
    error.textContent = err.status === 403 ? 'Only the person who set up this Saathi can change these.' : err.message;
    error.hidden = false;
  };
  $('open-recommended').addEventListener('click', async () => {
    error.hidden = true;
    $('recommended-list').replaceChildren(el('li', { class: 'skeleton' }), el('li', { class: 'skeleton' }));
    dialog.showModal();
    try { draw((await request('/setup/recommended')).changes); } catch (err) { $('recommended-list').replaceChildren(); fail(err); }
  });
  $('recommended-close').addEventListener('click', () => dialog.close());
  $('recommended-apply').addEventListener('click', async () => {
    error.hidden = true;
    $('recommended-apply').disabled = true;
    try {
      const out = await request('/setup/recommended', { method: 'POST', body: {} });
      dialog.close();
      loadSetup();
      window.dispatchEvent(new CustomEvent('saathi:protection'));
      notice(out.applied.length ? 'Protection is on.' : 'Everything was already on.', out.undo ? {
        label: 'Undo',
        run: async () => {
          try { await request('/setup/recommended/undo', { method: 'POST', body: { undo: out.undo } }); notice('Undone.'); loadSetup(); window.dispatchEvent(new CustomEvent('saathi:protection')); } catch (err) { notice(err.message); }
        },
      } : null);
    } catch (err) {
      fail(err);
    } finally {
      $('recommended-apply').disabled = false;
    }
  });
}

function setupDisplayMenu() {
  const button = $('open-display');
  const pop = $('display-pop');
  if (!button) return;
  const close = () => { pop.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    button.setAttribute('aria-expanded', String(!pop.hidden));
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.display-menu')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); button.focus(); } });
}

function setupAutosave() {
  for (const form of document.querySelectorAll('form[data-autosave]')) {
    form.querySelector('button[type=submit]')?.closest('.calls-actions')?.classList.add('autosaved');
    form.addEventListener('change', () => form.requestSubmit());
  }
}

function setupOffline() {
  const banner = $('offline');
  if (!banner) return;
  window.addEventListener('offline', () => { banner.hidden = false; $('live-text').textContent = 'Offline'; });
  window.addEventListener('online', () => { banner.hidden = true; $('live-text').textContent = 'Live'; loadAttention(); });
  if (!navigator.onLine) banner.hidden = false;
}

function setupInstall() {
  const tile = $('install-app');
  if (!tile) return;
  let prompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    tile.hidden = false;
  });
  tile.addEventListener('click', async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    prompt = null;
    tile.hidden = true;
  });
  window.addEventListener('appinstalled', () => { tile.hidden = true; });
}

function decorate() {
  for (const node of document.querySelectorAll('.quick-actions [data-icon], .search-btn[data-icon]')) {
    if (!node.querySelector('svg')) node.prepend(iconEl(node.dataset.icon, { size: 18 }));
  }
}

setupTabs();
const openPalette = setupPalette();
setupShortcuts(openPalette);
setupHome();
setupRecommended();
setupDisplayMenu();
setupAutosave();
setupOffline();
setupInstall();
decorate();
