const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const next = params.get('next');
let mode = location.hash === '#signup' ? 'signup' : 'login';
let providers = { cognito: false, demo: false, social: [] };

const COPY = {
  login: { title: 'Log in to Saathi', sub: 'Your family, closer every day', submit: 'Continue with Email', switch: ["Don't have an account?", 'Sign up', '#signup'] },
  signup: { title: 'Create your account', sub: 'Set up Saathi for someone you love', submit: 'Create account', switch: ['Already have an account?', 'Log in', '#login'] },
  confirm: { title: 'Check your email', sub: 'We sent a six-digit code to confirm it is you', submit: 'Confirm and continue', switch: ["Didn't get it?", 'Send a new code', '#resend'] },
};

function render() {
  const c = COPY[mode];
  document.title = `${c.title} · Saathi`;
  $('auth-title').textContent = c.title;
  $('auth-sub').textContent = c.sub;
  $('auth-submit').textContent = c.submit;
  $('field-name').hidden = mode !== 'signup';
  $('field-email').hidden = mode === 'confirm';
  $('field-password').hidden = mode === 'confirm';
  $('field-code').hidden = mode !== 'confirm';
  $('auth-social').hidden = mode === 'confirm';
  document.querySelector('.auth-or').hidden = mode === 'confirm';
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
  if (mode !== 'confirm' && (!email || !password)) return showError('Please enter your email address and password.');
  $('auth-submit').disabled = true;
  try {
    let out;
    if (mode === 'login') out = await post('/auth/login', { email, password, next });
    else if (mode === 'signup') out = await post('/auth/signup', { email, password, name: $('name').value.trim() });
    else out = await post('/auth/confirm', { email, password, code: $('code').value });
    if (out.confirm) {
      mode = 'confirm';
      render();
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

$('switch-link').addEventListener('click', async (e) => {
  e.preventDefault();
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

async function init() {
  render();
  if (params.get('error') === 'social-unavailable') showError('That sign-in option is not connected yet. Please use your email.');
  if (params.get('error') === 'social-failed') showError('That sign-in did not complete. Please try again.');
  try {
    const session = await (await fetch('/api/session')).json();
    providers = session.providers;
    if (session.user) {
      location.replace(session.user.householdId ? (next ?? '/family.html') : '/welcome.html');
      return;
    }
    if (providers.demo) {
      const demo = $('auth-demo');
      demo.innerHTML = 'Demo family: <code>riya@saathi.demo</code> · <code>saathi-demo-2026</code>';
      demo.hidden = false;
    }
  } catch { }
}

init();
