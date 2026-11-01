import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = process.env.SAATHI_ENV_FILE ?? fileURLToPath(new URL('../.env', import.meta.url));
const say = (...lines) => console.log(lines.map((l) => `  ${l}`).join('\n'));
const rl = createInterface({ input: process.stdin, terminal: false });
const queued = [];
const waiting = [];
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queued.push(line)));
rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
const ask = (q) => {
  process.stdout.write(`  ${q}`);
  if (queued.length) return Promise.resolve(queued.shift().trim());
  return new Promise((resolve) => waiting.push((line) => resolve(String(line ?? '').trim())));
};

export function readEnv(text) {
  return text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.split('=')).filter((p) => p.length > 1).map(([k, ...v]) => [k.trim(), v.join('=').trim().replace(/^(['"])(.*)\1$/, '$2')]);
}

export function setEnv(text, key, value) {
  const lines = text.split(/\r?\n/).filter((l, i, all) => l.trim() || i < all.length - 1);
  const kept = lines.filter((l) => !l.trim().startsWith(`${key}=`));
  if (value !== null) kept.push(`${key}=${value}`);
  return `${kept.filter((l) => l !== '').join('\n')}\n`;
}

export function funnelAddress(status) {
  const name = status?.Self?.DNSName?.replace(/\.$/, '');
  const labels = typeof name === 'string' ? name.split('.') : [];
  if (labels.length < 3 || labels.length > 6 || labels.at(-1).toLowerCase() !== 'net' || labels.at(-2).toLowerCase() !== 'ts' || !labels.every((l) => /^[a-z0-9-]{1,63}$/i.test(l))) return null;
  return `https://${name.toLowerCase()}`;
}

const port = () => {
  const settings = existsSync(envFile) ? Object.fromEntries(readEnv(readFileSync(envFile, 'utf8'))) : {};
  return Number(settings.PORT ?? process.env.PORT ?? 8787);
};

function findTailscale() {
  const candidates = process.platform === 'win32'
    ? [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe'), 'tailscale.exe']
    : process.platform === 'darwin' ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'tailscale'] : ['tailscale'];
  for (const c of candidates) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' });
      return c;
    } catch { }
  }
  return null;
}

function findCloudflared() {
  for (const c of process.platform === 'win32' ? ['cloudflared.exe', join(process.env.ProgramFiles ?? 'C:\\Program Files', 'cloudflared', 'cloudflared.exe')] : ['cloudflared']) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch { }
  }
  return null;
}

function save(value) {
  const before = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  writeFileSync(envFile, setEnv(before, 'SAATHI_PUBLIC_URL', value), { mode: 0o600 });
}

async function tailscale() {
  const ts = findTailscale();
  if (!ts) {
    say('', 'Tailscale is not installed yet. It is free for families and gives Saathi a fixed, private https address.', '',
      process.platform === 'win32' ? '1. Install it: winget install -e --id Tailscale.Tailscale  (or download from https://tailscale.com/download)' : '1. Install it from https://tailscale.com/download',
      '2. Open Tailscale and sign in (Google, Microsoft or GitHub).', '3. Run this again.', '');
    return 1;
  }
  let status;
  try {
    status = JSON.parse(execFileSync(ts, ['status', '--json'], { encoding: 'utf8' }));
  } catch {
    say('', 'Tailscale is installed but not running. Open Tailscale, sign in, and run this again.', '');
    return 1;
  }
  if (status.BackendState !== 'Running') {
    say('', `Tailscale is ${String(status.BackendState).toLowerCase()}. Open Tailscale, sign in, and run this again.`, '');
    return 1;
  }
  const address = funnelAddress(status);
  if (!address) {
    say('', 'Tailscale did not give this computer a ts.net name. Turn on MagicDNS in the Tailscale admin page and run this again.', '');
    return 1;
  }
  say('', `Saathi will be reachable at ${address}`, 'Only signed-in family members and approved devices can use it. Everything is https.', '',
    'Tailscale may print a link to turn on "Funnel" for your account. Open it, allow it, and this continues by itself.', '');
  try {
    execFileSync(ts, ['funnel', '--bg', String(port())], { stdio: 'inherit' });
  } catch {
    say('', 'Tailscale could not open the address. If it printed a link, open it, allow Funnel, then run this again.', '');
    return 1;
  }
  save(address);
  say('', 'Done.', `Saathi's address is now ${address}`, '',
    'Restart Saathi (Stop Saathi, then open Saathi) so it uses the new address.',
    'Passkeys are tied to an address: after the restart, sign in with your password once at the new address and add a passkey again.',
    'Pair Aaji\'s tablet and set up Alexa+ with the new address too.', '');
  return 0;
}

async function cloudflare() {
  const cf = findCloudflared();
  if (!cf) {
    say('', 'cloudflared is not installed.', process.platform === 'win32' ? 'Install it: winget install -e --id Cloudflare.cloudflared' : 'Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/', '');
    return 1;
  }
  say('', 'This opens a temporary address for testing. It changes every time, so it is not for everyday use.', 'Keep this window open. Close it to close the address.', '');
  const child = spawn(cf, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port()}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let announced = false;
  const watch = (chunk) => {
    const found = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (found && !announced) {
      announced = true;
      save(found[0]);
      say(`Temporary address: ${found[0]}`, 'Restart Saathi now so it accepts this address. Run "npm run reach -- off" when you are done.', '');
    }
  };
  child.stdout.on('data', watch);
  child.stderr.on('data', watch);
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 0)));
}

async function off() {
  const ts = findTailscale();
  if (ts) {
    try { execFileSync(ts, ['funnel', 'reset'], { stdio: 'inherit' }); } catch { }
  }
  save(null);
  say('', 'Saathi is back to this computer only. Restart Saathi to finish.', '');
  return 0;
}

async function main() {
  const choice = process.argv[2];
  if (choice === 'off') return off();
  if (choice === 'cloudflare') return cloudflare();
  if (choice === 'tailscale') return tailscale();
  say('', 'Reach Saathi from anywhere', '',
    '1. Tailscale Funnel (recommended): a fixed https address, free for families',
    '2. Cloudflare quick tunnel: a temporary address for a test, no account needed',
    '3. Back to this computer only', '');
  const picked = await ask('Choose 1, 2 or 3: ');
  if (picked === '1') return tailscale();
  if (picked === '2') return cloudflare();
  if (picked === '3') return off();
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await main();
  if (process.env.SAATHI_PAUSE === '1') await ask('Press Enter to close this window. ');
  rl.close();
  process.exitCode = code;
} else {
  rl.close();
}
