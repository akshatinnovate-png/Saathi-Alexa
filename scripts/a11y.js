import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { config } from '../src/config.js';
import { createServices } from '../src/services.js';
import { createApp } from '../src/http/app.js';
import { createAlexaSimulator } from '../src/agent/alexaSimulator.js';
import { createFileStore } from '../src/local/fileStore.js';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const services = createServices({ ...config, host: '127.0.0.1' }, { store: createFileStore({ persist: false }), metrics: { emit() {} } });
let simulator;
const app = createApp({
  config: { ...config, host: '127.0.0.1' },
  services,
  simulator: { turn: (...a) => simulator.turn(...a), answer: (...a) => simulator.answer(...a), reset: () => {} },
});
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
simulator = createAlexaSimulator({ mcpUrl: `${base}/mcp`, llm: null, translator: services.translator });

const browser = await chromium.launch(process.env.CHROME_PATH || existsSync(LOCAL_CHROMIUM)
  ? { executablePath: process.env.CHROME_PATH || LOCAL_CHROMIUM }
  : { channel: 'chrome' });

const scenarios = [
  { name: 'Alexa+ simulator', path: '/' },
  { name: 'Alexa+ simulator, high contrast', path: '/', contrast: true },
  { name: 'Alexa+ simulator, confirming a message', path: '/', confirm: true },
  { name: 'Family Circle app', path: '/family.html' },
  { name: 'Family Circle app, phone width', path: '/family.html', width: 390 },
];

let failures = 0;
for (const s of scenarios) {
  const page = await browser.newPage({ viewport: { width: s.width ?? 1280, height: 900 } });
  if (s.contrast) await page.addInitScript(() => localStorage.setItem('saathi-settings', JSON.stringify({ contrast: true, voice: false })));
  else await page.addInitScript(() => localStorage.setItem('saathi-settings', JSON.stringify({ voice: false })));
  await page.goto(base + s.path);
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);
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
