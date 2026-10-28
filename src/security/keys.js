import { randomBytes, hkdfSync, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const SALT = Buffer.from('saathi/keyring/v1');
const STORE_MAGIC = 'SAATHI-ENC1';
const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function loadMasterKey({ keyFile, envKey } = {}) {
  if (envKey) {
    const key = Buffer.from(envKey, 'base64');
    if (key.length !== 32) throw new Error('SAATHI_MASTER_KEY must be 32 random bytes in base64 (try: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))").');
    return { key, source: 'environment' };
  }
  if (existsSync(keyFile)) {
    const key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error(`The key file ${keyFile} is damaged. Restore it from your backup; without it, the encrypted data cannot be read.`);
    return { key, source: keyFile };
  }
  mkdirSync(dirname(keyFile), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyFile, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  try { chmodSync(keyFile, 0o600); } catch { }
  return { key, source: keyFile, created: true };
}

export function deriveKey(master, purpose, length = 32) {
  return Buffer.from(hkdfSync('sha256', master, SALT, Buffer.from(`saathi/${purpose}`), length));
}

export function fingerprint(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function encrypt(key, plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), body };
}

function decrypt(key, { iv, tag, body }, aad) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function sealStore(key, json) {
  const { iv, tag, body } = encrypt(key, Buffer.from(json, 'utf8'), STORE_MAGIC);
  return `${STORE_MAGIC}\n${b64(Buffer.concat([iv, tag, body]))}\n`;
}

export function isSealedStore(text) {
  return String(text).startsWith(STORE_MAGIC);
}

export function openStore(key, text) {
  const raw = Buffer.from(String(text).slice(STORE_MAGIC.length).trim(), 'base64url');
  return decrypt(key, { iv: raw.subarray(0, 12), tag: raw.subarray(12, 28), body: raw.subarray(28) }, STORE_MAGIC).toString('utf8');
}

export function createSealer(key, { purpose = 'vault', legacy = null } = {}) {
  const aad = `saathi/${purpose}`;
  return {
    seal(plain) {
      const { iv, tag, body } = encrypt(key, Buffer.from(String(plain), 'utf8'), aad);
      return `v2.${[iv, tag, body].map(b64).join('.')}`;
    },
    open(sealed) {
      const text = String(sealed);
      if (!text.startsWith('v2.')) {
        if (!legacy) throw new Error('This value was sealed with an older key that is no longer available.');
        return legacy.open(text);
      }
      const [iv, tag, body] = text.slice(3).split('.').map((p) => Buffer.from(p, 'base64url'));
      return decrypt(key, { iv, tag, body }, aad).toString('utf8');
    },
  };
}
