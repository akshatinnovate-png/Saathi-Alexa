import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadMasterKey, deriveKey, fingerprint } from './keys.js';

const PURPOSES = new Set(['store', 'sessions', 'vault', 'pepper', 'audit', 'media', 'media-links', 'ring-webhook', 'class-b']);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXE = process.platform === 'win32' ? '.exe' : '';

export function findBroker(env = process.env) {
  const candidates = [
    env.SAATHI_BROKER,
    join(ROOT, 'bin', `saathi-broker${EXE}`),
    join(ROOT, 'target', 'release', `saathi-broker${EXE}`),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

const protectedKeyIn = (dir) => ['saathi.key.tpm', 'saathi.key.dpapi'].find((f) => existsSync(join(dir, f))) ?? null;

function inProcess(master, source) {
  const keys = new Map();
  const key = (purpose) => {
    if (!PURPOSES.has(purpose)) throw new Error(`unknown key purpose ${purpose}`);
    if (!keys.has(purpose)) keys.set(purpose, deriveKey(master, purpose));
    return keys.get(purpose);
  };
  return {
    mode: 'in-process',
    keySource: source,
    fingerprint: fingerprint(master),
    hardening: null,
    async hmac(purpose, data, { textKey = false } = {}) {
      const k = key(purpose);
      return createHmac('sha256', textKey ? k.toString('base64url') : k).update(data).digest();
    },
    async seal(purpose, data, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key(purpose), iv);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(data), cipher.final()]);
      return { iv, tag: cipher.getAuthTag(), body };
    },
    async open(purpose, { iv, tag, body }, aad) {
      const decipher = createDecipheriv('aes-256-gcm', key(purpose), iv);
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    },
    close() {},
  };
}

function viaBroker(bin, dir, { onExit, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['serve', '--dir', dir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...env, TSS2_LOG: 'all+NONE' },
    });
    let buf = Buffer.alloc(0);
    let ready = null;
    let nextId = 1;
    let closing = false;
    const pending = new Map();
    const fail = (err) => {
      for (const { reject: r } of pending.values()) r(err);
      pending.clear();
    };
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.on('error', (err) => { if (!ready) reject(err); fail(err); });
    child.on('exit', (code) => {
      const err = new Error(`The Saathi key broker stopped (code ${code}). ${stderr.trim()}`.trim());
      if (!ready) reject(err);
      fail(err);
      if (ready && !closing) onExit?.(err);
    });
    child.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const n = buf.readUInt32LE(0);
        if (buf.length < 4 + n) break;
        const msg = JSON.parse(buf.subarray(4, 4 + n).toString('utf8'));
        buf = buf.subarray(4 + n);
        if (!ready) {
          if (!msg.ready) { reject(new Error(`The Saathi key broker could not open the key: ${msg.error}`)); child.kill(); return; }
          ready = msg;
          resolve(api);
          continue;
        }
        const waiter = pending.get(msg.id);
        if (!waiter) continue;
        pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error));
        else waiter.resolve(msg);
      }
    });
    const call = (request) => new Promise((res, rej) => {
      if (child.exitCode !== null) return rej(new Error('The Saathi key broker is not running.'));
      const id = nextId++;
      pending.set(id, { resolve: res, reject: rej });
      const body = Buffer.from(JSON.stringify({ id, ...request }));
      const head = Buffer.alloc(4);
      head.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([head, body]));
    });
    const b64 = (b) => Buffer.from(b).toString('base64');
    const api = {
      mode: 'broker',
      get keySource() { return ready.keySource; },
      get fingerprint() { return ready.fingerprint; },
      get hardening() { return ready.hardening; },
      async hmac(purpose, data, { textKey = false } = {}) {
        return Buffer.from((await call({ op: 'hmac', purpose, data: b64(data), textKey })).mac, 'base64');
      },
      async seal(purpose, data, aad) {
        const out = await call({ op: 'seal', purpose, data: b64(data), aad: String(aad) });
        return { iv: Buffer.from(out.iv, 'base64'), tag: Buffer.from(out.tag, 'base64'), body: Buffer.from(out.body, 'base64') };
      },
      async open(purpose, { iv, tag, body }, aad) {
        const out = await call({ op: 'open', purpose, iv: b64(iv), tag: b64(tag), body: b64(body), aad: String(aad) });
        return Buffer.from(out.data, 'base64');
      },
      close() { closing = true; child.stdin.end(); },
    };
  });
}

export async function openKeyring({ dataDir, env = process.env, broker = findBroker(env), onBrokerExit } = {}) {
  const sealedFile = protectedKeyIn(dataDir);
  if (broker && env.SAATHI_KEYRING !== 'in-process') {
    return viaBroker(broker, dataDir, { onExit: onBrokerExit, env });
  }
  if (sealedFile) {
    throw new Error(`The encryption key is locked inside this computer's security chip (${sealedFile}), and the Saathi key broker was not found. Reinstall Saathi, or set SAATHI_BROKER to the saathi-broker program.`);
  }
  const master = loadMasterKey({ keyFile: join(dataDir, 'saathi.key'), envKey: env.SAATHI_MASTER_KEY });
  const ring = inProcess(master.key, master.source === 'environment' ? 'environment' : 'file');
  ring.created = Boolean(master.created);
  return ring;
}

export function keyringFromMaster(master) {
  return inProcess(Buffer.from(master), 'test');
}

export const sameBytes = (a, b) => a.length === b.length && timingSafeEqual(a, b);
