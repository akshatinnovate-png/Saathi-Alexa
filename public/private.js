import { el } from './common.js';
import {
  createFamilyKey, beginJoin, joinerStep, approverBegin, approverPictures, approverDecide,
  rotateFamilyKey, recoverWithCode, replaceRecoveryKit, seal, open, verifyDevices,
} from './vault-flows.js';
import { random, b64u, unb64u, utf8, text } from './vault-crypto.js';
import { saveDevice, privateKeys, rememberSession, lockWithPasskey, readRecord, prfSupported, forget } from './vault-device.js';

const $ = (id) => document.getElementById(id);

async function call(method, path, body) {
  const res = await fetch(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'Something went wrong.'), { status: res.status });
  return json;
}

export function createPrivate({ householdId, me, isOwner, toast, onChange = () => {} }) {
  const who = `user:${me.email}`;
  let state = null;
  let session = null;
  let busy = false;
  let rerender = null;

  async function load() {
    try { state = await call('GET', '/api/vault'); } catch { state = null; }
    if (state?.ready && !session) {
      try {
        const s = await privateKeys(call, householdId, who);
        if (s && !s.locked) session = s;
        if (s?.locked) session = { locked: true };
      } catch (err) {
        if (err.status === 403) await forget(householdId, who);
      }
    }
    return state;
  }

  const ready = () => Boolean(session && !session.locked && session.keys);

  async function unlock() {
    const s = await privateKeys(call, householdId, who, { interactive: true });
    if (s && !s.locked) { session = s; onChange(); }
    return ready();
  }

  async function adopt(device, keys, keyId) {
    await saveDevice(householdId, who, device, keyId);
    session = { device, keys, keyId };
    rememberSession(householdId, who, session);
    await load();
    onChange();
    rerender?.();
  }

  function showSheet(title, ...body) {
    const dialog = $('private-dialog');
    $('private-body').replaceChildren(el('h2', { id: 'private-h' }, title), ...body);
    if (!dialog.open) dialog.showModal();
    return dialog;
  }
  const close = () => $('private-dialog').close();

  function recoverySheet({ recoveryCode, recoverySheets }, done) {
    const blocks = recoveryCode
      ? [el('p', { class: 'recovery-code' }, recoveryCode)]
      : recoverySheets.map((code, i) => el('div', { class: 'recovery-sheet' }, el('strong', {}, `Sheet ${i + 1} of 3`), el('p', { class: 'recovery-code' }, code)));
    const expect = (recoveryCode ?? recoverySheets[0]).split('-').filter((g) => g.length === 5).at(-1);
    const typed = el('input', { autocomplete: 'off', maxlength: '5', 'aria-describedby': 'recovery-help' });
    const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
    showSheet('Save your recovery kit',
      el('p', {}, recoveryCode
        ? 'Write this code on paper, or print it. If every family phone and computer is lost, it is the only way back to the private messages.'
        : 'Give each sheet to a different family member. Any two sheets together bring the private messages back. One sheet alone is useless.'),
      ...blocks,
      el('p', { class: 'muted small', id: 'recovery-help' }, recoveryCode ? 'To check you saved it, type the last full group of 5 letters.' : 'To check you saved them, type the last full group of 5 letters on sheet 1.'),
      el('form', { class: 'sec-inline', onsubmit: (e) => {
        e.preventDefault();
        if (typed.value.trim().toUpperCase() !== expect) { error.textContent = 'That does not match. Look at the code again.'; error.hidden = false; return; }
        close();
        done?.();
      } }, el('label', {}, 'Last group', typed), el('button', { class: 'pill-action dark', type: 'submit' }, 'I saved it')),
      error,
      el('div', { class: 'sheet-actions' }, el('button', { class: 'text-action', type: 'button', onclick: () => window.print() }, 'Print')));
    typed.focus();
  }

  async function turnOn() {
    const choose = (split) => async () => {
      try {
        busy = true;
        const made = await createFamilyKey(call, householdId, { label: deviceLabel(), split });
        await adopt(made.device, made.keys, made.keyId);
        recoverySheet(made, () => toast('Private messages are on. Only your family devices can read them now.'));
      } catch (err) { toast(err.message); } finally { busy = false; }
    };
    showSheet('Turn on private messages',
      el('p', {}, 'Voice notes, photos and private messages will be locked on your devices before they reach Saathi. Saathi itself cannot open them.'),
      el('p', { class: 'muted' }, 'First, choose how to keep a way back in case every family device is lost:'),
      el('div', { class: 'sheet-actions stack' },
        el('button', { class: 'pill-action dark', type: 'button', onclick: choose(false) }, 'One recovery code for me'),
        el('button', { class: 'pill-action', type: 'button', onclick: choose(true) }, '3 sheets for 3 relatives (any 2 work)'),
        el('button', { class: 'text-action', type: 'button', onclick: close }, 'Not now')));
  }

  function pictures(list) {
    return el('p', { class: 'approve-emoji', role: 'img', 'aria-label': `Pictures: ${list.join(', ')}` }, list.join(' '));
  }

  async function joinThisDevice() {
    const join = await beginJoin(call, { label: deviceLabel() });
    showSheet('Waiting for your family', el('p', {}, 'Someone in the family should open Saathi on a phone or computer that already has private messages. They will be asked to check this device.'), el('p', { class: 'muted', 'aria-live': 'polite', id: 'join-status' }, 'Waiting…'));
    const timer = setInterval(async () => {
      try {
        const step = await joinerStep(call, join);
        if (step.status === 'compare') {
          $('private-body').replaceChildren(el('h2', { id: 'private-h' }, 'Compare these pictures'), el('p', {}, 'The other screen should show exactly these pictures. If it does, they will tap Approve.'), pictures(step.pictures));
        } else if (step.status === 'approved') {
          clearInterval(timer);
          const unlocked = await (await import('./vault-flows.js')).unlockKeys(call, householdId, join.device);
          await adopt(join.device, unlocked.keys, unlocked.keyId);
          close();
          toast('This device can now read private family messages.');
        } else if (step.status === 'refused' || step.status === 'expired') {
          clearInterval(timer);
          $('private-body').replaceChildren(el('h2', { id: 'private-h' }, step.status === 'refused' ? 'Not approved' : 'That took too long'), el('p', {}, 'Nothing was shared. You can try again.'), el('div', { class: 'sheet-actions' }, el('button', { class: 'pill-action dark', type: 'button', onclick: close }, 'Close')));
        }
      } catch (err) { clearInterval(timer); toast(err.message); }
    }, 2000);
    $('private-dialog').addEventListener('close', () => clearInterval(timer), { once: true });
  }

  function recoverForm() {
    const one = el('input', { autocomplete: 'off', placeholder: 'XXXXX-XXXXX-…' });
    const a = el('input', { autocomplete: 'off', placeholder: 'Sheet A' });
    const b = el('input', { autocomplete: 'off', placeholder: 'Sheet B' });
    const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const go = (useSheets) => async (e) => {
      e.preventDefault();
      try {
        const out = await recoverWithCode(call, householdId, useSheets ? { sheets: [a.value, b.value], label: deviceLabel() } : { code: one.value, label: deviceLabel() });
        await adopt(out.device, out.keys, out.keyId);
        close();
        toast('Private messages are back on this device.');
      } catch (err) { error.textContent = err.message; error.hidden = false; }
    };
    showSheet('Use the recovery kit',
      el('form', { class: 'sec-reauth', onsubmit: go(false) }, el('label', {}, 'Recovery code', one), el('button', { class: 'pill-action dark', type: 'submit' }, 'Restore')),
      el('p', { class: 'muted' }, 'Or, with two of the three family sheets:'),
      el('form', { class: 'sec-reauth', onsubmit: go(true) }, el('label', {}, 'First sheet', a), el('label', {}, 'Second sheet', b), el('button', { class: 'pill-action', type: 'submit' }, 'Restore from sheets')),
      error);
    one.focus();
  }

  async function approve(request) {
    try {
      const check = await approverBegin(call, request);
      showSheet(`${request.label || 'A device'} wants private messages`, el('p', { 'aria-live': 'polite' }, 'Checking the device…'));
      let shown = null;
      for (let i = 0; i < 60 && !shown; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        shown = await approverPictures(call, check);
      }
      if (!shown) { close(); toast('The device did not answer. Ask them to try again.'); return; }
      showSheet(`Check ${request.label || 'the new device'}`,
        el('p', {}, `Look at ${request.kind === 'tablet' ? "Aaji's Saathi screen" : 'the other screen'}. Does it show these same pictures?`),
        pictures(shown),
        el('p', { class: 'muted small' }, 'If you cannot see the other screen, call them and ask them to read the pictures out. Only approve if they match.'),
        el('div', { class: 'sheet-actions' },
          el('button', { class: 'pill-action', type: 'button', onclick: async () => { await approverDecide(call, householdId, session.keys, check, false); close(); toast('Refused. Nothing was shared.'); } }, 'Not this one'),
          el('button', { class: 'pill-action dark', type: 'button', onclick: async () => { await approverDecide(call, householdId, session.keys, check, true); close(); toast('Approved. That device can now read private messages.'); } }, 'They match')));
    } catch (err) { toast(err.message); }
  }

  let polling = null;
  function watchJoins() {
    clearInterval(polling);
    polling = setInterval(async () => {
      if (!ready() || busy || $('private-dialog').open || document.visibilityState !== 'visible') return;
      try {
        const s = await call('GET', '/api/vault');
        const waiting = s.joins.find((j) => j.status === 'waiting');
        if (waiting) await approve(waiting);
      } catch { }
    }, 4000);
  }

  async function rotate(remove = []) {
    try {
      busy = true;
      const epoch = await rotateFamilyKey(call, householdId, session.keys, { remove });
      toast(`New family key made (version ${epoch}). Removed devices cannot read anything new.`);
      await load();
      onChange();
      rerender?.();
    } catch (err) { toast(err.message); } finally { busy = false; }
  }

  function block(renderAgain) {
    rerender = renderAgain;
    const rows = [];
    if (!state?.ready) {
      rows.push(el('p', { class: 'muted small' }, 'Lock voice notes, photos and private messages on your own devices, so Saathi itself cannot open them.'));
      rows.push(isOwner() ? el('div', { class: 'sheet-actions' }, el('button', { class: 'pill-action', type: 'button', onclick: turnOn }, 'Turn on private messages')) : el('p', { class: 'muted small' }, 'Ask the person who set up Saathi to turn this on.'));
    } else if (session?.locked) {
      rows.push(el('p', { class: 'muted small' }, 'Private messages are locked on this device.'));
      rows.push(el('div', { class: 'sheet-actions' }, el('button', { class: 'pill-action', type: 'button', onclick: async () => { try { await unlock(); renderAgain(); } catch (err) { toast(err.message); } } }, 'Unlock with fingerprint or face')));
    } else if (!ready()) {
      rows.push(el('p', { class: 'muted small' }, 'Your family uses private messages. This device cannot read them yet.'));
      rows.push(el('div', { class: 'sheet-actions' },
        el('button', { class: 'text-action', type: 'button', onclick: recoverForm }, 'Use the recovery kit'),
        el('button', { class: 'pill-action', type: 'button', onclick: () => joinThisDevice().catch((err) => toast(err.message)) }, 'Use them on this device')));
    } else {
      rows.push(el('p', { class: 'sec-badge ok' }, `✓ Private messages are on for this device. Family key version ${state.epoch}.`));
      const list = el('ul', { class: 'device-list' });
      verifyDevices(householdId, session.keys, state.devices).then(({ good, bad }) => {
        const icon = { browser: '💻', tablet: '📟', recovery: '🗝️' };
        list.replaceChildren(...[...good.map((d) => ({ ...d, ok: true })), ...bad.map((d) => ({ ...d, ok: false }))].map((d) => el('li', {},
          el('span', {}, `${icon[d.kind] ?? ''} `, el('strong', {}, d.label), d.mine ? ' · this device' : '', d.ok ? '' : ' · ⚠ never approved by your family', el('br'), el('span', { class: 'muted small' }, d.owner ?? (d.kind === 'tablet' ? 'Saathi screen' : ''))),
          isOwner() && !d.mine && d.kind !== 'recovery' ? el('button', { class: 'text-action', type: 'button', onclick: () => rotate([d.id]).then(renderAgain) }, 'Remove') : null)));
      });
      rows.push(list);
      const actions = [];
      if (prfSupported() && session.mode !== 'prf') {
        actions.push(el('button', { class: 'text-action', type: 'button', onclick: async () => {
          try {
            const passkeys = (await call('GET', '/api/security')).passkeys.map((p) => p.id);
            if (!passkeys.length) return toast('Add a passkey first, then you can lock private messages with it.');
            await lockWithPasskey(householdId, who, session.device, passkeys);
            session.mode = 'prf';
            toast('Done. Private messages on this device now need your fingerprint or face after each restart.');
            renderAgain();
          } catch (err) { toast(err.message); }
        } }, 'Lock with fingerprint or face'));
      }
      if (isOwner()) {
        actions.push(el('button', { class: 'text-action', type: 'button', onclick: async () => { try { recoverySheet(await replaceRecoveryKit(call, householdId, session.keys, { split: confirm('Make 3 sheets for 3 relatives instead of one code?') })); } catch (err) { toast(err.message); } } }, 'New recovery kit'));
        actions.push(el('button', { class: 'text-action', type: 'button', onclick: () => rotate().then(renderAgain) }, 'Change the family key now'));
      }
      rows.push(el('div', { class: 'sheet-actions' }, ...actions));
    }
    return el('section', { class: 'sec-block' }, el('h3', { class: 'devices-h' }, 'Private messages'), ...rows);
  }

  async function encrypt(kind, bytes) {
    if (!ready()) return null;
    const itemId = b64u(random(18));
    return { itemId, blob: await seal(householdId, session.keys, kind, itemId, bytes) };
  }

  async function decrypt(kind, itemId, blob) {
    if (!ready()) return null;
    return open(householdId, session.keys, kind, itemId, blob);
  }

  async function decryptUrl(kind, itemId, url, mediaType) {
    if (!ready()) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const plain = await decrypt(kind, itemId, new Uint8Array(await res.arrayBuffer()));
    return URL.createObjectURL(new Blob([plain], { type: mediaType }));
  }

  async function removeOwners(emails) {
    if (!ready() || !emails?.length) return;
    const fresh = await call('GET', '/api/vault');
    const ids = fresh.devices.filter((d) => d.owner && emails.includes(d.owner)).map((d) => d.id);
    if (ids.length) await rotate(ids);
  }

  return {
    load, ready, unlock, block, watchJoins, rotate, encrypt, decrypt, decryptUrl, removeOwners,
    hasRecord: () => readRecord(householdId, who).then(Boolean),
    sealText: async (value) => {
      const out = await encrypt('message', utf8(value));
      if (!out) return null;
      let bin = '';
      for (let i = 0; i < out.blob.length; i += 0x8000) bin += String.fromCharCode(...out.blob.subarray(i, i + 0x8000));
      return { itemId: out.itemId, blob: btoa(bin) };
    },
    openText: async (itemId, b64) => text(await decrypt('message', itemId, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))),
    toBase64: (bytes) => b64u(bytes),
    fromBase64: unb64u,
  };
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const what = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux computer' : 'Browser';
  return `${what}, ${new Date().toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}
