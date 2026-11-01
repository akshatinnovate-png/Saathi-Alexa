import { el } from './common.js';

const card = document.getElementById('card');
document.getElementById('print').addEventListener('click', () => window.print());

const row = (label, value, cls = '') => (value ? el('div', { class: `mid-row ${cls}`.trim() }, el('dt', {}, label), el('dd', {}, value)) : null);
const timesOf = (m) => (Array.isArray(m.times) && m.times.length ? m.times : [m.time].filter(Boolean)).join(', ');

async function load() {
  const [statusRes, careRes] = await Promise.all([fetch('/api/status'), fetch('/api/care')]);
  if (statusRes.status === 401) { location.replace('/login.html?next=/medical-id.html'); return; }
  if (careRes.status === 403) {
    card.replaceChildren(el('h1', {}, 'Only family can open this card'), el('p', {}, 'The medical card holds health details, so it is shown to family members, not to neighbours.'));
    return;
  }
  if (!statusRes.ok || (!careRes.ok && careRes.status !== 401)) throw new Error('Saathi could not load the card.');
  const status = await statusRes.json();
  const care = careRes.ok ? await careRes.json() : { medications: null };
  const e = status.elder ?? {};
  const med = e.medical ?? {};
  const langs = [e.language, e.secondaryLanguage].filter(Boolean).map((c) => status.languages?.[c] ? `${status.languages[c].name} (${status.languages[c].native})` : c).join(', ');
  const needs = [
    e.accessibility?.memorySupport ? 'Has memory loss: speak slowly and simply, and tell the family' : null,
    e.accessibility?.hearing === 'mild-loss' ? 'Hard of hearing: face them and speak clearly' : null,
    e.accessibility?.vision === 'low-vision' ? 'Low vision' : null,
  ].filter(Boolean);
  const family = (status.circle ?? []).filter((p) => p.role !== 'neighbour');
  const neighbour = (status.circle ?? []).find((p) => p.role === 'neighbour');
  const missing = !med.conditions && !med.allergies && !med.bloodGroup;

  document.title = `Medical ID · ${e.name ?? 'Saathi'}`;
  card.replaceChildren(...[
    el('div', { class: 'mid-head' },
      el('div', {}, el('p', { class: 'mid-kicker' }, 'Medical ID · In an emergency'), el('h1', {}, e.name ?? ''), e.preferredName ? el('p', { class: 'mid-sub' }, `Called “${e.preferredName}” by family`) : null),
      el('img', { src: 'assets/logo-ink.svg', alt: 'Saathi', class: 'mid-logo' })),
    missing ? el('p', { class: 'mid-warn' }, 'Conditions, allergies and blood group are not filled in yet. The household owner can add them in Settings, under “For an emergency”.') : null,
    el('dl', { class: 'mid-grid' },
      row('Allergies', med.allergies || 'None known', med.allergies ? 'mid-alert' : ''),
      row('Conditions', med.conditions),
      row('Blood group', med.bloodGroup),
      row('Speaks', langs),
      row('Please note', needs.join('. ')),
      row('Lives at', [e.home, e.city].filter(Boolean).join(', ')),
      row('Other notes', med.notes)),
    el('h2', {}, 'Medicines'),
    care.medications === null
      ? el('p', {}, 'Sign in with a family account to list the medicines here.')
      : care.medications.length
      ? el('table', { class: 'mid-meds' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Medicine'), el('th', { scope: 'col' }, 'For'), el('th', { scope: 'col' }, 'When'), el('th', { scope: 'col' }, 'Looks like'))),
        el('tbody', {}, ...care.medications.map((m) => el('tr', {}, el('td', {}, m.name ?? ''), el('td', {}, m.purpose ?? ''), el('td', {}, timesOf(m)), el('td', {}, m.description ?? '')))))
      : el('p', {}, 'No regular medicines recorded.'),
    el('h2', {}, 'Who to call'),
    el('dl', { class: 'mid-grid' },
      row('Emergency number', e.emergencyNumber),
      row('Family', [med.familyPhone, family.map((p) => `${p.name}${p.relationship ? ` (${p.relationship})` : ''}`).join(', ')].filter(Boolean).join(' · ')),
      row('Doctor', [med.doctor, med.doctorPhone].filter(Boolean).join(' · ')),
      row('Pharmacy', [e.pharmacy?.name, e.pharmacy?.phone].filter(Boolean).join(' · ')),
      row('Neighbour', neighbour?.name)),
    el('p', { class: 'mid-foot' }, `Printed from Saathi on ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}. Medicines change: print a fresh card after any change.`),
  ].filter(Boolean));
}

load().catch((err) => card.replaceChildren(el('p', { class: 'form-error', role: 'alert' }, err.message)));
