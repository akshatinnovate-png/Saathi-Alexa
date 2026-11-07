import { el } from './common.js';

const KIND = {
  'remote-access': 'Someone tried to control the computer from far away',
  'remote-payment': 'A payment while someone controlled the computer',
  'otp-page': 'A page asking for an OTP, PIN or card number',
  'tech-support': 'A fake "your computer is infected" warning',
  'gift-card': 'A request to pay with gift cards or crypto',
  'digital-arrest': 'A fake police or officer video call ("digital arrest")',
  tamper: 'Someone tried to switch off Sahay or Saathi',
  other: 'A possible scam',
};

const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function holdText(i) {
  if (i.hold.decision === 'approve') return 'Unblocked: the family said it is safe.';
  if (Date.parse(i.hold.until) <= Date.now()) return 'The block has ended.';
  return `Blocked until ${when(i.hold.until)}${i.hold.decision === 'keep' ? ' (kept blocked by the family)' : ''}.`;
}

function card(i, reload) {
  const status = el('p', { class: 'sg-status', role: 'status' }, holdText(i));
  const decide = async (decision) => {
    status.textContent = '…';
    const res = await fetch(`/api/scam-guard/incidents/${encodeURIComponent(i.id)}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
    if (!res.ok) { status.textContent = (await res.json().catch(() => ({}))).error ?? 'That did not work. Try again.'; return; }
    reload();
  };
  const open = i.hold.decision !== 'approve' && Date.parse(i.hold.until) > Date.now();
  return el('article', { class: 'sg-card', id: i.id, 'aria-labelledby': `t-${i.id}` },
    el('span', { class: `sg-badge ${i.severity}` }, i.moneyAtRisk ? 'Money may be at risk' : 'Stopped'),
    el('h2', { id: `t-${i.id}` }, i.title || KIND[i.kind] || KIND.other),
    el('p', { class: 'sg-muted' }, `${KIND[i.kind] ?? KIND.other} · ${when(i.createdAt)}`),
    i.screenshot ? el('img', { class: 'sg-shot', src: i.screenshot, alt: `What the screen showed. Private numbers are blacked out. ${i.why.join('. ')}` }) : null,
    i.explain ? el('p', {}, i.explain) : null,
    i.why.length ? el('div', {}, el('h3', {}, 'Warning signs'), el('ul', {}, ...i.why.map((w) => el('li', {}, w)))) : null,
    i.how.length ? el('div', {}, el('h3', {}, 'How this scam works'), el('ol', {}, ...i.how.map((w) => el('li', {}, w)))) : null,
    i.actions.length ? el('div', {}, el('h3', {}, 'What Sahay did'), el('ul', {}, ...i.actions.map((w) => el('li', {}, w)))) : null,
    i.moneyAtRisk ? el('p', {}, 'If any money or bank details were shared: call the bank now to freeze the account, call 1930 (cyber fraud helpline) within the first hour, and report it on cybercrime.gov.in.') : null,
    status,
    open ? el('div', { class: 'sg-actions' },
      el('button', { class: 'sg-keep', type: 'button', onclick: () => decide('keep') }, 'Keep it blocked'),
      el('button', { class: 'sg-safe', type: 'button', onclick: () => decide('approve') }, "It's safe, unblock")) : null);
}

async function load() {
  const root = document.getElementById('incidents');
  try {
    const res = await fetch('/api/scam-guard/incidents');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not load.');
    const { incidents } = await res.json();
    root.replaceChildren(...(incidents.length ? incidents.map((i) => card(i, load)) : [el('p', { class: 'sg-muted' }, 'Nothing has been stopped. Sahay is watching for scams on the computer.')]));
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  } catch (err) {
    root.replaceChildren(el('p', { class: 'sg-muted' }, err.message));
  }
}

load();
