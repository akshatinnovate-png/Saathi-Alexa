import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { config } from '../src/config.js';
import { createServices } from '../src/services.js';
import { createApp } from '../src/http/app.js';
import { createAlexaSimulator } from '../src/agent/alexaSimulator.js';
import { createFamilyAssistant } from '../src/agent/familyAssistant.js';
import { createFileStore } from '../src/local/fileStore.js';
import { seedData } from '../src/domain/seed.js';
import { createDidis } from '../src/didis/didis.js';
import { createImpact } from '../src/domain/impact.js';
import { createScan } from '../src/features/scan.js';
import { createDoctorNotes } from '../src/features/doctorNotes.js';
import { createHaq } from '../src/features/haq.js';
import { createSangat } from '../src/features/sangat.js';
import { createRaksha } from '../src/features/raksha.js';
import { createSetup } from '../src/features/setup.js';
import { createScamShield } from '../src/features/scamShield.js';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const services = createServices({ ...config, host: '127.0.0.1' }, { store: createFileStore({ persist: false, seed: () => seedData() }), metrics: { emit() {} } });
let simulator;
let assistant;
const appConfig = { ...config, demo: true, host: '127.0.0.1', web: { ...config.web, requireLogin: false } };
const app = createApp({
  config: appConfig,
  services,
  didis: createDidis({ store: services.store, services }),
  impact: createImpact({ services, store: services.store, includeDemo: true }),
  scan: createScan({ llm: null, services }),
  doctorNotes: createDoctorNotes({ llm: null, services, translator: services.translator }),
  haq: createHaq({ llm: null, services, translator: services.translator }),
  sangat: createSangat({ store: services.store, services, llm: null }),
  raksha: createRaksha({ services }),
  setup: createSetup({ services }),
  scamShield: createScamShield({ services }),
  simulatorFor: async () => ({ turn: (...a) => simulator.turn(...a), answer: (...a) => simulator.answer(...a), reset: () => {} }),
  assistantFor: async () => assistant,
});
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
simulator = createAlexaSimulator({ mcpUrl: `${base}/mcp`, llm: null, translator: services.translator });
assistant = createFamilyAssistant({ mcpUrl: `${base}/mcp`, llm: null });

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH || existsSync(LOCAL_CHROMIUM) ? { executablePath: process.env.CHROME_PATH || LOCAL_CHROMIUM } : { channel: 'chrome' }),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const scenarios = [
  { name: 'Alexa+ simulator', path: '/alexa.html' },
  { name: 'Alexa+ simulator, high contrast', path: '/alexa.html', contrast: true },
  { name: 'Alexa+ simulator, confirming a message', path: '/alexa.html', confirm: true },
  { name: 'Family Circle app', path: '/family.html' },
  { name: 'Alexa+ simulator, Saathi assistant open', path: '/alexa.html', click: '#open-assistant', after: '.assistant .a-tile' },
  { name: 'Landing page', path: '/', intro: false },
  { name: 'Landing page, phone width', path: '/', width: 390, intro: false },
  { name: 'Login', path: '/login.html' },
  { name: 'Login, two-step code', path: '/login.html?step=code' },
  { name: 'Family Circle app', path: '/family.html' },
  { name: 'Family Circle app, high contrast', path: '/family.html', contrast: true },
  { name: 'Family Circle app, phone width', path: '/family.html', width: 390 },
  { name: 'Medical ID card', path: '/medical-id.html', wait: '.mid-head' },
  { name: 'Medical ID card, phone width', path: '/medical-id.html', width: 390, wait: '.mid-head' },
  { name: 'Family assistant', path: '/family.html#assistant', wait: '.assistant .a-tile' },
  { name: 'House map, 3D', path: '/family.html#home', wait: '.h3-rooms li', settle: 2500 },
  { name: 'House map, 2D plan', path: '/family.html#home', wait: '.h3-rooms li', click: '.h3-seg button:last-child' },
  { name: 'House map, phone width', path: '/family.html#home', width: 390, wait: '.h3-rooms li' },
  { name: 'Set up a device (pairing code)', path: '/device.html' },
  { name: 'Join from an invite (expired link)', path: '/join.html?invite=nope' },
  { name: 'Family app, invite dialog', path: '/family.html#more', click: '#open-invite', after: '#mail-status' },
  { name: "Family app, set up Aaji's device", path: '/family.html#more', click: '#open-devices', after: '#pair-qr svg, #pair-error:not([hidden])' },
  { name: 'Family app, care view', path: '/family.html#care', wait: '#meds .row-item' },
  { name: 'Family app, medicines editor', path: '/family.html#care', wait: '#meds .row-item', click: '#manage-meds', after: '#edit-body form' },
  { name: 'Saathi Didi sign-up', path: '/didi.html', wait: '#join-title' },
  { name: 'Impact dashboard', path: '/impact.html', wait: '.im-stat' },
  { name: 'Impact dashboard, phone width', path: '/impact.html', width: 390, wait: '.im-stat' },
  { name: 'Saathi Didi sign-up, phone width', path: '/didi.html', width: 390, wait: '#join-title' },
  { name: 'Walk the house', path: '/scan.html' },
  { name: 'Walk the house, drawing by hand', path: '/scan.html', click: '#start-draw' },
  { name: 'Family app, care: health tab', path: '/family.html#care/health', wait: '#scan-card:not(.tab-off)' },
  { name: 'Family app, care: safety tab', path: '/family.html#care/raksha', wait: '#raksha-card:not(.tab-off)' },
  { name: 'Family app, Scam Shield', path: '/family.html#care/shield', wait: '#shield-card:not(.tab-off)' },
  { name: 'Family app, care: help and benefits tab', path: '/family.html#care/sangat', wait: '#sangat-card:not(.tab-off)' },
  { name: 'Family app, care: extras tab', path: '/family.html#care/extras', wait: '#tab-extras[aria-selected=true]' },
  { name: 'Family app, care on a phone', path: '/family.html#care/didis', width: 390, wait: '#didis-card:not(.tab-off)' },
  { name: 'Family app, home with attention, setup and today', path: '/family.html', wait: '#attention li:not(.skeleton)' },
  { name: 'Family app, home on a phone', path: '/family.html', width: 390, wait: '#attention li:not(.skeleton)' },
  { name: 'Family app, home, high contrast', path: '/family.html', contrast: true, wait: '#attention li:not(.skeleton)' },
  { name: 'Family app, More', path: '/family.html#more', wait: '.tile svg' },
  { name: 'Family app, More on a phone', path: '/family.html#more', width: 390, wait: '.tile svg' },
  { name: 'Family app, search', path: '/family.html', click: '#open-palette', after: '#palette-list li' },
  { name: 'Family app, keyboard shortcuts', path: '/family.html#more', click: '#open-shortcuts', after: '#shortcuts-dialog[open]' },
  { name: 'Family app, recommended protection', path: '/family.html#more', click: '#open-recommended', after: '#recommended-dialog[open]' },
  { name: 'Family app, display menu', path: '/family.html', click: '#open-display', after: '#display-pop:not([hidden])' },
  { name: 'Saathi voice screen, Raksha asking', path: '/alexa.html', raksha: true },
];

let failures = 0;
for (const s of scenarios) {
  const page = await browser.newPage({ viewport: { width: s.width ?? 1280, height: 900 } });
  if (s.contrast) await page.addInitScript(() => localStorage.setItem('saathi-settings', JSON.stringify({ contrast: true, voice: false })));
  else await page.addInitScript(() => localStorage.setItem('saathi-settings', JSON.stringify({ voice: false })));
  if (s.intro === false) await page.addInitScript(() => sessionStorage.setItem('saathi-intro-seen', '1'));
  await page.goto(base + s.path);
  await page.waitForLoadState('load');
  if (s.wait) await page.waitForSelector(s.wait);
  if (s.click) await page.click(s.click);
  if (s.after) await page.waitForSelector(s.after);
  await page.waitForTimeout(s.settle ?? 800);
  if (s.raksha) {
    await page.evaluate(() => {
      document.getElementById('raksha-q').textContent = 'Are you all right? Tap if you are fine.';
      document.getElementById('raksha-count').textContent = '45 seconds';
      document.getElementById('raksha-fine').textContent = "I'm fine";
      document.getElementById('raksha-help').textContent = 'I need help';
      document.getElementById('raksha').hidden = false;
    });
  }
  if (s.confirm) {
    await page.fill('#talk-input', 'Tell Riya that I love her');
    await page.press('#talk-input', 'Enter');
    await page.waitForSelector('#confirm:not([hidden])');
  }
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }));
  console.log(`${result.violations.length ? 'FAIL' : 'PASS'}  ${s.name}: ${result.passes.length} rules passed, ${result.violations.length} violations`);
  for (const v of result.violations) {
    console.log(`      [${v.impact}] ${v.id}: ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`        ${n.target.join(' ')}`);
  }
  failures += result.violations.length;
  await page.close();
}

await browser.close();
await simulator.close();
server.close();
process.exit(failures ? 1 : 0);
