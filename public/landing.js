import { createHalftone } from './halftone.js';

const SLIDES = [
  { src: 'assets/slides/teton-moonset.webp', title: 'Moonset over the Teton Range', place: 'Wyoming, United States' },
  { src: 'assets/slides/forest-river.webp', title: 'A forest river after spring rain', place: 'Old-growth woodland' },
  { src: 'assets/slides/waterfall.webp', title: 'Ouzoud Falls in the morning sun', place: 'Azilal, Morocco' },
  { src: 'assets/slides/fjord.webp', title: 'A house at the edge of the fjord', place: 'Lofoten, Norway' },
];
const INTERVAL = 8000;
const LOGO_AT = 3000;
const OPEN_AT = 5200;

const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function storage(kind) {
  try { return window[kind]; } catch { return null; }
}

function setupSlides() {
  const holder = $('slides');
  const dots = $('slide-dots');
  let index = Math.floor(Date.now() / 86400000) % SLIDES.length;
  let timer;
  let paused = reduced;

  const layers = SLIDES.map((s) => {
    const layer = document.createElement('div');
    layer.className = 'slide';
    layer.style.backgroundImage = `url("${s.src}")`;
    holder.append(layer);
    return layer;
  });
  const buttons = SLIDES.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Show image ${i + 1}: ${s.title}`);
    b.addEventListener('click', () => { show(i); restart(); });
    dots.append(b);
    return b;
  });

  function show(i) {
    index = (i + SLIDES.length) % SLIDES.length;
    layers.forEach((l, j) => l.classList.toggle('active', j === index));
    buttons.forEach((b, j) => b.setAttribute('aria-current', String(j === index)));
    $('caption-title').textContent = SLIDES[index].title;
    $('caption-place').textContent = SLIDES[index].place;
    const next = new Image();
    next.src = SLIDES[(index + 1) % SLIDES.length].src;
  }
  function restart() {
    clearInterval(timer);
    if (!paused) timer = setInterval(() => show(index + 1), INTERVAL);
  }
  $('slide-prev').addEventListener('click', () => { show(index - 1); restart(); });
  $('slide-next').addEventListener('click', () => { show(index + 1); restart(); });
  const pause = $('slide-pause');
  const syncPause = () => {
    pause.setAttribute('aria-pressed', String(paused));
    pause.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
    pause.innerHTML = paused
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  };
  pause.addEventListener('click', () => { paused = !paused; syncPause(); restart(); });
  syncPause();
  show(index);
  restart();
}

function playIntro() {
  const intro = $('intro');
  const video = $('intro-video');
  const session = storage('sessionStorage');
  const force = new URLSearchParams(location.search).has('intro');
  if (!force && session?.getItem('saathi-intro-seen')) {
    intro.remove();
    return;
  }
  session?.setItem('saathi-intro-seen', '1');

  const dots = createHalftone($('intro-dots'), { spacing: 9, radius: 1.2, inner: 0.55, outer: 1.12 });
  let finished = false;
  const timers = [];
  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    intro.classList.add('done');
    setTimeout(() => { dots.stop(); intro.remove(); }, 1000);
    $('ask-input').focus({ preventScroll: true });
  };

  if (reduced) {
    intro.classList.add('logo-in');
    timers.push(setTimeout(finish, 1600));
  } else {
    video.play().catch(() => {});
    requestAnimationFrame(() => intro.classList.add('playing'));
    timers.push(setTimeout(() => { intro.classList.add('logo-in'); dots.setLevel(0.55); }, LOGO_AT));
    timers.push(setTimeout(finish, OPEN_AT));
  }
  $('intro-skip').addEventListener('click', finish);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(); }, { once: true });
}

function setupAsk() {
  const go = (q) => { location.href = `/family.html?ask=${encodeURIComponent(q)}#assistant`; };
  $('ask').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('ask-input').value.trim();
    if (q) go(q);
  });
  document.querySelectorAll('.ask-chips button').forEach((b) => b.addEventListener('click', () => go(b.dataset.q)));
}

async function setupSession() {
  try {
    const res = await fetch('/api/session');
    if (!res.ok) return;
    const s = await res.json();
    if (s.user) {
      const link = $('signin');
      link.textContent = 'Open dashboard';
      link.href = '/family.html';
    }
  } catch { }
}

setupSlides();
createHalftone($('landing-dots'), { spacing: 10, radius: 1, inner: 0.62, outer: 1.18, animate: false });
setupAsk();
setupSession();
playIntro();
