import { el } from './common.js';

const T = {
  en: {
    language: 'Language', welcome: 'Become a Saathi Didi', pitch: 'Earn by caring for elders in your own neighbourhood: take them to the doctor, visit, pick up their tablets or help with the phone. You set your own fee and are paid straight to your UPI.',
    name: 'Your name', phone: 'Mobile number', city: 'Town or city', area: 'Your neighbourhood (for example: Kothrud, near Karve Road)', speaks: 'Languages you speak', offer: 'Help you offer and your fee (₹)', upi: 'UPI ID for payments (optional)', partner: 'Partner code from your SHG or NGO (optional)',
    join: 'Join', hello: 'Namaste', verified: 'Verified', notVerified: 'Waiting for verification by a partner group', ready: 'Ready for bookings', lessons: 'Three short lessons', lessonsWhy: 'Finish these before your first booking.',
    check: 'Check my answer', right: 'Correct.', wrong: 'Not quite. Read it once more.', offers: 'New requests near you', none: 'Nothing right now. We will show new requests here.', accept: 'Accept',
    mine: 'My bookings', briefing: 'Read the briefing', checkIn: 'I have arrived', checkOut: 'Finish visit', note: 'How did it go? (the family will read this)', earnings: 'This month',
    visits: 'Visits', earned: 'Earned', paid: 'Paid', rating: 'Rating', saveLink: 'Save this link. Open it to sign in on another phone. Do not share it.', copy: 'Copy link', logout: 'Sign out', fee: 'Fee',
    status: { open: 'Open', offered: 'Offered to you', accepted: 'Accepted', 'in-progress': 'Visiting now', done: 'Done', cancelled: 'Cancelled' },
    kinds: { escort: 'Doctor escort', visit: 'Company visit', refill: 'Tablet refill', tech: 'Help with phone and forms' },
  },
  hi: {
    language: 'भाषा', welcome: 'साथी दीदी बनिए', pitch: 'अपने ही मोहल्ले में बुज़ुर्गों की देखभाल करके कमाइए: डॉक्टर के पास ले जाना, मिलने जाना, दवाएँ लाना या फ़ोन में मदद। फ़ीस आप तय करती हैं, पैसे सीधे आपके UPI में।',
    name: 'आपका नाम', phone: 'मोबाइल नंबर', city: 'शहर या कस्बा', area: 'आपका मोहल्ला (जैसे: कोथरूड, कर्वे रोड के पास)', speaks: 'आप कौन-सी भाषाएँ बोलती हैं', offer: 'आप कौन-सी मदद देती हैं और फ़ीस (₹)', upi: 'भुगतान के लिए UPI ID (वैकल्पिक)', partner: 'आपके SHG या NGO का पार्टनर कोड (वैकल्पिक)',
    join: 'जुड़िए', hello: 'नमस्ते', verified: 'सत्यापित', notVerified: 'पार्टनर समूह से सत्यापन बाकी है', ready: 'बुकिंग के लिए तैयार', lessons: 'तीन छोटे पाठ', lessonsWhy: 'पहली बुकिंग से पहले इन्हें पूरा कीजिए।',
    check: 'जवाब जाँचें', right: 'सही।', wrong: 'थोड़ा और पढ़िए।', offers: 'आपके पास नए अनुरोध', none: 'अभी कुछ नहीं। नए अनुरोध यहाँ दिखेंगे।', accept: 'स्वीकार करें',
    mine: 'मेरी बुकिंग', briefing: 'जानकारी पढ़ें', checkIn: 'मैं पहुँच गई', checkOut: 'विज़िट पूरी करें', note: 'कैसा रहा? (परिवार यह पढ़ेगा)', earnings: 'इस महीने',
    visits: 'विज़िट', earned: 'कमाई', paid: 'मिला', rating: 'रेटिंग', saveLink: 'यह लिंक सँभालकर रखिए। दूसरे फ़ोन पर साइन इन के लिए इसे खोलिए। किसी को न दें।', copy: 'लिंक कॉपी करें', logout: 'साइन आउट', fee: 'फ़ीस',
    status: { open: 'खुला', offered: 'आपको भेजा गया', accepted: 'स्वीकार', 'in-progress': 'अभी विज़िट पर', done: 'पूरा', cancelled: 'रद्द' },
    kinds: { escort: 'डॉक्टर के पास साथ', visit: 'मिलने जाना', refill: 'दवा लाना', tech: 'फ़ोन और फ़ॉर्म में मदद' },
  },
  mr: {
    language: 'भाषा', welcome: 'साथी दीदी व्हा', pitch: 'आपल्याच परिसरात वृद्धांची काळजी घेऊन कमवा: डॉक्टरकडे नेणं, भेटायला जाणं, गोळ्या आणणं किंवा फोनमध्ये मदत. फी तुम्ही ठरवता, पैसे थेट तुमच्या UPI मध्ये.',
    name: 'तुमचं नाव', phone: 'मोबाइल नंबर', city: 'गाव किंवा शहर', area: 'तुमचा परिसर (उदा. कोथरूड, कर्वे रोडजवळ)', speaks: 'तुम्ही कोणत्या भाषा बोलता', offer: 'तुम्ही देत असलेली मदत आणि फी (₹)', upi: 'पैशांसाठी UPI ID (ऐच्छिक)', partner: 'तुमच्या बचत गट किंवा NGO चा पार्टनर कोड (ऐच्छिक)',
    join: 'सामील व्हा', hello: 'नमस्कार', verified: 'पडताळणी झाली', notVerified: 'पार्टनर गटाकडून पडताळणी बाकी', ready: 'बुकिंगसाठी तयार', lessons: 'तीन छोटे धडे', lessonsWhy: 'पहिल्या बुकिंगपूर्वी हे पूर्ण करा.',
    check: 'उत्तर तपासा', right: 'बरोबर.', wrong: 'अजून एकदा वाचा.', offers: 'तुमच्या जवळच्या नव्या विनंत्या', none: 'आत्ता काही नाही. नव्या विनंत्या इथे दिसतील.', accept: 'स्वीकारा',
    mine: 'माझी बुकिंग', briefing: 'माहिती वाचा', checkIn: 'मी पोहोचले', checkOut: 'भेट पूर्ण करा', note: 'कसं झालं? (घरचे हे वाचतील)', earnings: 'या महिन्यात',
    visits: 'भेटी', earned: 'कमाई', paid: 'मिळाले', rating: 'रेटिंग', saveLink: 'ही लिंक जपून ठेवा. दुसऱ्या फोनवर साइन इन करायला ती उघडा. कोणालाही देऊ नका.', copy: 'लिंक कॉपी करा', logout: 'साइन आउट', fee: 'फी',
    status: { open: 'खुली', offered: 'तुम्हाला पाठवली', accepted: 'स्वीकारली', 'in-progress': 'आत्ता भेटीत', done: 'पूर्ण', cancelled: 'रद्द' },
    kinds: { escort: 'डॉक्टरकडे सोबत', visit: 'भेटायला जाणं', refill: 'गोळ्या आणणं', tech: 'फोन आणि फॉर्ममध्ये मदत' },
  },
};

const KINDS = ['escort', 'visit', 'refill', 'tech'];
const app = document.getElementById('app');
const langSelect = document.getElementById('lang');
let lang = (() => { try { return localStorage.getItem('saathi-didi-lang'); } catch { return null; } })() ?? (navigator.language?.startsWith('mr') ? 'mr' : navigator.language?.startsWith('hi') ? 'hi' : 'en');
let savedLink = null;
const t = () => T[lang] ?? T.en;
const when = (at) => new Date(at).toLocaleString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { dateStyle: 'medium', timeStyle: 'short' });

async function call(path, body) {
  const res = await fetch(`/didi-api${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? res.statusText), { status: res.status });
  return data;
}

function setLang(next) {
  lang = T[next] ? next : 'en';
  langSelect.value = lang;
  document.documentElement.lang = lang;
  document.getElementById('lang-label').textContent = t().language;
  try { localStorage.setItem('saathi-didi-lang', lang); } catch { }
}

function signUpView() {
  const s = t();
  const error = el('p', { class: 'dd-error', role: 'alert' });
  const field = (label, attrs) => el('label', {}, label, el('input', attrs));
  const skills = KINDS.map((k) => el('div', { class: 'dd-skill' },
    el('label', { class: 'dd-check' }, el('input', { type: 'checkbox', name: 'skill', value: k }), s.kinds[k]),
    el('input', { type: 'number', name: `rate-${k}`, min: '0', step: '10', inputmode: 'numeric', 'aria-label': `${s.fee}: ${s.kinds[k]}` })));
  const form = el('form', { class: 'dd-form' },
    field(s.name, { name: 'name', required: true, autocomplete: 'name' }),
    field(s.phone, { name: 'phone', required: true, type: 'tel', autocomplete: 'tel', inputmode: 'tel' }),
    field(s.city, { name: 'city', required: true, autocomplete: 'address-level2' }),
    field(s.area, { name: 'area', autocomplete: 'address-level3' }),
    el('fieldset', {}, el('legend', {}, s.speaks), ...['mr', 'hi', 'en'].map((l) => el('label', { class: 'dd-check' }, el('input', { type: 'checkbox', name: 'language', value: l, checked: l === lang }), { en: 'English', hi: 'हिन्दी', mr: 'मराठी' }[l]))),
    el('fieldset', {}, el('legend', {}, s.offer), ...skills),
    field(s.upi, { name: 'upiId', autocomplete: 'off', placeholder: 'name@bank' }),
    field(s.partner, { name: 'partnerCode', autocomplete: 'off' }),
    error,
    el('button', { class: 'dd-btn', type: 'submit' }, s.join));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const chosen = f.getAll('skill');
    try {
      const out = await call('/signup', {
        name: f.get('name'), phone: f.get('phone'), city: f.get('city'), area: f.get('area'), languages: f.getAll('language'), skills: chosen,
        rates: Object.fromEntries(chosen.map((k) => [k, Number(f.get(`rate-${k}`))])), upiId: f.get('upiId'), partnerCode: f.get('partnerCode'),
      });
      savedLink = `${location.origin}${out.link}`;
      render();
    } catch (err) { error.textContent = err.message; }
  });
  return [el('section', { class: 'dd-card', 'aria-labelledby': 'join-title' }, el('h1', { id: 'join-title' }, s.welcome), el('p', { class: 'dd-muted' }, s.pitch), form)];
}

function lessonCard(lesson, done, refresh) {
  const s = t();
  const out = el('p', { role: 'status' }, done ? s.right : '');
  const name = `q-${lesson.id}`;
  const form = el('form', { class: 'dd-form' },
    el('fieldset', {}, el('legend', {}, lesson.question), ...lesson.options.map((o, i) => el('label', { class: 'dd-check' }, el('input', { type: 'radio', name, value: String(i), required: true }), o))),
    out, done ? null : el('button', { class: 'dd-btn soft', type: 'submit' }, s.check));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await call(`/lessons/${lesson.id}`, { answer: Number(new FormData(form).get(name)) });
    out.textContent = r.correct ? s.right : s.wrong;
    if (r.correct) setTimeout(refresh, 600);
  });
  return el('article', { class: 'dd-card' }, el('h3', {}, `${done ? '✓ ' : ''}${lesson.title}`), el('p', {}, lesson.text), form);
}

function bookingCard(b, refresh) {
  const s = t();
  const msg = el('p', { class: 'dd-error', role: 'alert' });
  const brief = el('pre', { class: 'dd-brief', hidden: true });
  const act = (fn) => async () => { msg.textContent = ''; try { await fn(); } catch (err) { msg.textContent = err.message; } };
  const actions = el('div', { class: 'dd-actions' });
  if (['open', 'offered'].includes(b.status)) actions.append(el('button', { class: 'dd-btn go', type: 'button', onclick: act(async () => { await call(`/bookings/${b.id}/accept`, {}); refresh(); }) }, s.accept));
  if (['accepted', 'in-progress', 'done'].includes(b.status)) actions.append(el('button', { class: 'dd-btn soft', type: 'button', onclick: act(async () => {
    const r = await call(`/bookings/${b.id}/briefing`);
    brief.textContent = r.text;
    brief.hidden = false;
  }) }, s.briefing));
  if (b.status === 'accepted') actions.append(el('button', { class: 'dd-btn go', type: 'button', onclick: act(async () => { await call(`/bookings/${b.id}/check-in`, {}); refresh(); }) }, s.checkIn));
  let finish = null;
  if (b.status === 'in-progress') {
    const note = el('textarea', { name: 'note', rows: '3', maxlength: '600' });
    finish = el('form', { class: 'dd-form' }, el('label', {}, s.note, note), el('button', { class: 'dd-btn go', type: 'submit' }, s.checkOut));
    finish.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await call(`/bookings/${b.id}/check-out`, { note: note.value, language: lang }); refresh(); })(); });
  }
  return el('article', { class: 'dd-card' },
    el('span', { class: `dd-badge ${b.status === 'done' ? 'ok' : ''}` }, s.status[b.status] ?? b.status),
    el('h3', {}, `${s.kinds[b.kind] ?? b.kindName} · ${when(b.at)}`),
    el('p', { class: 'dd-muted' }, [b.city, b.fee ? `${s.fee}: ₹${b.fee}` : null, b.paidAt ? `${s.paid} ✓` : null].filter(Boolean).join(' · ')),
    b.notes ? el('p', {}, b.notes) : null, brief, actions, finish, msg);
}

async function dashboard(me) {
  const s = t();
  const refresh = () => render();
  const parts = [];
  if (savedLink) {
    const copy = el('button', { class: 'dd-btn soft', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(savedLink); copy.textContent = '✓'; } catch { } } }, s.copy);
    parts.push(el('section', { class: 'dd-card' }, el('p', {}, s.saveLink), el('p', { class: 'dd-link' }, savedLink), el('div', { class: 'dd-actions' }, copy)));
  }
  parts.push(el('section', { class: 'dd-card', 'aria-labelledby': 'hello' },
    el('h1', { id: 'hello' }, `${s.hello}, ${me.name}`),
    el('span', { class: `dd-badge ${me.verified ? 'ok' : ''}` }, me.verified ? s.verified : s.notVerified),
    me.ready ? el('span', { class: 'dd-badge ok' }, s.ready) : null,
    el('p', { class: 'dd-muted' }, `${me.city} · ${me.skills.map((k) => `${s.kinds[k]} ₹${me.rates[k]}`).join(' · ')}`)));
  const { lessons } = await call(`/lessons?language=${lang}`);
  if (lessons.some((l) => !me.lessonsDone.includes(l.id))) {
    parts.push(el('section', { class: 'dd-card', 'aria-labelledby': 'lessons' }, el('h2', { id: 'lessons' }, s.lessons), el('p', { class: 'dd-muted' }, s.lessonsWhy)));
    for (const l of lessons) parts.push(lessonCard(l, me.lessonsDone.includes(l.id), refresh));
  }
  const [{ offers }, { bookings }, money] = await Promise.all([call('/offers'), call('/bookings'), call('/earnings')]);
  if (me.ready) {
    parts.push(el('h2', { class: 'dd-section' }, s.offers));
    parts.push(...(offers.length ? offers.map((b) => bookingCard(b, refresh)) : [el('p', { class: 'dd-muted' }, s.none)]));
  }
  if (bookings.length) {
    parts.push(el('h2', { class: 'dd-section' }, s.mine));
    parts.push(...bookings.map((b) => bookingCard(b, refresh)));
  }
  parts.push(el('section', { class: 'dd-card', 'aria-labelledby': 'money' }, el('h2', { id: 'money' }, s.earnings),
    el('div', { class: 'dd-stats' },
      el('div', { class: 'dd-stat' }, el('b', {}, money.visits), s.visits),
      el('div', { class: 'dd-stat' }, el('b', {}, `₹${money.earned}`), s.earned),
      el('div', { class: 'dd-stat' }, el('b', {}, `₹${money.paid}`), s.paid),
      el('div', { class: 'dd-stat' }, el('b', {}, money.rating ?? '–'), s.rating)),
    el('div', { class: 'dd-actions' }, el('button', { class: 'dd-btn soft', type: 'button', onclick: async () => { await call('/logout', {}); savedLink = null; render(); } }, s.logout))));
  return parts;
}

async function render() {
  let parts;
  try {
    const me = await call('/me');
    parts = await dashboard(me);
  } catch (err) {
    parts = err.status === 401 ? signUpView() : [el('p', { class: 'dd-error', role: 'alert' }, err.message)];
  }
  app.replaceChildren(...parts);
}

async function start() {
  setLang(lang);
  langSelect.addEventListener('change', () => { setLang(langSelect.value); render(); });
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  if (key) {
    history.replaceState(null, '', location.pathname);
    try { await call('/login', { key }); } catch { }
  }
  render();
}

start();
