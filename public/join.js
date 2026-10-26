const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('invite') ?? '';
let mode = 'signup';

function showError(message) {
  $('join-error').textContent = message;
  $('join-error').hidden = !message;
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Please try again.');
  return json;
}

function setMode(next) {
  mode = next;
  $('field-name').hidden = mode === 'login';
  $('password-label').textContent = mode === 'login' ? 'Your password' : 'Choose a password';
  $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('join-submit').textContent = mode === 'login' ? 'Log in and join' : 'Join the circle';
}

async function init() {
  const res = await fetch(`/api/invite/${encodeURIComponent(token)}`);
  const invite = await res.json().catch(() => ({}));
  if (!res.ok) {
    $('join-title').textContent = 'This link has expired';
    $('join-sub').textContent = invite.error ?? 'Ask the person who invited you to send a new one.';
    $('join-switch').hidden = false;
    return;
  }
  const elder = invite.elderName ?? 'the family';
  $('join-title').textContent = `Join ${elder}'s circle`;
  $('join-sub').textContent = `${invite.inviterName} invited you${invite.memberName ? `, ${invite.memberName},` : ''} to stay close to ${elder}: see how ${elder} is each day, send messages they hear in their own language, and get a call if they need help.`;
  $('join-ready').hidden = false;
  $('email').value = invite.email;
  $('name').value = invite.memberName ?? '';
  if (invite.signedInAs) {
    $('join-form').hidden = true;
    $('join-accept').hidden = false;
    $('join-accept').textContent = `Join as ${invite.signedInAs}`;
    return;
  }
  if (invite.google) {
    $('join-google').hidden = false;
    $('join-or').hidden = false;
    $('join-google').href = `/auth/google?invite=${encodeURIComponent(token)}`;
  }
  setMode(invite.exists ? 'login' : 'signup');
}

$('join-accept').addEventListener('click', async () => {
  try {
    location.href = (await post('/auth/invite/accept', { invite: token })).next;
  } catch (err) {
    $('join-sub').textContent = err.message;
  }
});

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) return showError('Please enter your email address and a password.');
  $('join-submit').disabled = true;
  try {
    const out = mode === 'login'
      ? await post('/auth/login', { email, password, invite: token })
      : await post('/auth/signup', { email, password, name: $('name').value.trim(), invite: token });
    if (out.confirm) return showError('Check your email for a confirmation code, then log in.');
    location.href = out.next ?? '/family.html';
  } catch (err) {
    if (/already exists/.test(err.message)) setMode('login');
    showError(err.message);
  } finally {
    $('join-submit').disabled = false;
  }
});

init();
