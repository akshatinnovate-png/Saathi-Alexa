const $ = (id) => document.getElementById(id);
const STEPS = [
  { title: 'Who are you caring for?', sub: 'Saathi will speak to them in their language, at their pace.' },
  { title: 'And who are you?', sub: 'You will be the first person in their circle. You can invite others next.' },
  { title: 'Someone close by', sub: 'A neighbour who can knock on the door if needed.' },
  { title: 'Their medicines', sub: 'So Saathi can remind them gently and never allow a double dose.' },
];
const LANGS = { mr: 'मराठी · Marathi', hi: 'हिन्दी · Hindi', en: 'English', ta: 'தமிழ் · Tamil', bn: 'বাংলা · Bengali', es: 'Español · Spanish', fr: 'Français · French', ar: 'العربية · Arabic' };
let step = 1;
let countries = {};

function option(value, label, selected) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  o.selected = selected;
  return o;
}

async function fillPlaces() {
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [browserZone];
  $('e-tz').replaceChildren(...[...new Set([browserZone, ...zones])].sort().map((z) => option(z, z.replaceAll('_', ' '), z === browserZone)));
  try {
    countries = (await (await fetch('/api/reference')).json()).countries;
  } catch {
    countries = {};
  }
  const guess = Object.entries({ Kolkata: 'IN', Calcutta: 'IN', London: 'GB', Dubai: 'AE', Singapore: 'SG', Sydney: 'AU', Melbourne: 'AU', Toronto: 'CA', Auckland: 'NZ', Kathmandu: 'NP', Dhaka: 'BD', Karachi: 'PK', Tokyo: 'JP' }).find(([city]) => browserZone.includes(city))?.[1]
    ?? (browserZone.startsWith('America/') ? 'US' : 'IN');
  $('e-country').replaceChildren(...Object.entries(countries).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([code, c]) => option(code, c.name, code === guess)), option('', 'Somewhere else', false));
  const syncNumber = () => { $('e-emergency').value = countries[$('e-country').value]?.emergency ?? ''; };
  $('e-country').addEventListener('change', syncNumber);
  syncNumber();
}

function fillLanguages(select, chosen) {
  select.replaceChildren(...Object.entries(LANGS).map(([code, label]) => {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = label;
    o.selected = code === chosen;
    return o;
  }));
}

function addMed() {
  const row = $('med-row').content.firstElementChild.cloneNode(true);
  const n = $('meds').children.length;
  row.querySelectorAll('input').forEach((input) => {
    input.id = `m${n}-${input.dataset.k}`;
    const label = input.closest('.field')?.querySelector('label');
    if (label) label.htmlFor = input.id;
  });
  $('meds').append(row);
  row.querySelector('input').focus();
}

function show(n) {
  step = n;
  document.querySelectorAll('.w-panel').forEach((p) => { p.hidden = Number(p.dataset.step) !== step; });
  $('w-step').textContent = `Step ${step} of ${STEPS.length}`;
  $('w-title').textContent = STEPS[step - 1].title;
  $('w-sub').textContent = STEPS[step - 1].sub;
  $('w-back').hidden = step === 1;
  $('w-next').textContent = step === STEPS.length ? 'Create our circle' : 'Continue';
  $('w-error').hidden = true;
}

function require(ids) {
  const missing = ids.map($).find((el) => !el.value.trim());
  if (!missing) return true;
  $('w-error').textContent = `Please fill in “${missing.closest('.field').querySelector('label').textContent}”.`;
  $('w-error').hidden = false;
  missing.focus();
  return false;
}

function form() {
  const meds = [...document.querySelectorAll('.med-row')].map((row) => {
    const v = (k) => row.querySelector(`[data-k="${k}"]`);
    return { name: v('name').value, purpose: v('purpose').value, times: [v('time').value, v('time2').value].filter(Boolean), description: v('description').value, remaining: Number(v('remaining').value), withFood: v('withFood').checked };
  }).filter((m) => m.name.trim());
  return {
    elder: {
      name: $('e-name').value, preferredName: $('e-called').value, language: $('e-lang').value, city: $('e-city').value, home: $('e-home').value,
      memorySupport: $('e-memory').checked, hearingLoss: $('e-hearing').checked, lowVision: $('e-vision').checked,
      pronoun: $('e-pronoun').value, country: $('e-country').value, timezone: $('e-tz').value, emergencyNumber: $('e-emergency').value,
    },
    owner: { name: $('o-name').value, relationship: $('o-rel').value, language: $('o-lang').value, city: $('o-city').value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    neighbour: $('n-name').value.trim() ? { name: $('n-name').value, language: $('n-lang').value, email: $('n-email').value } : null,
    medications: meds,
  };
}

$('w-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (step === 1 && !require(['e-name', 'e-city'])) return;
  if (step === 2 && !require(['o-name', 'o-rel'])) return;
  if (step < STEPS.length) return show(step + 1);
  $('w-next').disabled = true;
  try {
    const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form()) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    location.href = json.next;
  } catch (err) {
    $('w-error').textContent = err.message || 'Something went wrong.';
    $('w-error').hidden = false;
  } finally {
    $('w-next').disabled = false;
  }
});

$('w-back').addEventListener('click', () => show(step - 1));
$('add-med').addEventListener('click', addMed);
$('logout').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

const browserLang = (navigator.languages ?? [navigator.language]).map((l) => l.slice(0, 2)).find((l) => LANGS[l]) ?? 'en';
fillLanguages($('e-lang'), browserLang);
fillLanguages($('o-lang'), browserLang);
fillLanguages($('n-lang'), browserLang);
fillPlaces();
fetch('/api/session').then((r) => r.json()).then((s) => { if (s.user?.name) $('o-name').value = s.user.name; }).catch(() => {});
addMed();
show(1);
