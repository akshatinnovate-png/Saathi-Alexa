const $ = (id) => document.getElementById(id);
const input = $('code');
const digits = () => input.value.replace(/\D/g, '').slice(0, 6);
const format = () => {
  const d = digits();
  input.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
};

function showError(message) {
  $('dev-error').textContent = message;
  $('dev-error').hidden = !message;
}

let polling = null;

function done(device, next) {
  clearInterval(polling);
  $('dev-form').hidden = true;
  $('dev-wait').hidden = true;
  $('dev-title').textContent = 'All set';
  $('dev-sub').hidden = true;
  $('dev-done').hidden = false;
  $('dev-done-text').textContent = `This is now ${device.label}.`;
  setTimeout(() => location.replace(next ?? '/alexa.html'), 1600);
}

function restart(message) {
  clearInterval(polling);
  $('dev-wait').hidden = true;
  $('dev-form').hidden = false;
  $('dev-sub').hidden = false;
  $('dev-title').textContent = 'Set up this device';
  input.value = '';
  showError(message);
  input.focus();
}

function waitForApproval(emoji) {
  $('dev-form').hidden = true;
  $('dev-sub').hidden = true;
  $('dev-title').textContent = 'Waiting for your family';
  $('dev-emoji').textContent = emoji.join(' ');
  $('dev-emoji').setAttribute('aria-label', `Pictures: ${emoji.join(', ')}`);
  $('dev-wait').hidden = false;
  clearInterval(polling);
  polling = setInterval(check, 2500);
}

async function check() {
  try {
    const json = await (await fetch('/auth/device/status', { cache: 'no-store' })).json();
    if (json.status === 'approved') return done(json.device, json.next);
    if (json.status === 'pending') return json.emoji && $('dev-wait').hidden && waitForApproval(json.emoji);
    if (json.status === 'denied') return restart('Your family said no to this device. Ask them for a new code.');
    if (json.status === 'expired') return restart('That took too long. Ask your family for a new code.');
    if (polling) restart('Something changed. Please type a new code.');
  } catch { }
}

async function connect() {
  const code = digits();
  if (code.length !== 6) return showError('Type all six numbers.');
  showError('');
  try {
    const res = await fetch('/auth/device', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? 'That did not work. Please try again.');
    if (json.status === 'pending') return waitForApproval(json.emoji);
    done(json.device, json.next);
  } catch (err) {
    showError(err.message);
    input.focus();
  }
}

input.addEventListener('input', () => { format(); showError(''); if (digits().length === 6) connect(); });
document.querySelectorAll('.dev-pad button[data-key]').forEach((b) => b.addEventListener('click', () => {
  const d = digits();
  input.value = b.dataset.key === 'back' ? d.slice(0, -1) : (d + b.dataset.key).slice(0, 6);
  format();
  if (b.dataset.key !== 'back' && digits().length === 6) connect();
}));
$('dev-form').addEventListener('submit', (e) => { e.preventDefault(); connect(); });

(async () => {
  try {
    const session = await (await fetch('/api/session')).json();
    if (session.device) {
      $('dev-title').textContent = 'Already set up';
      $('dev-sub').textContent = `This is ${session.device.label}. Opening Saathi…`;
      $('dev-form').hidden = true;
      setTimeout(() => location.replace('/alexa.html'), 1200);
      return;
    }
    const pending = await (await fetch('/auth/device/status', { cache: 'no-store' })).json();
    if (pending.status === 'pending' && pending.emoji) return waitForApproval(pending.emoji);
  } catch { }
  const preset = new URLSearchParams(location.search).get('code');
  if (preset) { input.value = preset; format(); connect(); } else input.focus();
})();
