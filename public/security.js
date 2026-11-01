import { el } from './common.js';
import { svg } from './trusted.js';

const $ = (id) => document.getElementById(id);

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'Something went wrong. Please try again.'), { code: json.code, status: res.status });
  return json;
}

const describe = (agent) => {
  const ua = String(agent ?? '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Silk/.test(ua) ? 'Echo Show' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
};

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');

const ACTIONS = {
  'signed-in': 'Signed in',
  'sign-in-failed': 'Wrong password',
  'signed-out': 'Signed out',
  'two-step-failed': 'Wrong two-step code',
  'two-step-turned-on': 'Two-step sign-in turned on',
  'two-step-turned-off': 'Two-step sign-in turned off',
  'recovery-codes-replaced': 'New recovery codes made',
  'passkey-added': 'Passkey added',
  'passkey-removed': 'Passkey removed',
  'password-changed': 'Password changed',
  'session-ended': 'A sign-in was ended',
  'signed-out-everywhere-else': 'Signed out everywhere else',
  'confirm-identity-failed': 'Identity check failed',
  'device-asked-to-join': 'A device asked to join',
  'device-approved': 'Device approved',
  'device-refused': 'Device refused',
  'device-joined': 'Device joined',
  'device-removed': 'Device removed',
  'pairing-code-made': 'Pairing code made',
  'member-removed': 'Someone was removed',
  'member-invited': 'Invite sent',
  'account-created': 'Account created',
  'family-created': 'Family set up',
  'gmail-connected': 'Gmail connected',
  'joined-family': 'Someone joined',
  'profile-changed': 'Elder details changed',
  'alexa-key-made': 'Alexa+ key made',
  'gmail-disconnected': 'Gmail disconnected',
  'doorbell-link-made': 'Doorbell link made',
};

export function setupSecurity({ isOwner, toast, privateBlock = null }) {
  const dialog = $('security-dialog');
  const body = $('security-body');
  let state = null;
  let retry = null;

  const section = (title, ...children) => el('section', { class: 'sec-block' }, el('h3', { class: 'devices-h' }, title), ...children);
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const fail = (err) => { error.textContent = err.message; error.hidden = false; };

  async function guarded(fn) {
    error.hidden = true;
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'reauth') {
        retry = fn;
        return askIdentity();
      }
      fail(err);
    }
  }

  function askIdentity() {
    const input = el('input', { type: state?.hasPassword ? 'password' : 'text', autocomplete: state?.hasPassword ? 'current-password' : 'one-time-code', required: true });
    const form = el('form', { class: 'sec-reauth', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const value = input.value.trim();
        await request('/api/security/reauth', { method: 'POST', body: { password: state?.hasPassword ? input.value : undefined, code: value } });
        const again = retry;
        retry = null;
        await render();
        if (again) await guarded(again);
      } catch (err) { fail(err); }
    } },
    el('p', {}, 'For your safety, confirm it is you before changing this.'),
    el('label', {}, state?.hasPassword ? 'Your password, or a code from your app' : 'A code from your authenticator app', input),
    el('div', { class: 'sheet-actions' },
      el('button', { class: 'text-action', type: 'button', onclick: () => { retry = null; render(); } }, 'Cancel'),
      el('button', { class: 'pill-action dark', type: 'submit' }, 'Confirm it\'s me')));
    body.replaceChildren(el('h2', { id: 'security-h' }, 'Confirm it\'s you'), form, error);
    input.focus();
  }

  function showCodes(codes, note) {
    const list = el('ol', { class: 'sec-codes' }, ...codes.map((c) => el('li', {}, el('code', {}, c))));
    body.replaceChildren(
      el('h2', { id: 'security-h' }, 'Save your recovery codes'),
      el('p', {}, note),
      el('p', { class: 'muted' }, 'Each code works once. Keep them somewhere safe, like a printed page in a drawer. This is the only time Saathi shows them.'),
      list,
      el('div', { class: 'sheet-actions' },
        el('button', { class: 'text-action', type: 'button', onclick: async () => { await navigator.clipboard?.writeText(codes.join('\n')); toast('Codes copied.'); } }, 'Copy'),
        el('button', { class: 'pill-action', type: 'button', onclick: () => {
          const a = el('a', { href: URL.createObjectURL(new Blob([`Saathi recovery codes\n\n${codes.join('\n')}\n`], { type: 'text/plain' })), download: 'saathi-recovery-codes.txt' });
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } }, 'Download'),
        el('button', { class: 'pill-action dark', type: 'button', onclick: () => render() }, 'I saved them')));
  }

  async function startTotp() {
    const setup = await request('/api/security/totp/start', { method: 'POST', body: {} });
    const code = el('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', required: true, placeholder: '123456' });
    const qr = el('div', { class: 'sec-qr', 'aria-hidden': 'true' });
    qr.innerHTML = svg(setup.qr);
    body.replaceChildren(
      el('h2', { id: 'security-h' }, 'Turn on two-step sign-in'),
      el('p', {}, 'Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Apple Passwords). Then type the 6 numbers it shows.'),
      qr,
      el('p', { class: 'muted small' }, 'Can\'t scan? Type this key: ', el('code', { class: 'sec-secret' }, setup.secret)),
      el('form', { class: 'sec-inline', onsubmit: (e) => { e.preventDefault(); guarded(async () => {
        const out = await request('/api/security/totp/confirm', { method: 'POST', body: { code: code.value } });
        toast('Two-step sign-in is on.');
        showCodes(out.recoveryCodes, 'Two-step sign-in is on. If you lose your phone, these codes let you in.');
      }); } },
      el('label', {}, 'Code from the app', code),
      el('button', { class: 'pill-action dark', type: 'submit' }, 'Turn on')),
      error,
      el('div', { class: 'sheet-actions' }, el('button', { class: 'text-action', type: 'button', onclick: () => render() }, 'Cancel')));
    code.focus();
  }

  function codePrompt(title, action) {
    const code = el('input', { autocomplete: 'one-time-code', required: true });
    body.replaceChildren(
      el('h2', { id: 'security-h' }, title),
      el('form', { class: 'sec-inline', onsubmit: (e) => { e.preventDefault(); guarded(() => action(code.value.trim())); } },
        el('label', {}, 'A code from your app, or a recovery code', code),
        el('button', { class: 'pill-action dark', type: 'submit' }, 'Continue')),
      error,
      el('div', { class: 'sheet-actions' }, el('button', { class: 'text-action', type: 'button', onclick: () => render() }, 'Cancel')));
    code.focus();
  }

  async function addPasskey() {
    if (!window.PublicKeyCredential || !window.isSecureContext) throw new Error('This browser cannot make passkeys here. Open Saathi over https or on localhost.');
    const { startRegistration } = await import('/vendor/webauthn/index.js');
    const options = await request('/api/security/passkeys/options', { method: 'POST', body: {} });
    let response;
    try {
      response = await startRegistration({ optionsJSON: options });
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') throw new Error('Adding the passkey was cancelled.');
      if (err?.name === 'InvalidStateError') throw new Error('This device already has a passkey for Saathi.');
      throw err;
    }
    const name = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone or iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows PC' : 'This device';
    await request('/api/security/passkeys', { method: 'POST', body: { response, name } });
    toast('Passkey added. Next time, sign in with your fingerprint, face or screen lock.');
    render();
  }

  function passwordForm() {
    const current = el('input', { type: 'password', autocomplete: 'current-password' });
    const next = el('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '10' });
    return el('form', { class: 'sec-password', onsubmit: (e) => { e.preventDefault(); guarded(async () => {
      const out = await request('/api/security/password', { method: 'POST', body: { current: current.value, next: next.value } });
      current.value = '';
      next.value = '';
      toast(out.otherSessionsEnded ? `Password changed. ${out.otherSessionsEnded} other sign-in${out.otherSessionsEnded === 1 ? ' was' : 's were'} ended.` : 'Password changed.');
      render();
    }); } },
    el('div', { class: 'sheet-row' },
      state.hasPassword ? el('label', {}, 'Current password', current) : null,
      el('label', {}, state.hasPassword ? 'New password' : 'Add a password', next)),
    el('p', { class: 'muted small' }, 'At least 10 characters. Saathi checks it against passwords leaked in data breaches without ever sending it anywhere.'),
    el('div', { class: 'sheet-actions' }, el('button', { class: 'pill-action', type: 'submit' }, state.hasPassword ? 'Change password' : 'Add password')));
  }

  async function logView() {
    const log = await request('/api/security/log');
    const badge = log.verified.ok
      ? el('p', { class: 'sec-badge ok' }, `✓ All ${log.verified.entries} entries are intact. Each one is sealed to the one before it, so nobody can quietly edit or delete history.`)
      : el('p', { class: 'sec-badge bad' }, `⚠ The history was changed after it was written (entry ${log.verified.brokenAt ?? '?'}). ${log.verified.reason ?? ''}`);
    return [badge, el('ul', { class: 'device-list sec-log' }, ...log.entries.slice(0, 60).map((e) => el('li', {},
      el('span', {}, el('strong', {}, ACTIONS[e.action] ?? e.action), ' · ', e.actor ?? 'someone', e.detail?.emoji ? ` ${e.detail.emoji}` : ''),
      el('span', { class: 'muted small' }, when(e.at))))) ];
  }

  async function render() {
    try {
      state = await request('/api/security');
    } catch (err) {
      body.replaceChildren(el('h2', { id: 'security-h' }, 'Security'), el('p', { class: 'form-error' }, err.message));
      return;
    }
    const sessions = state.sessions.map((s) => el('li', {},
      el('span', {}, el('strong', {}, s.agent || 'A browser'), s.current ? ' · this one' : '', el('br'), el('span', { class: 'muted small' }, `Signed in ${when(s.createdAt)} · last seen ${when(s.lastSeenAt)}`)),
      s.current ? null : el('button', { class: 'text-action', type: 'button', onclick: () => guarded(async () => { await request(`/api/security/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' }); toast('Signed out there.'); render(); }) }, 'Sign out')));
    const passkeys = state.passkeys.map((p) => el('li', {},
      el('span', {}, el('strong', {}, p.name), el('br'), el('span', { class: 'muted small' }, `Added ${when(p.createdAt)} · last used ${when(p.lastUsedAt)}${p.backedUp ? ' · synced' : ''}`)),
      el('button', { class: 'text-action', type: 'button', onclick: () => guarded(async () => { await request(`/api/security/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast('Passkey removed.'); render(); }) }, 'Remove')));
    const blocks = [
      el('h2', { id: 'security-h' }, 'Security'),
      el('p', { class: 'muted' }, 'Everything here protects the family\'s private details. Saathi encrypts its data on disk and keeps a sealed history of every sensitive change.'),
      error,
      privateBlock ? privateBlock(() => render()) : null,
      section('Passkeys',
        el('p', { class: 'muted small' }, 'Sign in with your fingerprint, face or phone lock. Nothing to remember and nothing anyone can steal by tricking you.'),
        el('ul', { class: 'device-list' }, ...(passkeys.length ? passkeys : [el('li', { class: 'muted' }, 'None yet.')])),
        el('div', { class: 'sheet-actions' }, el('button', { class: 'pill-action', type: 'button', onclick: () => guarded(addPasskey) }, 'Add a passkey'))),
      section('Two-step sign-in',
        el('p', { class: 'muted small' }, state.totp
          ? `On. Signing in needs a code from your phone as well. ${state.recoveryLeft} recovery code${state.recoveryLeft === 1 ? '' : 's'} left.`
          : 'Off. Turn it on so a stolen password is not enough to get in.'),
        el('div', { class: 'sheet-actions' }, ...(state.totp ? [
          el('button', { class: 'text-action', type: 'button', onclick: () => codePrompt('Make new recovery codes', async (code) => { const out = await request('/api/security/recovery', { method: 'POST', body: { code } }); showCodes(out.recoveryCodes, 'Your old recovery codes no longer work.'); }) }, 'New recovery codes'),
          el('button', { class: 'text-action', type: 'button', onclick: () => codePrompt('Turn off two-step sign-in', async (code) => { await request('/api/security/totp/disable', { method: 'POST', body: { code } }); toast('Two-step sign-in is off.'); render(); }) }, 'Turn off'),
        ] : [el('button', { class: 'pill-action', type: 'button', onclick: () => guarded(startTotp) }, 'Turn on')]))),
      section('Password', passwordForm()),
      section('Where you are signed in',
        el('ul', { class: 'device-list' }, ...sessions),
        sessions.length > 1 ? el('div', { class: 'sheet-actions' }, el('button', { class: 'pill-action', type: 'button', onclick: () => guarded(async () => { const out = await request('/api/security/sessions/revoke-others', { method: 'POST', body: {} }); toast(`Signed out of ${out.ended} other place${out.ended === 1 ? '' : 's'}.`); render(); }) }, 'Sign out everywhere else')) : null),
    ];
    if (isOwner()) {
      const holder = el('div', { class: 'sec-log-holder' }, el('p', { class: 'muted small' }, 'Loading…'));
      blocks.push(section('Security history', holder));
      logView().then((nodes) => holder.replaceChildren(...nodes)).catch((err) => holder.replaceChildren(el('p', { class: 'form-error' }, err.message)));
    }
    blocks.push(el('div', { class: 'sheet-actions' }, el('button', { class: 'pill-action dark', type: 'button', onclick: () => dialog.close() }, 'Done')));
    body.replaceChildren(...blocks.filter(Boolean));
  }

  $('open-security').addEventListener('click', () => {
    retry = null;
    body.replaceChildren(el('h2', { id: 'security-h' }, 'Security'), el('p', { class: 'muted' }, 'Loading…'));
    dialog.showModal();
    render();
  });
  const left = sessionStorage.getItem('saathi-recovery-left');
  if (left !== null) {
    sessionStorage.removeItem('saathi-recovery-left');
    toast(`You used a recovery code. ${left} left. Open Security to make new ones.`, 9000);
  }
}

export function setupPairApprovals({ toast, canApprove }) {
  const dialog = $('approve-dialog');
  const answered = new Set();
  let showing = null;

  async function decide(approve) {
    const req = showing;
    if (!req) return;
    answered.add(req.id);
    $('approve-yes').disabled = true;
    $('approve-no').disabled = true;
    try {
      await request(`/api/devices/requests/${encodeURIComponent(req.id)}`, { method: 'POST', body: { approve } });
      toast(approve ? 'Approved. The device will connect in a moment.' : 'Refused. That device cannot get in.');
    } catch (err) {
      toast(err.message);
    } finally {
      $('approve-yes').disabled = false;
      $('approve-no').disabled = false;
      showing = null;
      dialog.close();
    }
  }

  async function poll() {
    if (!canApprove() || showing || document.visibilityState !== 'visible') return;
    try {
      const requests = await request('/api/devices/requests');
      const next = requests.find((r) => !answered.has(r.id));
      if (!next) return;
      showing = next;
      $('approve-emoji').textContent = next.emoji.join(' ');
      $('approve-emoji').setAttribute('aria-label', `Pictures: ${next.emoji.join(', ')}`);
      $('approve-what').textContent = `${describe(next.agent)} · asked at ${new Date(next.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      if (!dialog.open) dialog.showModal();
    } catch { }
  }

  $('approve-yes').addEventListener('click', () => decide(true));
  $('approve-no').addEventListener('click', () => decide(false));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); });
  setInterval(poll, 3000);
  document.addEventListener('visibilitychange', poll);
  poll();
}
