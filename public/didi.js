import { el } from './common.js';
import { startPhoneSignIn, enablePush } from './firebase-web.js';

const T = {
  en: {
    docRecord: "Record the doctor's advice", docConsent: 'The doctor agreed to the recording', docStop: 'Stop and send to the family', docSent: 'Sent. The family has the notes.', host: 'Host a chai circle', hostWhy: 'A daily 30-minute Google Meet call for 5 to 8 elders near you. Families pay you each month.', title: 'Circle name', time: 'Time', meet: 'Google Meet link', circleFee: 'Monthly fee per elder (₹)', create: 'Start the circle', members: 'members', monthly: 'This month from circles', topic: "Today's topic",
    sosBtn: 'SOS: I need help', sosConfirm: 'Send an SOS to the family now?', sosSent: 'SOS sent. The family has been told. Call now:', record: 'Record a voice note', stop: 'Stop and write it down', listening: 'Recording… speak now', heard: 'Check the note, then finish the visit.', rateFamily: 'How was this family?', unsafe: 'I do not want visits from this family again', send: 'Send', thanks: 'Thank you.', safety: 'Safety contact (someone from your group who should know if you press SOS)', contactName: 'Their name', contactPhone: 'Their mobile number', save: 'Save', saved: 'Saved.', card: 'My Saathi card', share: 'Share on WhatsApp', download: 'Download', notify: 'Get new requests as notifications', notifyOn: 'Notifications are on.', phoneTitle: 'Already a Didi, or want to join with just your phone?', sendCode: 'Send me a code', code: 'The 6-digit code from the SMS', verify: 'Sign in', phoneOk: 'Your number is verified. Fill in the rest below.', or: 'Or join with the form below', familyStars: 'Family rating',
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
    docRecord: 'डॉक्टर की सलाह रिकॉर्ड करें', docConsent: 'डॉक्टर ने रिकॉर्डिंग की अनुमति दी', docStop: 'रोकें और परिवार को भेजें', docSent: 'भेज दिया। परिवार के पास नोट्स हैं।', host: 'चाय मंडली चलाइए', hostWhy: 'आपके पास के 5 से 8 बुज़ुर्गों के लिए रोज़ 30 मिनट की Google Meet कॉल। परिवार हर महीने आपको भुगतान करते हैं।', title: 'मंडली का नाम', time: 'समय', meet: 'Google Meet लिंक', circleFee: 'हर बुज़ुर्ग की मासिक फ़ीस (₹)', create: 'मंडली शुरू करें', members: 'सदस्य', monthly: 'इस महीने मंडलियों से', topic: 'आज का विषय',
    sosBtn: 'SOS: मुझे मदद चाहिए', sosConfirm: 'क्या परिवार को अभी SOS भेजें?', sosSent: 'SOS भेज दिया। परिवार को बता दिया गया है। अभी कॉल करें:', record: 'आवाज़ में नोट रिकॉर्ड करें', stop: 'रोकें और लिख दें', listening: 'रिकॉर्ड हो रहा है… अब बोलिए', heard: 'नोट देख लीजिए, फिर विज़िट पूरी कीजिए।', rateFamily: 'यह परिवार कैसा था?', unsafe: 'मैं इस परिवार के यहाँ फिर नहीं जाना चाहती', send: 'भेजें', thanks: 'धन्यवाद।', safety: 'सुरक्षा संपर्क (आपके समूह का कोई व्यक्ति जिसे SOS पर पता चलना चाहिए)', contactName: 'उनका नाम', contactPhone: 'उनका मोबाइल नंबर', save: 'सहेजें', saved: 'सहेज लिया।', card: 'मेरा साथी कार्ड', share: 'WhatsApp पर भेजें', download: 'डाउनलोड करें', notify: 'नए अनुरोध नोटिफ़िकेशन में पाएँ', notifyOn: 'नोटिफ़िकेशन चालू हैं।', phoneTitle: 'पहले से दीदी हैं, या सिर्फ़ फ़ोन से जुड़ना है?', sendCode: 'मुझे कोड भेजें', code: 'SMS में आया 6 अंकों का कोड', verify: 'साइन इन करें', phoneOk: 'आपका नंबर सत्यापित है। बाकी नीचे भरिए।', or: 'या नीचे दिए फ़ॉर्म से जुड़िए', familyStars: 'परिवार की रेटिंग',
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
    docRecord: 'डॉक्टरांचा सल्ला रेकॉर्ड करा', docConsent: 'डॉक्टरांनी रेकॉर्डिंगला परवानगी दिली', docStop: 'थांबवा आणि घरच्यांना पाठवा', docSent: 'पाठवलं. घरच्यांकडे नोंदी आहेत.', host: 'चहा मंडळ चालवा', hostWhy: 'तुमच्या जवळच्या 5 ते 8 वृद्धांसाठी रोज 30 मिनिटांची Google Meet कॉल. घरचे दर महिन्याला तुम्हाला पैसे देतात.', title: 'मंडळाचं नाव', time: 'वेळ', meet: 'Google Meet लिंक', circleFee: 'प्रत्येक वृद्धाची मासिक फी (₹)', create: 'मंडळ सुरू करा', members: 'सदस्य', monthly: 'या महिन्यात मंडळांतून', topic: 'आजचा विषय',
    sosBtn: 'SOS: मला मदत हवी आहे', sosConfirm: 'घरच्यांना आत्ता SOS पाठवायचा?', sosSent: 'SOS पाठवला. घरच्यांना कळवलं आहे. आत्ता फोन करा:', record: 'आवाजात नोंद करा', stop: 'थांबवा आणि लिहून द्या', listening: 'रेकॉर्ड होत आहे… आता बोला', heard: 'नोंद तपासा, मग भेट पूर्ण करा.', rateFamily: 'हे कुटुंब कसं होतं?', unsafe: 'मला या कुटुंबाकडे पुन्हा जायचं नाही', send: 'पाठवा', thanks: 'धन्यवाद.', safety: 'सुरक्षा संपर्क (तुमच्या गटातील कोणी, ज्यांना SOS कळायला हवा)', contactName: 'त्यांचं नाव', contactPhone: 'त्यांचा मोबाइल नंबर', save: 'जतन करा', saved: 'जतन केलं.', card: 'माझं साथी कार्ड', share: 'WhatsApp वर पाठवा', download: 'डाउनलोड करा', notify: 'नव्या विनंत्या सूचनांमध्ये मिळवा', notifyOn: 'सूचना चालू आहेत.', phoneTitle: 'आधीच दीदी आहात, किंवा फक्त फोनने जोडायचं आहे?', sendCode: 'मला कोड पाठवा', code: 'SMS मधला 6 अंकी कोड', verify: 'साइन इन करा', phoneOk: 'तुमचा नंबर पडताळला आहे. बाकी खाली भरा.', or: 'किंवा खालच्या फॉर्मने जोडा', familyStars: 'कुटुंबाचं रेटिंग',
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
let cfg = { phoneSignIn: false, voiceNotes: false, push: false };
let phoneToken = null;
let verifiedPhone = null;
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
    field(s.phone, { name: 'phone', required: true, type: 'tel', autocomplete: 'tel', inputmode: 'tel', value: verifiedPhone ?? undefined, readonly: verifiedPhone ? true : undefined }),
    field(s.city, { name: 'city', required: true, autocomplete: 'address-level2' }),
    field(s.area, { name: 'area', autocomplete: 'address-level3' }),
    el('fieldset', {}, el('legend', {}, s.speaks), ...['mr', 'hi', 'en'].map((l) => el('label', { class: 'dd-check' }, el('input', { type: 'checkbox', name: 'language', value: l, checked: l === lang }), { en: 'English', hi: 'हिन्दी', mr: 'मराठी' }[l]))),
    el('fieldset', {}, el('legend', {}, s.offer), ...skills),
    field(s.upi, { name: 'upiId', autocomplete: 'off', placeholder: 'name@bank' }),
    field(s.partner, { name: 'partnerCode', autocomplete: 'off' }),
    el('fieldset', {}, el('legend', {}, s.safety), field(s.contactName, { name: 'contactName', autocomplete: 'off' }), field(s.contactPhone, { name: 'contactPhone', type: 'tel', inputmode: 'tel', autocomplete: 'off' })),
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
        safetyContact: { name: f.get('contactName'), phone: f.get('contactPhone') }, idToken: phoneToken,
      });
      savedLink = `${location.origin}${out.link}`;
      render();
    } catch (err) { error.textContent = err.message; }
  });
  return [
    ...(cfg.phoneSignIn && !verifiedPhone ? [phoneView()] : []),
    el('section', { class: 'dd-card', 'aria-labelledby': 'join-title' }, el('h1', { id: 'join-title' }, s.welcome), el('p', { class: 'dd-muted' }, verifiedPhone ? s.phoneOk : s.pitch), form),
  ];
}

function phoneView() {
  const s = t();
  const error = el('p', { class: 'dd-error', role: 'alert' });
  const phone = el('input', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', name: 'phone' });
  const code = el('input', { inputmode: 'numeric', autocomplete: 'one-time-code', name: 'code', maxlength: '6' });
  const codeRow = el('label', { hidden: true }, s.code, code);
  const sendBtn = el('button', { class: 'dd-btn soft', type: 'button', id: 'phone-send' }, s.sendCode);
  const verifyBtn = el('button', { class: 'dd-btn', type: 'button', hidden: true }, s.verify);
  let confirm = null;
  sendBtn.addEventListener('click', async () => {
    error.textContent = '';
    try { confirm = await startPhoneSignIn(phone.value, 'phone-send'); codeRow.hidden = false; verifyBtn.hidden = false; code.focus(); } catch (err) { error.textContent = err.message; }
  });
  verifyBtn.addEventListener('click', async () => {
    error.textContent = '';
    try {
      const idToken = await confirm(code.value.trim());
      const out = await call('/phone-login', { idToken });
      if (out.needsSignup) { phoneToken = idToken; verifiedPhone = out.phone; }
      render();
    } catch (err) { error.textContent = err.message; }
  });
  return el('section', { class: 'dd-card', 'aria-labelledby': 'phone-title' }, el('h2', { id: 'phone-title' }, s.phoneTitle),
    el('div', { class: 'dd-form' }, el('label', {}, s.phone, phone), codeRow, error, el('div', { class: 'dd-actions' }, sendBtn, verifyBtn)), el('p', { class: 'dd-muted' }, s.or));
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

function doctorNotesBox(b, act) {
  const s = t();
  const consent = el('input', { type: 'checkbox', name: 'doc-consent' });
  const out = el('p', { class: 'dd-muted', role: 'status' });
  let rec = null;
  const btn = el('button', { class: 'dd-btn soft', type: 'button', 'aria-pressed': 'false' }, s.docRecord);
  btn.addEventListener('click', act(async () => {
    if (rec) { rec.stop(); return; }
    if (!consent.checked) { out.textContent = s.docConsent; return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/ogg;codecs=opus';
    const chunks = [];
    rec = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 32000 });
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = act(async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      rec = null;
      btn.textContent = s.docRecord;
      btn.setAttribute('aria-pressed', 'false');
      const res = await fetch(`/didi-api/bookings/${b.id}/doctor-notes?consent=yes`, { method: 'POST', headers: { 'content-type': type.split(';')[0] }, body: new Blob(chunks, { type: type.split(';')[0] }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'That did not work.');
      out.textContent = s.docSent;
    });
    rec.start(1000);
    btn.textContent = s.docStop;
    btn.setAttribute('aria-pressed', 'true');
  }));
  return el('fieldset', {}, el('legend', {}, s.docRecord), el('label', { class: 'dd-check' }, consent, s.docConsent), el('div', { class: 'dd-actions' }, btn), out);
}

async function circlesSection() {
  const s = t();
  let mine;
  try { mine = await call('/circles'); } catch { return null; }
  const error = el('p', { class: 'dd-error', role: 'alert' });
  const field = (label, attrs) => el('label', {}, label, el('input', attrs));
  const form = el('form', { class: 'dd-form' },
    field(s.title, { name: 'title', value: 'Chai and stories' }),
    field(s.time, { name: 'time', type: 'time', value: '17:00', required: true }),
    field(s.meet, { name: 'meetLink', type: 'url', placeholder: 'https://meet.google.com/abc-defg-hij', required: true }),
    field(s.circleFee, { name: 'fee', type: 'number', min: '0', step: '10', value: '200' }),
    error, el('button', { class: 'dd-btn', type: 'submit' }, s.create));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try { await call('/circles', { title: f.get('title'), time: f.get('time'), meetLink: f.get('meetLink'), fee: Number(f.get('fee')), language: lang }); render(); } catch (err) { error.textContent = err.message; }
  });
  const list = mine.circles.map((c) => {
    const topic = el('p', { class: 'dd-muted', role: 'status' });
    return el('article', { class: 'dd-card' },
      el('h3', {}, `${c.title} · ${c.time}`),
      el('p', { class: 'dd-muted' }, `${c.members} ${s.members} · ₹${c.fee}`),
      el('div', { class: 'dd-actions' },
        el('a', { class: 'dd-btn go', href: c.meetLink, target: '_blank', rel: 'noopener' }, 'Google Meet'),
        el('button', { class: 'dd-btn soft', type: 'button', onclick: async () => { const x = await call(`/circles/${c.id}/topic`); topic.textContent = [x.topic, ...x.questions].join(' · '); } }, s.topic)),
      topic);
  });
  return [el('section', { class: 'dd-card', 'aria-labelledby': 'host' }, el('h2', { id: 'host' }, s.host), el('p', { class: 'dd-muted' }, s.hostWhy),
    mine.monthly ? el('p', {}, `${s.monthly}: ₹${mine.monthly}`) : null, form), ...list];
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
  const sosOut = el('div', { class: 'dd-sos-out', role: 'status' });
  if (['accepted', 'in-progress'].includes(b.status)) actions.append(el('button', { class: 'dd-btn sos', type: 'button', onclick: act(async () => {
    if (!window.confirm(s.sosConfirm)) return;
    const out = await call(`/bookings/${b.id}/sos`, { language: lang });
    sosOut.replaceChildren(el('p', {}, s.sosSent), el('div', { class: 'dd-actions' }, ...out.call.map((c) => el('a', { class: 'dd-btn sos', href: `tel:${c.number}` }, `${c.label}: ${c.number}`))));
  }) }, s.sosBtn));
  let finish = null;
  if (b.status === 'in-progress') {
    const note = el('textarea', { name: 'note', rows: '3', maxlength: '600' });
    const voiceStatus = el('p', { class: 'dd-muted', role: 'status' });
    let recorder = null;
    const recBtn = el('button', { class: 'dd-btn soft', type: 'button', 'aria-pressed': 'false' }, s.record);
    recBtn.addEventListener('click', act(async () => {
      if (recorder) { recorder.stop(); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/ogg;codecs=opus';
      const chunks = [];
      recorder = new MediaRecorder(stream, { mimeType: type });
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = act(async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        recorder = null;
        recBtn.textContent = s.record;
        recBtn.setAttribute('aria-pressed', 'false');
        const res = await fetch(`/didi-api/bookings/${b.id}/voice-note?language=${lang}`, { method: 'POST', headers: { 'content-type': type.split(';')[0] }, body: new Blob(chunks, { type: type.split(';')[0] }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? 'That did not work.');
        note.value = [note.value, out.text].filter(Boolean).join(' ');
        voiceStatus.textContent = s.heard;
      });
      recorder.start();
      setTimeout(() => recorder?.stop(), 55000);
      recBtn.textContent = s.stop;
      recBtn.setAttribute('aria-pressed', 'true');
      voiceStatus.textContent = s.listening;
    }));
    finish = el('form', { class: 'dd-form' }, el('label', {}, s.note, note), ...(cfg.voiceNotes ? [el('div', { class: 'dd-actions' }, recBtn), voiceStatus] : []), el('button', { class: 'dd-btn go', type: 'submit' }, s.checkOut));
    if (cfg.doctorNotes && b.kind === 'escort') finish.prepend(doctorNotesBox(b, act));
    finish.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await call(`/bookings/${b.id}/check-out`, { note: note.value, language: lang }); refresh(); })(); });
  }
  let rateForm = null;
  if (b.status === 'done' && b.didi === null && !b.familyRating) {
    const stars = el('select', { name: 'stars', 'aria-label': s.rateFamily }, ...[5, 4, 3, 2, 1].map((n) => el('option', { value: String(n) }, '★'.repeat(n))));
    const block = el('input', { type: 'checkbox', name: 'block' });
    rateForm = el('form', { class: 'dd-form' }, el('label', {}, s.rateFamily, stars), el('label', { class: 'dd-check' }, block, s.unsafe), el('button', { class: 'dd-btn soft', type: 'submit' }, s.send));
    rateForm.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await call(`/bookings/${b.id}/rate-family`, { stars: Number(stars.value), block: block.checked }); refresh(); })(); });
  }
  return el('article', { class: 'dd-card' },
    el('span', { class: `dd-badge ${b.status === 'done' ? 'ok' : ''}` }, s.status[b.status] ?? b.status),
    b.familyRating?.stars && b.status !== 'done' ? el('span', { class: 'dd-muted' }, `${s.familyStars}: ★${b.familyRating.stars} (${b.familyRating.count})`) : null,
    el('h3', {}, `${s.kinds[b.kind] ?? b.kindName} · ${when(b.at)}`),
    el('p', { class: 'dd-muted' }, [b.city, b.fee ? `${s.fee}: ₹${b.fee}` : null, b.paidAt ? `${s.paid} ✓` : null].filter(Boolean).join(' · ')),
    b.notes ? el('p', {}, b.notes) : null, brief, actions, sosOut, finish, rateForm, msg);
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
  if (cfg.push) {
    const status = el('p', { class: 'dd-muted', role: 'status' });
    parts.push(el('section', { class: 'dd-card' }, el('div', { class: 'dd-actions' }, el('button', { class: 'dd-btn soft', type: 'button', onclick: async () => {
      try { await enablePush((token) => call('/push', { token })); status.textContent = s.notifyOn; } catch (err) { status.textContent = err.message; }
    } }, s.notify)), status));
  }
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
  if (me.ready && cfg.circles) {
    const circles = await circlesSection();
    if (circles) parts.push(...circles);
  }
  const cName = el('input', { name: 'contactName', value: me.safetyContact?.name ?? '' });
  const cPhone = el('input', { name: 'contactPhone', type: 'tel', inputmode: 'tel', value: me.safetyContact?.phone ?? '' });
  const cStatus = el('p', { class: 'dd-muted', role: 'status' });
  const safetyForm = el('form', { class: 'dd-form' }, el('label', {}, s.contactName, cName), el('label', {}, s.contactPhone, cPhone), el('button', { class: 'dd-btn soft', type: 'submit' }, s.save), cStatus);
  safetyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await fetch('/didi-api/safety', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: cName.value, phone: cPhone.value }) }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); }); cStatus.textContent = s.saved; } catch (err) { cStatus.textContent = err.message; }
  });
  parts.push(el('section', { class: 'dd-card', 'aria-labelledby': 'safety' }, el('h2', { id: 'safety' }, s.safety.split(' (')[0]), el('p', { class: 'dd-muted' }, s.safety), safetyForm));
  if (me.ready) {
    const img = el('img', { class: 'dd-cardimg', src: `/didi-api/card?v=${me.visits}`, alt: `${s.card}: ${me.name}`, loading: 'lazy' });
    const shareBtn = el('button', { class: 'dd-btn go', type: 'button', onclick: async () => {
      const blob = await (await fetch(img.src)).blob();
      const file = new File([blob], `saathi-didi-${me.name.replace(/\W+/g, '-').toLowerCase()}.${blob.type.includes('svg') ? 'svg' : 'png'}`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${me.name} · Saathi Didi` }).catch(() => {});
      else { const a = el('a', { href: URL.createObjectURL(file), download: file.name }); a.click(); }
    } }, s.share);
    parts.push(el('section', { class: 'dd-card', 'aria-labelledby': 'mycard' }, el('h2', { id: 'mycard' }, s.card), img, el('div', { class: 'dd-actions' }, shareBtn, el('a', { class: 'dd-btn soft', href: img.src, download: 'saathi-didi-card' }, s.download))));
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
  try { cfg = { ...cfg, ...(await call('/config')) }; } catch { }
  langSelect.addEventListener('change', () => { setLang(langSelect.value); render(); });
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  if (key) {
    history.replaceState(null, '', location.pathname);
    try { await call('/login', { key }); } catch { }
  }
  render();
}

start();
