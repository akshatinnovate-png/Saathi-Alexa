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
  { name: 'Family Circle app', path: '/family.html' },
  { name: 'Family Circle app, high contrast', path: '/family.html', contrast: true },
  { name: 'Family Circle app, phone width', path: '/family.html', width: 390 },
  { name: 'Family assistant', path: '/family.html#assistant', wait: '.assistant .a-tile' },
  { name: 'House map, 3D', path: '/family.html#home', wait: '.h3-rooms li', settle: 2500 },
  { name: 'House map, 2D plan', path: '/family.html#home', wait: '.h3-rooms li', click: '.h3-seg button:last-child' },
  { name: 'House map, phone width', path: '/family.html#home', width: 390, wait: '.h3-rooms li' },
  { name: 'Set up a device (pairing code)', path: '/device.html' },
  { name: 'Join from an invite (expired link)', path: '/join.html?invite=nope' },
  { name: 'Family app, invite dialog', path: '/family.html', click: '#open-invite', after: '#mail-status' },
  { name: "Family app, set up Aaji's device", path: '/family.html', click: '#open-devices', after: '#pair-qr svg, #pair-error:not([hidden])' },
  { name: 'Walk the house', path: '/scan.html' },
  { name: 'Walk the house, drawing by hand', path: '/scan.html', click: '#start-draw' },
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
  if (s.confirm) {
    await page.fill('#talk-input', 'Tell Riya that I love her');
    await page.press('#talk-input', 'Enter');
    await page.waitForSelector('#confirm:not([hidden])');
  }
  await page.addScriptTag({ content: axeSource });
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
