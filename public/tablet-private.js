import { beginJoin, joinerStep, unlockKeys, open } from './vault-flows.js';
import { text } from './vault-crypto.js';
import { saveDevice, privateKeys, rememberSession, forget } from './vault-device.js';

const $ = (id) => document.getElementById(id);

async function call(method, path, body) {
  const res = await fetch(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'Something went wrong.'), { status: res.status });
  return json;
}

export function createTabletPrivate({ householdId, deviceId, language }) {
  const who = `device:${deviceId}`;
  let session = null;
  let joining = false;

  const dialog = () => $('private-join');
  function show(title, emoji = null, note = '') {
    $('private-join-title').textContent = title;
    $('private-join-emoji').textContent = emoji ? emoji.join(' ') : '';
    $('private-join-emoji').setAttribute('aria-label', emoji ? `Pictures: ${emoji.join(', ')}` : '');
    $('private-join-emoji').hidden = !emoji;
    $('private-join-note').textContent = note;
    if (!dialog().open) dialog().showModal();
  }

  async function join() {
    if (joining) return;
    joining = true;
    try {
      const j = await beginJoin(call, { label: 'Saathi screen' });
      show('Getting the family key', null, 'Someone in the family will be asked to check this screen.');
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const step = await joinerStep(call, j);
        if (step.status === 'compare') show('Show these pictures to your family', step.pictures, 'They will tap Approve when their screen shows the same pictures.');
        if (step.status === 'approved') {
          const unlocked = await unlockKeys(call, householdId, j.device);
          await saveDevice(householdId, who, j.device, unlocked.keyId);
          session = { ...unlocked, device: j.device };
          rememberSession(householdId, who, session);
          dialog().close();
          return true;
        }
        if (step.status === 'refused' || step.status === 'expired') { dialog().close(); return false; }
      }
      dialog().close();
      return false;
    } finally {
      joining = false;
    }
  }

  async function start() {
    let state;
    try { state = await call('GET', '/api/vault'); } catch { return; }
    if (!state.ready) return;
    try {
      const s = await privateKeys(call, householdId, who);
      if (s && !s.locked) { session = s; return; }
    } catch (err) {
      if (err.status === 403) await forget(householdId, who);
    }
    if (!state.devices.some((d) => d.deviceId === deviceId)) join().catch(() => {});
  }

  async function decryptUrl(note) {
    if (!session) return null;
    const res = await fetch(note.url);
    if (!res.ok) return null;
    const plain = await open(householdId, session.keys, 'voice', note.e2e.itemId, new Uint8Array(await res.arrayBuffer()));
    return URL.createObjectURL(new Blob([plain], { type: note.e2e.mediaType }));
  }

  async function translateLocally(value, from, to) {
    if (!from || !to || from === to || !('Translator' in globalThis)) return { text: value, translated: false };
    try {
      const ability = await globalThis.Translator.availability({ sourceLanguage: from, targetLanguage: to });
      if (ability === 'unavailable') return { text: value, translated: false };
      const translator = await globalThis.Translator.create({ sourceLanguage: from, targetLanguage: to });
      return { text: await translator.translate(value), translated: true };
    } catch {
      return { text: value, translated: false };
    }
  }

  async function readPrivate(item) {
    if (!session) return null;
    const raw = Uint8Array.from(atob(item.e2e.blob), (c) => c.charCodeAt(0));
    const original = text(await open(householdId, session.keys, 'message', item.e2e.itemId, raw));
    const out = await translateLocally(original, item.language, language());
    return { from: item.from, original, text: out.text, translated: out.translated };
  }

  function speakLocally(value, lang) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in globalThis)) return resolve();
      const u = new SpeechSynthesisUtterance(value);
      u.lang = lang;
      u.rate = 0.85;
      u.onend = resolve;
      u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }

  return { start, join, ready: () => Boolean(session), decryptUrl, readPrivate, speakLocally };
}
