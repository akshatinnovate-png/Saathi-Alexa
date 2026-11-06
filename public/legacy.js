import { el } from './common.js';

const NAMES = { en: 'English', hi: 'हिंदी', mr: 'मराठी', ta: 'தமிழ்', bn: 'বাংলা', es: 'Español', fr: 'Français', ar: 'العربية' };
let book;

function render(lang) {
  const root = document.getElementById('book');
  const chapters = book.chapters.map((c) => {
    const version = c.translations?.[lang]?.text ?? c.text;
    const audio = c.audio?.[lang] ?? c.audio?.[c.language];
    return el('article', { class: 'lg-chapter', 'aria-labelledby': `c-${c.id}` },
      el('div', { class: 'lg-mark', 'aria-hidden': 'true' }),
      el('p', { class: 'lg-num' }, `Chapter ${c.number} · ${new Date(c.createdAt).toLocaleDateString([], { dateStyle: 'long' })}`),
      el('h2', { id: `c-${c.id}` }, c.title),
      el('p', { class: 'lg-text', lang }, version),
      audio ? el('audio', { controls: '', preload: 'none', src: audio, 'aria-label': `Hear ${book.elder.preferredName} tell it` }) : null);
  });
  root.replaceChildren(
    el('section', { class: 'lg-cover' },
      el('h1', {}, `${book.elder.preferredName}'s stories`),
      el('p', {}, `${book.chapters.length} ${book.chapters.length === 1 ? 'story' : 'stories'}, told to Saathi${book.elder.city ? ` in ${book.elder.city}` : ''}, for everyone in the family.`)),
    ...(chapters.length ? chapters : [el('p', { class: 'lg-empty' }, `No stories yet. When ${book.elder.preferredName} tells Saathi a story, it becomes a chapter here.`)]));
}

async function load() {
  try {
    const res = await fetch('/api/family/legacy');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The book could not be opened.');
    book = await res.json();
    const select = document.getElementById('lang');
    select.replaceChildren(...book.languages.map((l) => el('option', { value: l }, NAMES[l] ?? l)));
    select.addEventListener('change', () => render(select.value));
    document.title = `${book.elder.preferredName}'s stories · Saathi`;
    render(select.value);
  } catch (err) {
    document.getElementById('book').replaceChildren(el('p', { class: 'lg-empty' }, err.message));
  }
}

document.getElementById('print').addEventListener('click', () => window.print());
load();
