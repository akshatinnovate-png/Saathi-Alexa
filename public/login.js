const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const next = params.get('next');
let mode = params.get('step') === 'code' ? 'code' : location.hash === '#signup' ? 'signup' : 'login';
let providers = { cognito: false, demo: false, social: [] };

const COPY = {
  login: { title: 'Log in to Saathi', sub: 'Your family, closer every day', submit: 'Continue with Email', switch: ["Don't have an account?", 'Sign up', '#signup'] },
  signup: { title: 'Create your account', sub: 'Set up Saathi for someone you love', submit: 'Create account', switch: ['Already have an account?', 'Log in', '#login'] },
  confirm: { title: 'Check your email', sub: 'We sent a six-digit code to confirm it is you', submit: 'Confirm and continue', switch: ["Didn't get it?", 'Send a new code', '#resend'] },
  code: { title: 'One more step', sub: 'Type the 6 numbers your authenticator app shows now', submit: 'Verify and continue', switch: ['Lost your phone?', 'Use a recovery code', '#recovery'] },
};

function render() {
  const c = COPY[mode];
  document.title = `${c.title} · Saathi`;
  $('auth-title').textContent = c.title;
  $('auth-sub').textContent = c.sub;
  $('auth-submit').textContent = c.submit;
  const coded = mode === 'confirm' || mode === 'code';
  $('field-name').hidden = mode !== 'signup';
  $('field-email').hidden = coded;
  $('field-password').hidden = coded;
  $('field-code').hidden = !coded;
  $('code-label').textContent = mode === 'code' ? 'Code from your app, or a recovery code' : 'Confirmation code';
  $('code').inputMode = mode === 'code' ? 'text' : 'numeric';
  $('auth-social').hidden = coded || !socialAvailable;
  document.querySelector('.auth-or').hidden = coded || !socialAvailable;
  $('auth-passkey').hidden = mode !== 'login' || !passkeysAvailable;
  $('password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('switch-link').textContent = c.switch[1];
  $('switch-link').href = c.switch[2];
  $('auth-switch').firstChild.textContent = `${c.switch[0]} `;
  showError('');
}

function showError(message) {
  $('auth-error').textContent = message;
  $('auth-error').hidden = !message;
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Please try again.');
  return json;
}

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  if (mode === 'code') return verifyCode();
  if (mode !== 'confirm' && (!email || !password)) return showError('Please enter your email address and password.');
  $('auth-submit').disabled = true;
  try {
    let out;
    if (mode === 'login') out = await post('/auth/login', { email, password, next });
    else if (mode === 'signup') out = await post('/auth/signup', { email, password, name: $('name').value.trim() });
    else out = await post('/auth/confirm', { email, password, code: $('code').value });
    if (out.confirm || out.mfa) {
      mode = out.mfa ? 'code' : 'confirm';
      render();
      $('code').value = '';
      $('code').focus();
      return;
    }
    location.href = out.next ?? '/family.html';
  } catch (err) {
    showError(err.message);
  } finally {
    $('auth-submit').disabled = false;
  }
});

async function verifyCode() {
  const code = $('code').value.trim();
  if (!code) return showError('Please type the code.');
  $('auth-submit').disabled = true;
  try {
    const out = await post('/auth/login/mfa', { code });
    if (out.recoveryLeft !== undefined) sessionStorage.setItem('saathi-recovery-left', String(out.recoveryLeft));
    location.href = out.next ?? '/family.html';
  } catch (err) {
    showError(err.message);
    if (/sign in again/i.test(err.message)) { mode = 'login'; render(); showError(err.message); }
  } finally {
    $('auth-submit').disabled = false;
  }
}

$('auth-passkey').addEventListener('click', async () => {
  showError('');
  $('auth-passkey').disabled = true;
  try {
    const { startAuthentication } = await import('/vendor/webauthn/index.js');
    const options = await post('/auth/passkey/options', {});
    const response = await startAuthentication({ optionsJSON: options });
    const out = await post('/auth/passkey/verify', { response, next });
    location.href = out.next ?? '/family.html';
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') showError('The passkey sign-in was cancelled.');
    else showError(err.message);
  } finally {
    $('auth-passkey').disabled = false;
  }
});

$('switch-link').addEventListener('click', async (e) => {
  e.preventDefault();
  if (mode === 'code') {
    $('auth-sub').textContent = 'Type one of the recovery codes you saved, like abcde-12345. Each one works once.';
    $('code').focus();
    return;
  }
  if (mode === 'confirm') {
    try {
      await post('/auth/resend', { email: $('email').value.trim() });
      showError('');
      $('auth-sub').textContent = 'A new code is on its way.';
    } catch (err) {
      showError(err.message);
    }
    return;
  }
  mode = mode === 'login' ? 'signup' : 'login';
  history.replaceState(null, '', `${location.pathname}${location.search}${mode === 'signup' ? '#signup' : ''}`);
  render();
  (mode === 'signup' ? $('name') : $('email')).focus();
});

document.querySelectorAll('.social-btn').forEach((a) => {
  a.addEventListener('click', (e) => {
    if (providers.social.includes(a.dataset.provider)) {
      if (next) a.href = `${a.getAttribute('href')}?next=${encodeURIComponent(next)}`;
      return;
    }
    e.preventDefault();
    showError(`${a.getAttribute('aria-label').replace('Continue with ', '')} sign-in is not connected yet. Please use your email for now.`);
  });
});

function showProviders() {
  const buttons = [...document.querySelectorAll('.social-btn')];
  for (const b of buttons) b.hidden = !providers.social.includes(b.dataset.provider);
  const any = buttons.some((b) => !b.hidden);
  $('auth-social').dataset.count = String(buttons.filter((b) => !b.hidden).length);
  socialAvailable = any;
  for (const b of buttons.filter((x) => !x.hidden)) {
    if (buttons.filter((x) => !x.hidden).length === 1 && !b.querySelector('span')) {
      const label = document.createElement('span');
      label.textContent = b.getAttribute('aria-label');
      b.append(label);
      b.classList.add('wide');
    }
  }
  render();
}

let socialAvailable = false;
let passkeysAvailable = false;

async function init() {
  render();
  if (params.get('error') === 'social-unavailable') showError('That sign-in option is not connected yet. Please use your email.');
  if (params.get('error') === 'social-failed') showError('That sign-in did not complete. Please try again.');
  try {
    const session = await (await fetch('/api/session')).json();
    providers = session.providers;
    passkeysAvailable = Boolean(providers.passkeys && window.PublicKeyCredential && window.isSecureContext);
    showProviders();
    if (session.user) {
      location.replace(session.user.householdId ? (next ?? '/family.html') : '/welcome.html');
      return;
    }
    if (providers.demo) {
      const demo = $('auth-demo');
      const code = (text) => { const c = document.createElement('code'); c.textContent = text; return c; };
      demo.replaceChildren('Demo family: ', code('riya@saathi.demo'), ' · ', code('saathi-demo-2026'));
      demo.hidden = false;
    }
  } catch { }
}

init();
