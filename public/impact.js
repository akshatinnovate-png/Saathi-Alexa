import { el } from './common.js';

const n = (v) => Number(v ?? 0).toLocaleString('en-IN');
const rupees = (v) => `₹${n(v)}`;
const plural = (v, one, many) => `${n(v)} ${Number(v) === 1 ? one : many}`;
const stat = (value, label, note) => el('div', { class: 'im-stat' }, el('b', {}, value), el('span', {}, label), note ? el('small', {}, note) : null);
const SVG = 'http://www.w3.org/2000/svg';

function chart(rows) {
  if (!rows.length) return el('p', { class: 'im-muted' }, 'The first Didi visits will appear here.');
  const max = Math.max(...rows.map((r) => r.earned), 1);
  const w = 640;
  const h = 220;
  const bw = Math.min(64, (w - 40) / rows.length - 12);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h + 40}`);
  svg.setAttribute('class', 'im-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Money earned by Saathi Didis each month: ${rows.map((r) => `${r.month} ${rupees(r.earned)} from ${r.visits} visits`).join('; ')}`);
  rows.forEach((r, i) => {
    const x = 30 + i * (bw + 12);
    const bh = Math.round((r.earned / max) * (h - 30));
    const bar = document.createElementNS(SVG, 'rect');
    Object.entries({ x, y: h - bh, width: bw, height: bh, rx: 6, class: 'im-bar' }).forEach(([k, v]) => bar.setAttribute(k, v));
    const label = document.createElementNS(SVG, 'text');
    Object.entries({ x: x + bw / 2, y: h + 24, 'text-anchor': 'middle', class: 'im-axis' }).forEach(([k, v]) => label.setAttribute(k, v));
    label.textContent = new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
    const value = document.createElementNS(SVG, 'text');
    Object.entries({ x: x + bw / 2, y: h - bh - 8, 'text-anchor': 'middle', class: 'im-value' }).forEach(([k, v]) => value.setAttribute(k, v));
    value.textContent = rupees(r.earned);
    svg.append(bar, label, value);
  });
  return svg;
}

async function load() {
  const main = document.getElementById('impact');
  try {
    const res = await fetch('/impact-api');
    if (!res.ok) throw new Error();
    const d = await res.json();
    const helpRate = d.safety.helpRequests ? Math.round((d.safety.helpAnswered / d.safety.helpRequests) * 100) : null;
    main.replaceChildren(
      el('section', { class: 'im-hero', 'aria-labelledby': 'elders' }, el('h2', { id: 'elders' }, el('b', {}, n(d.elders)), d.elders === 1 ? ' elder looked after by Saathi' : ' elders looked after by Saathi')),
      el('section', { class: 'im-card', 'aria-labelledby': 'care' }, el('h2', { id: 'care' }, 'Care, every day'),
        el('div', { class: 'im-grid' },
          stat(n(d.care.tabletsConfirmed), 'tablets confirmed'),
          stat(n(d.care.missedDosesCaught), 'missed doses caught', 'the family was told the same day'),
          stat(n(d.care.checkIns), 'check-ins'),
          stat(n(d.care.lowMoodNudges), 'low days noticed', 'a gentle nudge to call'),
          stat(n(d.care.messages), 'family messages, translated'),
          stat(n(d.care.stories), 'life stories saved'))),
      el('section', { class: 'im-card', 'aria-labelledby': 'safety' }, el('h2', { id: 'safety' }, 'Safety'),
        el('div', { class: 'im-grid' },
          stat(n(d.safety.helpRequests), 'calls for help'),
          stat(helpRate === null ? '–' : `${helpRate}%`, 'answered by family or a neighbour'),
          stat(n(d.safety.scamsStopped), 'scams stopped or warned'))),
      el('section', { class: 'im-card', 'aria-labelledby': 'didis' }, el('h2', { id: 'didis' }, 'Saathi Didis: care that pays'),
        el('div', { class: 'im-grid' },
          stat(n(d.didis.verified), 'verified Didis', `${n(d.didis.signedUp)} signed up`),
          stat(n(d.didis.visits), 'visits completed'),
          stat(rupees(d.didis.earned), 'earned by Didis', `${rupees(d.didis.paid)} already paid, straight to their UPI`),
          stat(d.didis.rating ? `★ ${d.didis.rating}` : '–', 'average rating from families'),
          stat(rupees(d.didis.thisMonth.earned), 'earned this month', plural(d.didis.thisMonth.visits, 'visit', 'visits'))),
        el('h3', {}, 'Earned by Didis, month by month'), chart(d.didis.byMonth)),
      el('p', { class: 'im-muted' }, `Updated ${new Date(d.updatedAt).toLocaleString('en-IN')}. Every care event also streams to BigQuery for deeper analysis.`),
    );
  } catch {
    main.replaceChildren(el('p', { class: 'im-muted' }, 'The numbers are not available right now.'));
  }
}

load();
setInterval(load, 60_000);
