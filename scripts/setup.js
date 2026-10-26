import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
const current = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"(.*)"$/, '$1')]))
  : {};
const values = { ...current };

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let muted = false;
rl._writeToOutput = function write(text) { rl.output.write(muted && !/[\r\n]/.test(text) ? '*'.repeat(text.length) : text); };
const queue = [];
const waiting = [];
rl.on('line', (line) => { muted = false; if (waiting.length) waiting.shift()(line); else queue.push(line); });
rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
const nextLine = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiting.push(resolve)));
const ask = async (q, { secret = false, fallback = '' } = {}) => {
  process.stdout.write(`${q}${fallback && !secret ? ` [${fallback}]` : ''}: `);
  muted = secret && Boolean(process.stdin.isTTY);
  const answer = (await nextLine()).trim();
  if (!process.stdin.isTTY) process.stdout.write(secret ? '\n' : `${answer}\n`);
  return answer || fallback;
};
const choose = async (q, options) => {
  console.log(`\n${q}`);
  options.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
  const n = Number(await ask('Choose a number', { fallback: '1' }));
  return Number.isInteger(n) && n >= 1 && n <= options.length ? n : 1;
};
const unset = (...keys) => keys.forEach((k) => delete values[k]);

console.log('\n  Saathi setup. Press Enter to keep what is shown in [brackets].\n');

const mail = await choose('How should Saathi send email (invites and alerts)?', [
  'From a Gmail account (easiest)',
  'Amazon SES',
  'Another email provider (SMTP)',
  'Not now (emails are printed in the terminal)',
]);
if (mail === 1) {
  console.log('\n  Gmail needs an "app password", not your normal password:');
  console.log('  1. Turn on 2-Step Verification: https://myaccount.google.com/signinoptions/two-step-verification');
  console.log('  2. Make an app password:       https://myaccount.google.com/apppasswords  (name it "Saathi")');
  console.log('  3. Paste the 16 letters below.\n');
  unset('SAATHI_MAIL', 'SAATHI_SMTP_URL');
  values.SAATHI_GMAIL_USER = await ask('Gmail address', { fallback: current.SAATHI_GMAIL_USER ?? '' });
  const pass = await ask('App password (hidden)', { secret: true });
  if (pass) values.SAATHI_GMAIL_APP_PASSWORD = pass.replace(/\s+/g, '');
} else if (mail === 2) {
  unset('SAATHI_GMAIL_USER', 'SAATHI_GMAIL_APP_PASSWORD', 'SAATHI_SMTP_URL');
  values.SAATHI_MAIL = 'ses';
  console.log('\n  The sender address (or its domain) must be verified in Amazon SES. AWS credentials come from your usual AWS setup.');
  values.SAATHI_MAIL_FROM = await ask('Send from', { fallback: current.SAATHI_MAIL_FROM ?? '' });
  values.AWS_REGION = await ask('AWS region', { fallback: current.AWS_REGION ?? 'us-east-1' });
} else if (mail === 3) {
  unset('SAATHI_GMAIL_USER', 'SAATHI_GMAIL_APP_PASSWORD', 'SAATHI_MAIL');
  console.log('\n  Example: smtps://user:password@smtp.example.com:465');
  const url = await ask('SMTP URL (hidden)', { secret: true });
  if (url) values.SAATHI_SMTP_URL = url;
  values.SAATHI_MAIL_FROM = await ask('Send from', { fallback: current.SAATHI_MAIL_FROM ?? '' });
}

const google = await choose('Let people sign in with Google (and send invites from their own Gmail)?', ['Yes', 'No / keep what I have']);
if (google === 1) {
  const port = values.PORT ?? '8787';
  const site = values.SAATHI_PUBLIC_URL ?? `http://localhost:${port}`;
  console.log('\n  1. Open https://console.cloud.google.com/apis/credentials and create a project if asked.');
  console.log('  2. "Configure consent screen": External, add your email as a test user.');
  console.log('  3. "Create credentials" > "OAuth client ID" > "Web application".');
  console.log(`  4. Under "Authorized redirect URIs" add:  ${site}/auth/google/callback`);
  console.log('  5. For "Send from my Gmail", also enable the Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com\n');
  values.SAATHI_GOOGLE_CLIENT_ID = await ask('Client ID', { fallback: current.SAATHI_GOOGLE_CLIENT_ID ?? '' });
  const secret = await ask('Client secret (hidden)', { secret: true });
  if (secret) values.SAATHI_GOOGLE_CLIENT_SECRET = secret;
}

const url = await ask('\nPublic address, if you use a tunnel or a domain (leave empty for this computer only)', { fallback: current.SAATHI_PUBLIC_URL ?? '' });
if (url) values.SAATHI_PUBLIC_URL = url.replace(/\/+$/, ''); else unset('SAATHI_PUBLIC_URL');

rl.close();
const lines = ['# Written by npm run setup. Keep this file private.', ...Object.entries(values).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${/[\s#"'=]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v}`)];
writeFileSync(envFile, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`\n  Saved to ${envFile}`);
console.log('  Now run:  npm start\n');
