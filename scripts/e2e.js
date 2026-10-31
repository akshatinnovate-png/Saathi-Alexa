import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = Number(process.env.E2E_PORT ?? 8798);
const B = `http://localhost:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'saathi-e2e-'));

const server = spawn(process.execPath, ['src/index.js'], {
  env: { ...process.env, SAATHI_DEMO: 'true', SAATHI_BREACH_CHECK: 'off', SAATHI_METRICS: 'off', PORT: String(PORT), SAATHI_DATA_FILE: join(dir, 'demo.json'), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${B}/healthz`)).ok) break; } catch { }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH || existsSync(LOCAL_CHROMIUM) ? { executablePath: process.env.CHROME_PATH || LOCAL_CHROMIUM } : { channel: 'chrome' }),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

let failures = 0;
const errors = [];
let lastStep = 'start';
let auditing = false;
const fromAxe = (text) => auditing && /inline style/.test(text);
const ok = (cond, label) => { lastStep = label; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag} (after "${lastStep}"): ${e.message}`));
  page.on('requestfailed', (r) => { if (/\/vendor\/|\.(css|js|woff2?)(\?|$)/.test(r.url())) errors.push(`${tag} (after "${lastStep}"): failed to load ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !fromAxe(m.text()) && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${tag} (after "${lastStep}"): ${m.text().slice(0, 160)}`); });
};
async function axe(page, selector, label) {
  auditing = true;
  await page.evaluate(axeSource);
  const r = await page.evaluate((sel) => globalThis.axe.run(sel ? document.querySelector(sel) : document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }), selector);
  await page.waitForTimeout(300);
  auditing = false;
  ok(r.violations.length === 0, `${label}: accessible${r.violations.length ? ` (${r.violations.map((v) => v.id).join(', ')})` : ''}`);
}
async function signIn(page, email) {
  await page.goto(`${B}/login.html`);
  await page.fill('#email', email);
  await page.fill('#password', 'saathi-demo-2026');
  await page.click('#auth-submit');
  await page.waitForURL(/family/);
  await page.waitForTimeout(1200);
}

try {
  const famCtx = await browser.newContext({ permissions: ['microphone'] });
  const fam = await famCtx.newPage();
  watch(fam, 'family');
  const cdp = await famCtx.newCDPSession(fam);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  await signIn(fam, 'riya@saathi.demo');

  await fam.click('#open-security');
  await fam.waitForSelector('#security-body >> text=Add a passkey');
  const loaded = await fam.evaluate(async () => { await document.fonts.ready; return [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', '')))]; });
  ok(loaded.includes('Inter') && loaded.includes('Newsreader Variable'), `fonts load from Saathi itself, not from Google (${loaded.join(', ')})`);
  await fam.click('#security-body >> text=Add a passkey');
  await fam.waitForFunction(() => document.getElementById('toast').textContent.includes('Passkey added'), null, { timeout: 15000 });
  await fam.click('#security-body >> text=Turn on private messages');
  await fam.click('#private-body >> text=One recovery code for me');
  await fam.waitForSelector('.recovery-code');
  await axe(fam, '#private-dialog', 'recovery kit dialog');
  const code = (await fam.textContent('.recovery-code')).trim();
  await fam.fill('#private-body input', 'WRONG');
  await fam.click('#private-body button[type=submit]');
  ok(await fam.isVisible('#private-body .form-error'), 'a wrong check of the recovery code is refused');
  await fam.fill('#private-body input', code.split('-').filter((g) => g.length === 5).at(-1));
  await fam.click('#private-body button[type=submit]');
  await fam.waitForSelector('#security-body >> text=Private messages are on for this device', { timeout: 10000 });
  ok(true, 'the owner turned on private messages');
  await fam.click('#security-dialog >> text=Done');

  await fam.click('#open-devices');
  await fam.waitForTimeout(800);
  const pairCode = (await fam.textContent('#pair-code')).replace(/\D/g, '');
  await fam.click('#device-close');
  const tabCtx = await browser.newContext();
  await tabCtx.addInitScript(() => { try { localStorage.setItem('saathi-settings', JSON.stringify({ voice: false, language: 'en', large: true })); } catch { } });
  const tab = await tabCtx.newPage();
  watch(tab, 'tablet');
  await tab.goto(`${B}/device.html?code=${pairCode}`);
  await tab.waitForSelector('#dev-wait:not([hidden])');
  await fam.waitForSelector('#approve-dialog[open]', { timeout: 10000 });
  await fam.click('#approve-yes');
  await tab.waitForURL(/alexa/, { timeout: 15000 });

  await fam.waitForSelector('#private-dialog[open] .approve-emoji', { timeout: 30000 });
  await tab.waitForFunction(() => !document.getElementById('private-join-emoji').hidden, null, { timeout: 20000 });
  const famPics = (await fam.textContent('#private-body .approve-emoji')).trim();
  const tabPics = (await tab.textContent('#private-join-emoji')).trim();
  ok(famPics === tabPics && famPics.length > 0, `both screens show the same pictures (${famPics})`);
  await axe(fam, '#private-dialog', 'family picture check');
  await axe(tab, '#private-join', 'tablet picture screen');
  await fam.click('#private-body button.pill-action.dark');
  await tab.waitForFunction(() => !document.getElementById('private-join').open, null, { timeout: 20000 });
  ok(true, "Aaji's tablet received the family key after approval");

  await fam.click('a[data-nav="messages"]');
  await fam.waitForSelector('#compose-private-row:not([hidden])');
  await fam.check('#compose-private');
  await fam.fill('#compose-text', 'Aaji, this is private: Kabir got the job!');
  await fam.click('#compose button[type=submit]');
  await fam.waitForSelector('#thread >> text=Kabir got the job', { timeout: 8000 });
  await fam.click('#record');
  await fam.waitForTimeout(1500);
  await fam.click('#record');
  await fam.waitForSelector('#record-status >> text=Sent privately', { timeout: 10000 });
  const serverCopy = await tab.evaluate(async () => (await (await fetch('/api/family/messages')).json()).slice(0, 2));
  ok(serverCopy.every((m) => m.e2e && !JSON.stringify(m).includes('Kabir')), 'the server holds only ciphertext for the private message and voice note');

  await tab.fill('#talk-input', 'Any messages for me?');
  await tab.evaluate(() => document.getElementById('talk-form').requestSubmit());
  const shown = await tab.waitForFunction(() => document.getElementById('alexa-said').textContent.includes('Kabir got the job'), null, { timeout: 60000 }).then(() => true).catch(() => false);
  ok(shown, "Aaji's tablet decrypts and shows the private message");

  await fam.click('#open-security');
  await fam.waitForSelector('#security-body >> text=Lock with fingerprint or face');
  await fam.click('#security-body >> text=Lock with fingerprint or face');
  await fam.waitForFunction(() => document.getElementById('toast').textContent.includes('after each restart'), null, { timeout: 15000 });
  await fam.reload();
  await fam.waitForTimeout(1500);
  await fam.click('#open-security');
  await fam.waitForSelector('#security-body >> text=Unlock with fingerprint or face');
  ok(true, 'after a restart, private messages stay locked until the passkey unlocks them');
  await fam.click('#security-body >> text=Unlock with fingerprint or face');
  await fam.waitForSelector('#security-body >> text=Private messages are on for this device', { timeout: 15000 });
  ok(true, 'the passkey (PRF) unlocks private messages');
} catch (err) {
  ok(false, `unexpected: ${err.message.split('\n')[0]}`);
} finally {
  ok(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  server.kill();
  if (failures) {
    console.log(serverLog.slice(-2000));
    process.exit(1);
  }
}
