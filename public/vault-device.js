import { deviceFromSeed, random, b64u, unb64u, concat } from './vault-crypto.js';
import { unlockKeys } from './vault-flows.js';

const DB = 'saathi-vault';
const STORE = 'devices';
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const t = conn.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { conn.close(); resolve(out?.result ?? out); };
    t.onerror = () => { conn.close(); reject(t.error); };
  });
}

const slot = (householdId, who) => `${householdId}|${who}`;

export async function readRecord(householdId, who) {
  try { return await tx('readonly', (s) => s.get(slot(householdId, who))); } catch { return null; }
}

async function writeRecord(record) {
  await tx('readwrite', (s) => s.put(record));
}

export async function forget(householdId, who) {
  await tx('readwrite', (s) => s.delete(slot(householdId, who)));
}

async function sealWith(key, data) {
  const iv = random(12);
  return { iv, body: new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, data)) };
}

async function prfKey(prfOutput) {
  const base = await subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('saathi-e2e-v1'), info: enc.encode('saathi/device-seal') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function prfSupported() {
  return Boolean(globalThis.PublicKeyCredential && globalThis.isSecureContext);
}

async function evaluatePrf(credentialIds, salt) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: credentialIds.map((id) => ({ id: unb64u(id), type: 'public-key' })),
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const out = cred?.getClientExtensionResults?.().prf?.results?.first;
  if (!out) throw new Error('This passkey cannot lock private messages. Try another passkey, or keep the normal lock.');
  return { credentialId: b64u(new Uint8Array(cred.rawId)), output: new Uint8Array(out) };
}

export async function saveDevice(householdId, who, device, keyId) {
  const wrapKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const sealed = await sealWith(wrapKey, device.seed);
  await writeRecord({ id: slot(householdId, who), householdId, who, keyId, mode: 'local', wrapKey, iv: sealed.iv, body: sealed.body, savedAt: Date.now() });
}

export async function lockWithPasskey(householdId, who, device, credentialIds) {
  const salt = random(32);
  const prf = await evaluatePrf(credentialIds, salt);
  const key = await prfKey(prf.output);
  const sealed = await sealWith(key, device.seed);
  const record = await readRecord(householdId, who);
  await writeRecord({ ...record, mode: 'prf', wrapKey: null, prf: { credentialId: prf.credentialId, salt }, iv: sealed.iv, body: sealed.body });
}

export async function loadDevice(householdId, who) {
  const record = await readRecord(householdId, who);
  if (!record) return null;
  let key = record.wrapKey;
  if (record.mode === 'prf') key = await prfKey((await evaluatePrf([record.prf.credentialId], record.prf.salt)).output);
  const seed = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, key, record.body));
  return { device: deviceFromSeed(seed), keyId: record.keyId, mode: record.mode };
}

const sessions = new Map();

export async function privateKeys(call, householdId, who, { interactive = false } = {}) {
  const id = slot(householdId, who);
  if (sessions.has(id)) return sessions.get(id);
  const record = await readRecord(householdId, who);
  if (!record) return null;
  if (record.mode === 'prf' && !interactive) return { locked: true };
  const loaded = await loadDevice(householdId, who);
  const unlocked = await unlockKeys(call, householdId, loaded.device);
  const session = { ...unlocked, device: loaded.device, mode: loaded.mode };
  sessions.set(id, session);
  return session;
}

export function rememberSession(householdId, who, session) {
  sessions.set(slot(householdId, who), session);
}

export function lockNow() {
  sessions.clear();
}

export { concat };
