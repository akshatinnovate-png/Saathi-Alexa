import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
const current = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"(.*)"$/, '$1')]))
  : {};
const values = { ...current };
const tty = Boolean(process.stdin.isTTY);

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
let muted = false;
rl._writeToOutput = function write(text) { rl.output.write(muted && !/[\r\n]/.test(text) && !text.includes(rl.getPrompt()) ? '*'.repeat(text.length) : text); };
const queue = [];
const waiting = [];
rl.on('line', (line) => { muted = false; if (waiting.length) waiting.shift()(line); else queue.push(line); });
rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
const nextLine = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiting.push(resolve)));
const ask = async (q, { secret = false, fallback = '' } = {}) => {
  const prompt = `${q}${fallback && !secret ? ` [${fallback}]` : ''}: `;
  if (tty) { rl.setPrompt(prompt); rl.prompt(); } else process.stdout.write(prompt);
  muted = secret && tty;
  const answer = (await nextLine()).trim();
  if (!tty) process.stdout.write(secret ? '\n' : `${answer}\n`);
  return answer || fallback;
};
const choose = async (q, options) => {
  console.log(`\n${q}`);
  options.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
  const n = Number(await ask('Type a number and press Enter', { fallback: '1' }));
  return Number.isInteger(n) && n >= 1 && n <= options.length ? n : 1;
};
const unset = (...keys) => keys.forEach((k) => delete values[k]);
const port = values.PORT ?? '8787';
const site = () => values.SAATHI_PUBLIC_URL ?? `http://localhost:${port}`;

console.log('\n  Saathi setup. Press Enter to keep what is shown in [brackets].');
console.log('  You do this once. Your family never sees any of it: they just tap "Continue with Google".\n');

const hasGoogle = Boolean(current.SAATHI_GOOGLE_CLIENT_ID && current.SAATHI_GOOGLE_CLIENT_SECRET);
const google = await choose('Sign in with Google (and send email from Gmail, with no passwords)?', [
  hasGoogle ? 'Keep my Google setup' : 'Yes, set it up now (about 5 minutes, once)',
  hasGoogle ? 'Change it' : 'Not now',
]);
if ((hasGoogle && google === 2) || (!hasGoogle && google === 1)) {
  console.log(`
  Open each link, signed in to your Google account:

  1. https://console.cloud.google.com/projectcreate
       Project name: Saathi  ->  Create

  2. https://console.cloud.google.com/apis/library/gmail.googleapis.com
       Enable   (this lets Saathi send invites and alerts from Gmail)

  3. https://console.cloud.google.com/auth/overview
       Get started  ->  App name: Saathi, your email  ->  Audience: External  ->  Create
       Then "Audience"  ->  Publish app  (so anyone in your family can sign in)

  4. https://console.cloud.google.com/auth/clients
       Create client  ->  Application type: Web application
       Authorized redirect URIs  ->  Add URI:  ${site()}/auth/google/callback
       Create, then copy the Client ID and Client secret below.
`);
  values.SAATHI_GOOGLE_CLIENT_ID = await ask('Client ID', { fallback: current.SAATHI_GOOGLE_CLIENT_ID ?? '' });
  const secret = await ask('Client secret (hidden)', { secret: true });
  if (secret) values.SAATHI_GOOGLE_CLIENT_SECRET = secret;
}
const googleOn = Boolean(values.SAATHI_GOOGLE_CLIENT_ID && values.SAATHI_GOOGLE_CLIENT_SECRET);

const mail = await choose('How should Saathi send email (invites and alerts)?', [
  googleOn ? "From the Gmail of whoever sets up the family (nothing to type: they tap 'Connect Gmail')" : 'Not now (invites can be shared on WhatsApp, alerts show in the app)',
  'From one Gmail account with an app password',
  'Amazon SES',
  'Another email provider (SMTP)',
]);
if (mail === 1) {
  unset('SAATHI_MAIL', 'SAATHI_SMTP_URL', 'SAATHI_GMAIL_USER', 'SAATHI_GMAIL_APP_PASSWORD');
} else if (mail === 2) {
  console.log('\n  Turn on 2-Step Verification, then make an app password at https://myaccount.google.com/apppasswords (name it "Saathi").\n');
  unset('SAATHI_MAIL', 'SAATHI_SMTP_URL');
  values.SAATHI_GMAIL_USER = await ask('Gmail address', { fallback: current.SAATHI_GMAIL_USER ?? '' });
  const pass = await ask('App password (hidden)', { secret: true });
  if (pass) values.SAATHI_GMAIL_APP_PASSWORD = pass.replace(/\s+/g, '');
} else if (mail === 3) {
  unset('SAATHI_GMAIL_USER', 'SAATHI_GMAIL_APP_PASSWORD', 'SAATHI_SMTP_URL');
  values.SAATHI_MAIL = 'ses';
  console.log('\n  The sender address (or its domain) must be verified in Amazon SES. AWS credentials come from your usual AWS setup.');
  values.SAATHI_MAIL_FROM = await ask('Send from', { fallback: current.SAATHI_MAIL_FROM ?? '' });
  values.AWS_REGION = await ask('AWS region', { fallback: current.AWS_REGION ?? 'us-east-1' });
} else {
  unset('SAATHI_GMAIL_USER', 'SAATHI_GMAIL_APP_PASSWORD', 'SAATHI_MAIL');
  console.log('\n  Example: smtps://user:password@smtp.example.com:465');
  const url = await ask('SMTP URL (hidden)', { secret: true });
  if (url) values.SAATHI_SMTP_URL = url;
  values.SAATHI_MAIL_FROM = await ask('Send from', { fallback: current.SAATHI_MAIL_FROM ?? '' });
}

const brain = await choose('Translation (so a message in English reaches them in their language)?', [
  current.ANTHROPIC_API_KEY ? 'Keep my Claude key' : 'Not now (messages stay in the language they were written in)',
  'Claude API key',
  'Amazon Web Services (Translate, Polly, Comprehend, Claude on Bedrock)',
]);
if (brain === 2) {
  console.log('\n  Get a key at https://console.anthropic.com/settings/keys\n');
  const key = await ask('Claude API key (hidden)', { secret: true });
  if (key) values.ANTHROPIC_API_KEY = key;
} else if (brain === 3) {
  console.log('\n  Uses the AWS credentials already set up on this computer (aws configure).');
  Object.assign(values, { SAATHI_AWS_TRANSLATE: 'true', SAATHI_AWS_POLLY: 'true', SAATHI_AWS_COMPREHEND: 'true', SAATHI_USE_BEDROCK: 'true' });
  values.AWS_REGION = await ask('AWS region', { fallback: values.AWS_REGION ?? 'us-east-1' });
}

rl.close();
const lines = ['# Written by npm run setup. Keep this file private.', ...Object.entries(values).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${/[\s#"'=]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v}`)];
writeFileSync(envFile, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`\n  Saved. Now run:  npm start`);
console.log(`  Then open ${site()} and tap "Continue with Google".\n`);
