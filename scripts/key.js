import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import '../src/env.js';
import { config } from '../src/config.js';
import { findBroker } from '../src/security/keyring.js';

const command = process.argv[2] ?? 'status';
const dir = dirname(config.dataFile);
const broker = findBroker();

if (!broker) {
  console.error('\n  The Saathi key broker is not installed, so the key cannot be locked into this computer.');
  console.error('  The Windows installer includes it. On other systems: cargo build --release -p saathi-broker --features tpm\n');
  process.exit(1);
}

const run = (...args) => {
  try {
    return JSON.parse(execFileSync(broker, [...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, TSS2_LOG: 'all+NONE' } }).trim());
  } catch (err) {
    const out = String(err.stdout ?? '').trim();
    try { return JSON.parse(out); } catch { return { error: err.message }; }
  }
};

const rl = createInterface({ input: process.stdin, terminal: false });
const lines = [];
const waiting = [];
let closed = false;
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(''); });
const ask = (q) => {
  process.stdout.write(q);
  if (lines.length) return Promise.resolve(lines.shift().trim());
  if (closed) return Promise.resolve('');
  return new Promise((resolve) => waiting.push((line) => resolve(String(line).trim())));
};
const say = (...lines) => console.log(lines.map((l) => `  ${l}`).join('\n'));

const LABEL = {
  tpm: "locked inside this computer's security chip (TPM)",
  'windows-protected': 'protected by your Windows account',
  file: 'stored in a file (saathi.key)',
  environment: 'given in SAATHI_MASTER_KEY',
};

try {
  if (command === 'status') {
    const s = run('status');
    say('', `Encryption key: ${LABEL[s.protection] ?? s.protection}`, `Security chip available: ${s.tpmAvailable ? 'yes' : 'no'}`, '');
    if (s.protection === 'file' && s.tpmAvailable) say('Run "npm run protect-key" to lock it into the chip.', '');
  } else if (command === 'protect') {
    say('', 'This locks Saathi\'s encryption key into this computer\'s security chip.',
      'After this, the data can only be opened on this computer, or with a recovery key that you write down now.', '');
    if ((await ask('Type yes to continue: ')).toLowerCase() !== 'yes') process.exit(0);
    const out = run('protect', '--keep-plain');
    if (out.error) throw new Error(out.error);
    say('', 'Your recovery key. Write it on paper and keep it somewhere safe, away from this computer:', '', `    ${out.recovery}`, '',
      'Without it, if this computer breaks, nobody can open the family\'s data. Not even you.', '');
    const last = out.recovery.split('-').filter((g) => g.length === 5).at(-1);
    for (let tries = 0; ; tries++) {
      const typed = (await ask(`To check you wrote it down, type the last full group (5 characters): `)).toUpperCase();
      if (typed === last) break;
      if (tries >= 4) {
        say('', 'Stopped. The key is locked into the chip, and the old key file is still there, so nothing is lost.', 'Run "npm run protect-key" again when you are ready.', '');
        process.exit(1);
      }
      say('That does not match. Look at the recovery key above and try again.');
    }
    const done = run('finish');
    if (done.error) throw new Error(done.error);
    say('', `Done. The key is now ${LABEL[out.protection]}, and the old key file was destroyed.`, `Key fingerprint: ${out.fingerprint}`, '');
  } else if (command === 'restore') {
    say('', 'Restore Saathi\'s encryption key from a recovery key.', '');
    const code = await ask('Recovery key: ');
    const out = run('restore', '--code', code);
    if (out.error) throw new Error(out.error);
    say('', `Restored. The key is ${LABEL[out.protection]}. Start Saathi again.`, '');
  } else {
    say('', 'Usage: npm run key-status | npm run protect-key | npm run restore-key', '');
    process.exit(64);
  }
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
}
