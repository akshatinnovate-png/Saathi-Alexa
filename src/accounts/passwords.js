import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const CURRENT = { N: 32768, r: 8, p: 1 };
const MAXMEM = 128 * 1024 * 1024;
let pepper = null;

const COMMON = new Set([
  'password1', 'password12', 'password123', 'password1234', 'passw0rd123', '1234567890', '12345678910', 'qwerty1234', 'qwertyuiop1', 'iloveyou12',
  'welcome123', 'admin12345', 'letmein123', 'abc1234567', 'monkey1234', 'dragon1234', 'football12', 'baseball12', 'sunshine12', 'princess12',
  'saathi1234', 'saathi12345', 'alexa12345', 'india12345', 'mumbai1234', 'pune123456', 'delhi12345', 'aaji123456', 'family1234', 'mother1234',
  'qwerty12345', '1q2w3e4r5t', 'zaq12wsxcde', 'asdfghjkl1', 'changeme12', 'trustno1234', 'superman12', 'starwars12', 'whatever12', 'computer12',
]);

export function configurePepper(key) {
  if (!key) pepper = null;
  else if (typeof key === 'function') pepper = key;
  else {
    const material = Buffer.from(key);
    pepper = async (data) => createHmac('sha256', material).update(data).digest();
  }
}

const prepare = async (password) => (pepper ? Buffer.from(await pepper(Buffer.from(String(password), 'utf8'))) : Buffer.from(String(password), 'utf8'));

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(await prepare(password), salt, 32, { ...CURRENT, maxmem: MAXMEM });
  return `scrypt2$${pepper ? 'p1' : 'p0'}$${CURRENT.N}$${CURRENT.r}$${CURRENT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function check(input, salt, expected, params) {
  const key = await scrypt(input, salt, expected.length, { ...params, maxmem: MAXMEM });
  return timingSafeEqual(key, expected);
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts[0] === 'scrypt2') {
    const [, peppered, N, r, p, salt, hash] = parts;
    if (peppered === 'p1' && !pepper) return { ok: false, needsRehash: false };
    const input = peppered === 'p1' ? await prepare(password) : Buffer.from(String(password), 'utf8');
    const ok = await check(input, Buffer.from(salt, 'base64url'), Buffer.from(hash, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) });
    return { ok, needsRehash: ok && (Number(N) < CURRENT.N || (peppered === 'p0' && Boolean(pepper))) };
  }
  if (parts[0] === 'scrypt') {
    const [, n, salt, hash] = parts;
    const ok = await check(Buffer.from(String(password), 'utf8'), Buffer.from(salt, 'base64url'), Buffer.from(hash, 'base64url'), { N: Number(n), r: 8, p: 1 });
    return { ok, needsRehash: ok };
  }
  return { ok: false, needsRehash: false };
}

let dummy = null;
export async function burnEqualTime(password) {
  dummy ??= await hashPassword(randomBytes(12).toString('base64url'));
  await verifyPassword(password, dummy);
}

export function passwordProblem(password, { email = '', name = '' } = {}) {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'Use at most 200 characters.';
  if (!/[\p{L}]/u.test(password) || !/[0-9]/.test(password)) return 'Use letters and at least one number.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Try a short sentence with a number in it.';
  if (/^(.)\1+$/.test(password.replace(/\d/g, ''))) return 'That password is too easy to guess.';
  const address = String(email).toLowerCase();
  if (address.length >= 3 && lower.includes(address)) return "Don't use your email address in your password.";
  const local = address.split('@')[0];
  if (local.length >= 4 && lower.includes(local)) return "Don't use your email address in your password.";
  const first = String(name).toLowerCase().split(/\s+/)[0];
  if (first.length >= 4 && lower.includes(first)) return "Don't use your name in your password.";
  return null;
}

export function createBreachCheck({ fetchImpl = fetch, timeoutMs = 2500, log = console } = {}) {
  return async function timesBreached(password) {
    const digest = createHash('sha1').update(String(password), 'utf8').digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'Saathi-password-check' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return 0;
      for (const line of (await res.text()).split('\n')) {
        const [rest, count] = line.trim().split(':');
        if (rest === suffix) return Number(count) || 0;
      }
      return 0;
    } catch (err) {
      log.warn?.(`breached-password check skipped: ${err.message}`);
      return 0;
    }
  };
}
