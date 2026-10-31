import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const SUITE = 'saathi-e2e-v1';
export const CONTENT_MAGIC = enc.encode('SAATHI-E2E1');
export const SAS_EMOJI = ['🐘', '🌻', '🚲', '🍎', '🌈', '🐢', '🎈', '🍪', '🦋', '🌙', '⭐', '🐟', '🍋', '🎵', '🌵', '🐝', '🍉', '🚂', '🦉', '🌼', '🐶', '🍓', '⛵', '🔔', '🐱', '🥕', '🎁', '🍄', '🐧', '🌍', '☕', '🪁'];

export const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const utf8 = (s) => enc.encode(String(s));
export const text = (b) => dec.decode(b);

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, false); return b; };
const framed = (...parts) => concat(...parts.flatMap((p) => [u32(p.length), p]));

export function b64u(bytes) {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function unb64u(str) {
  const s = atob(String(str).replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function sha256(bytes) {
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}

async function hkdf(ikm, salt, info, length = 32) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

async function aes(key, usage) {
  return subtle.importKey('raw', key, 'AES-GCM', false, [usage]);
}

export async function aeadSeal(key, plaintext, aad) {
  const iv = random(12);
  const body = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, await aes(key, 'encrypt'), plaintext));
  return concat(iv, body);
}

export async function aeadOpen(key, sealed, aad) {
  if (sealed.length < 12 + 16) throw new Error('This private item is damaged.');
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: aad, tagLength: 128 }, await aes(key, 'decrypt'), sealed.subarray(12)));
  } catch {
    throw new Error('This private item was changed, or it is not for this family.');
  }
}

export function deviceFromSeed(seed) {
  if (seed.length !== 96) throw new Error('device seed must be 96 bytes');
  const xSecret = seed.subarray(0, 32);
  const kem = ml_kem768.keygen(seed.subarray(32, 96));
  return {
    seed,
    public: { x25519: x25519.getPublicKey(xSecret), mlkem: kem.publicKey },
    secret: { x25519: xSecret, mlkem: kem.secretKey },
  };
}

export const newDevice = () => deviceFromSeed(random(96));

export const encodePublic = (pub) => ({ suite: SUITE, x25519: b64u(pub.x25519), mlkem: b64u(pub.mlkem) });

export function decodePublic(json) {
  if (json?.suite !== SUITE) throw new Error('Unknown key type.');
  const pub = { x25519: unb64u(json.x25519), mlkem: unb64u(json.mlkem) };
  if (pub.x25519.length !== 32 || pub.mlkem.length !== 1184) throw new Error('That device key is the wrong size.');
  return pub;
}

export async function keyId(pub) {
  return b64u((await sha256(framed(utf8(SUITE), pub.x25519, pub.mlkem))).subarray(0, 16));
}

async function wrapKey(sharedX, sharedK, ephPub, ct, recipient, context) {
  const transcript = await sha256(framed(utf8('saathi/wrap'), ephPub, ct, recipient.x25519, recipient.mlkem, utf8(context)));
  return hkdf(concat(sharedX, sharedK), utf8(SUITE), transcript);
}

export async function wrapFor(recipient, secret, context) {
  const eph = random(32);
  const ephPub = x25519.getPublicKey(eph);
  const sharedX = x25519.getSharedSecret(eph, recipient.x25519);
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(recipient.mlkem);
  const kek = await wrapKey(sharedX, sharedSecret, ephPub, cipherText, recipient, context);
  const sealed = await aeadSeal(kek, secret, utf8(context));
  eph.fill(0);
  return b64u(framed(ephPub, cipherText, sealed));
}

export async function unwrapWith(device, wrapped, context) {
  const raw = unb64u(wrapped);
  const parts = [];
  for (let at = 0; at < raw.length;) {
    const n = new DataView(raw.buffer, raw.byteOffset + at, 4).getUint32(0, false);
    parts.push(raw.subarray(at + 4, at + 4 + n));
    at += 4 + n;
  }
  if (parts.length !== 3) throw new Error('This key package is damaged.');
  const [ephPub, ct, sealed] = parts;
  const sharedX = x25519.getSharedSecret(device.secret.x25519, ephPub);
  const sharedK = ml_kem768.decapsulate(ct, device.secret.mlkem);
  const kek = await wrapKey(sharedX, sharedK, ephPub, ct, device.public, context);
  return aeadOpen(kek, sealed, utf8(context));
}

export const wrapContext = (householdId, epoch, deviceKeyId) => `wrap|${householdId}|${epoch}|${deviceKeyId}`;
export const contentContext = (householdId, kind, itemId) => `content|${householdId}|${kind}|${itemId}`;

async function contentKey(familyKey, epoch) {
  return hkdf(familyKey, utf8(SUITE), utf8(`saathi/content/${epoch}`));
}

export async function sealContent(familyKey, epoch, context, plaintext) {
  const header = concat(CONTENT_MAGIC, u32(epoch));
  const sealed = await aeadSeal(await contentKey(familyKey, epoch), plaintext, concat(header, utf8(context)));
  return concat(header, sealed);
}

export function contentEpoch(blob) {
  if (blob.length < CONTENT_MAGIC.length + 4 || !equal(blob.subarray(0, CONTENT_MAGIC.length), CONTENT_MAGIC)) return null;
  return new DataView(blob.buffer, blob.byteOffset + CONTENT_MAGIC.length, 4).getUint32(0, false);
}

export async function openContent(keysByEpoch, context, blob) {
  const epoch = contentEpoch(blob);
  if (epoch === null) throw new Error('This is not a private Saathi item.');
  const familyKey = keysByEpoch.get(epoch);
  if (!familyKey) throw new Error('This device does not have the key for this item yet.');
  const header = blob.subarray(0, CONTENT_MAGIC.length + 4);
  return aeadOpen(await contentKey(familyKey, epoch), blob.subarray(header.length), concat(header, utf8(context)));
}

export async function deviceCert(familyKey, epoch, householdId, id) {
  const certKey = await hkdf(familyKey, utf8(SUITE), utf8(`saathi/cert/${epoch}`));
  const key = await subtle.importKey('raw', certKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return { epoch, mac: b64u(new Uint8Array(await subtle.sign('HMAC', key, utf8(`device|${householdId}|${id}`)))) };
}

export async function checkCert(keysByEpoch, householdId, id, cert) {
  const familyKey = cert && keysByEpoch.get(Number(cert.epoch));
  if (!familyKey) return false;
  const expected = await deviceCert(familyKey, Number(cert.epoch), householdId, id);
  return equal(utf8(expected.mac), utf8(String(cert.mac)));
}

export async function commitment(pub, nonce) {
  return b64u(await sha256(framed(utf8('saathi/commit'), pub.x25519, pub.mlkem, nonce)));
}

export async function sasPictures(commit, pub, joinerNonce, approverNonce) {
  const h = await sha256(framed(utf8('saathi/sas'), utf8(commit), pub.x25519, pub.mlkem, joinerNonce, approverNonce));
  const bits = (h[0] << 16) | (h[1] << 8) | h[2];
  return [(bits >> 19) & 31, (bits >> 14) & 31, (bits >> 9) & 31].map((i) => SAS_EMOJI[i]);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function toCode(bytes) {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; out += ALPHABET[(acc >> bits) & 31]; }
    acc &= (1 << bits) - 1;
  }
  if (bits) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out.match(/.{1,5}/g).join('-');
}

function fromCode(code) {
  const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const out = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('That code has a letter that recovery codes never use.');
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    acc &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

async function withCheck(bytes) {
  return concat(bytes, (await sha256(bytes)).subarray(0, 3));
}

async function checked(bytes, length) {
  if (bytes.length < length + 3) throw new Error('That code is too short.');
  const body = bytes.subarray(0, length);
  if (!equal((await sha256(body)).subarray(0, 3), bytes.subarray(length, length + 3))) throw new Error('That code has a typo. Check each letter.');
  return body;
}

export async function newRecoverySecret() {
  const secret = random(32);
  return { secret, code: toCode(await withCheck(secret)) };
}

export async function recoverySecretFromCode(code) {
  return checked(fromCode(code), 32);
}

export async function recoveryDevice(secret, householdId) {
  return deviceFromSeed(await hkdf(secret, utf8(SUITE), utf8(`saathi/recovery-device/${householdId}`), 96));
}

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
  x &= 255;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const div = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);

export async function splitSecret(secret, shares = 3, threshold = 2) {
  const out = Array.from({ length: shares }, (_, i) => new Uint8Array(secret.length + 1).fill(0, 0).map((_, j) => (j === 0 ? i + 1 : 0)));
  for (let byte = 0; byte < secret.length; byte++) {
    const coeffs = [secret[byte], ...random(threshold - 1)];
    for (let s = 0; s < shares; s++) {
      const x = s + 1;
      let y = 0;
      for (let c = coeffs.length - 1; c >= 0; c--) y = mul(y, x) ^ coeffs[c];
      out[s][byte + 1] = y;
    }
  }
  return Promise.all(out.map(async (share) => toCode(await withCheck(share))));
}

export async function combineShares(codes) {
  const shares = await Promise.all(codes.map(async (c) => checked(fromCode(c), 33)));
  const xs = shares.map((s) => s[0]);
  if (new Set(xs).size !== xs.length) throw new Error('Two of those sheets are the same. Use two different sheets.');
  const secret = new Uint8Array(32);
  for (let byte = 0; byte < 32; byte++) {
    let y = 0;
    for (let i = 0; i < shares.length; i++) {
      let basis = 1;
      for (let j = 0; j < shares.length; j++) if (i !== j) basis = mul(basis, div(xs[j], xs[i] ^ xs[j]));
      y ^= mul(shares[i][byte + 1], basis);
    }
    secret[byte] = y;
  }
  return secret;
}
