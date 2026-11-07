import { el } from './common.js';

const range = (w) => `${w.from} to ${w.to}`;
const show = (v, suffix = '') => (v === null || v === undefined ? '–' : `${v}${suffix}`);

async function load() {
  const root = document.getElementById('report');
  try {
    const res = await fetch('/api/insight?weeks=4');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The report could not be made.');
    const r = await res.json();
    document.title = `Doctor report: ${r.elder.name} · Saathi`;
    root.replaceChildren(
      el('h1', {}, `${r.elder.name}: the last four weeks`),
      el('p', { class: 'dr-meta' }, `Made by Saathi on ${new Date(r.generatedAt).toLocaleDateString([], { dateStyle: 'long' })} · ${r.elder.city ?? ''}`),
      el('p', { class: 'dr-summary' }, r.summary),
      r.changes.length ? el('ul', {}, ...r.changes.map((c) => el('li', {}, c.text))) : null,
      el('h2', {}, 'Medicines this week'),
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Medicine'), el('th', { scope: 'col' }, 'For'), el('th', { scope: 'col' }, 'When'), el('th', { scope: 'col' }, 'Taken'))),
        el('tbody', {}, ...r.medications.map((m) => el('tr', {}, el('td', {}, m.name), el('td', {}, m.purpose ?? ''), el('td', {}, `${m.times.join(', ')}${m.withFood ? ', with food' : ''}`), el('td', {}, show(m.adherence, '%')))))),
      el('h2', {}, 'Week by week'),
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Week'), el('th', { scope: 'col' }, 'Tablets taken'), el('th', { scope: 'col' }, 'Evening missed'), el('th', { scope: 'col' }, 'Check-ins (low)'), el('th', { scope: 'col' }, 'Asked day or time'), el('th', { scope: 'col' }, 'Days with door activity'), el('th', { scope: 'col' }, 'Help requests'))),
        el('tbody', {}, ...r.weeks.map((w) => el('tr', {}, el('td', {}, range(w)), el('td', {}, show(w.adherence, '%')), el('td', {}, show(w.eveningMissed)), el('td', {}, `${w.checkins} (${w.lowCheckins})`), el('td', {}, show(w.askedTime)), el('td', {}, show(w.doorDays)), el('td', {}, show(w.helpRequests)))))),
      el('p', { class: 'dr-note' }, 'Saathi notices patterns in daily life: tablets confirmed, how they said they felt, how often they asked for the day or time, and activity at the front door. It is not a medical device and does not diagnose. Private check-ins are counted but never shown.'));
  } catch (err) {
    root.replaceChildren(el('p', {}, err.message));
  }
}

document.getElementById('print').addEventListener('click', () => window.print());
load();
