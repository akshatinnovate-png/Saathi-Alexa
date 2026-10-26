import './env.js';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createServices } from './services.js';
import { createApp } from './http/app.js';
import { createLlm } from './agent/llm.js';
import { createAlexaSimulator } from './agent/alexaSimulator.js';
import { createFamilyAssistant } from './agent/familyAssistant.js';
import { createVerifier, createHouseholdVerifier } from './auth/verifier.js';
import { createRingSimulator } from './ring/webhook.js';
import { createAccounts } from './accounts/accounts.js';
import { createCognitoAccounts } from './accounts/cognito.js';
import { createSessions, sessionSecret } from './accounts/sessions.js';
import { createGoogle, createVault } from './accounts/google.js';
import { createMailer } from './mail/mailer.js';
import { createFamilyMail } from './mail/familyMail.js';

const llm = createLlm(config.agent, config.region);
const services = createServices(config, { llmTranslate: llm?.translate });
const baseUrl = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
const publicUrl = config.auth.publicUrl ?? `http://localhost:${config.port}`;

const cognito = config.auth.userPoolId && config.auth.webClientId
  ? createCognitoAccounts({ region: config.auth.region, userPoolId: config.auth.userPoolId, clientId: config.auth.webClientId, domain: config.auth.domain, publicUrl: config.auth.publicUrl ?? baseUrl })
  : null;
const secret = await sessionSecret(services.store, config.web.sessionSecret);
const sessions = createSessions(secret);
const google = config.google.clientId && config.google.clientSecret ? createGoogle(config.google) : null;
const mailer = createMailer({ mail: config.mail, region: config.region, outboxDir: fileURLToPath(new URL('../data/outbox', import.meta.url)) });
const familyMail = createFamilyMail({ store: services.store, mailer, google, vault: createVault(secret), publicUrl });
services.attachMail(familyMail);
const accounts = createAccounts({ store: services.store, services, cognito, demo: config.web.demoAccounts, onInvite: (invite) => familyMail.sendInvite(invite) });
await accounts.ensureDemo();

const baseVerifier = createVerifier(config.auth);
const verifier = baseVerifier ? createHouseholdVerifier({ base: baseVerifier, accounts }) : null;
const optionalVerifier = baseVerifier ? null : createHouseholdVerifier({ base: null, accounts });

const deviceHeaders = new Map();
async function headersFor(householdId) {
  if (!deviceHeaders.has(householdId)) {
    const token = await accounts.internalDeviceToken(householdId, 'Saathi web simulator');
    deviceHeaders.set(householdId, { Authorization: `Bearer ${token}` });
  }
  return deviceHeaders.get(householdId);
}

const simulators = new Map();
async function simulatorFor(householdId) {
  if (!simulators.has(householdId)) {
    const simulator = createAlexaSimulator({
      mcpUrl: `${baseUrl}/mcp`,
      headers: await headersFor(householdId),
      llm,
      translator: services.translator,
      publish: (type, detail) => services.localBus.publish(type, { householdId, ...detail }),
    });
    simulator.brain = llm ? `${llm.provider} (${llm.model})` : 'offline-planner';
    simulators.set(householdId, simulator);
  }
  return simulators.get(householdId);
}

const assistants = new Map();
async function assistantFor(householdId) {
  if (!assistants.has(householdId)) {
    assistants.set(householdId, createFamilyAssistant({ mcpUrl: `${baseUrl}/mcp`, headers: await headersFor(householdId), llm }));
  }
  return assistants.get(householdId);
}

const ringSimulator = createRingSimulator({ url: `${baseUrl}/ring/events`, secret: config.ring.webhookSecret });
const configuredHosts = process.env.SAATHI_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? [];
const allowedHosts = configuredHosts.length || config.auth.publicUrl
  ? [...new Set([...configuredHosts, ...(config.auth.publicUrl ? [new URL(config.auth.publicUrl).hostname, 'localhost', '127.0.0.1'] : [])])]
  : undefined;
const app = createApp({ config, services, simulatorFor, assistantFor, verifier, optionalVerifier, accounts, sessions, allowedHosts, ringSimulator, google, familyMail });

app.listen(config.port, config.host, () => {
  console.log(`\n  Saathi is running${config.demo ? ' in DEMO mode (fictional family, short escalation waits, data in data/demo.json)' : ''}\n`);
  console.log(`  Open this in your browser:                   ${publicUrl}/`);
  console.log(`  Aaji's tablet or Echo Show (pairing code):   ${publicUrl}/device.html`);
  console.log(`  MCP endpoint (Streamable HTTP, 2025-11-25):  ${baseUrl}/mcp   [auth: ${config.auth.mode}]`);
  console.log(`  Ring doorbell webhook (HMAC-signed):         ${baseUrl}/ring/events`);
  console.log(`  Accounts: ${cognito ? 'Amazon Cognito' : 'local (scrypt)'}${google ? ' + Google sign-in' : ''}${config.web.demoAccounts ? ' + demo accounts (riya@saathi.demo)' : ''}`);
  console.log(`  Email: ${mailer.real ? `${mailer.kind} from ${mailer.from}` : 'not set up (emails are printed here). Run "npm run setup" to send real email'}`);
  console.log(`  Alexa+ brain: ${llm ? `${llm.provider} (${llm.model})` : 'offline-planner'}`);
  console.log(`  Services: ${JSON.stringify(services.describe())}\n`);
});

setInterval(async () => {
  for (const householdId of await services.householdIds()) {
    const saathi = services.forHousehold(householdId);
    try {
      await saathi.sweepMissedDoses();
      await saathi.sweepQuietDay();
      await saathi.sweepSupplies();
      await saathi.sweepAppointments();
    } catch (err) {
      console.error(`sweep failed for ${householdId}`, err);
    }
  }
}, 5 * 60 * 1000).unref();
