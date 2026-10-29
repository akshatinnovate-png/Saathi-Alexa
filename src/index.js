import './env.js';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
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
import { createDoorbell } from './doorbell/doorbell.js';
import { loadMasterKey, deriveKey, createSealer, fingerprint } from './security/keys.js';
import { createAuditLog } from './security/audit.js';
import { createAccountSecurity } from './accounts/security.js';
import { configurePepper, createBreachCheck } from './accounts/passwords.js';
import { startupProblems } from './security/startup.js';

const checks = startupProblems(config);
for (const warning of checks.warnings) console.warn(`  Warning: ${warning}`);
if (checks.errors.length) {
  console.error('\n  Saathi did not start, to keep the family safe:\n');
  for (const error of checks.errors) console.error(`  - ${error}`);
  console.error('');
  process.exit(1);
}
config.web.exposed = checks.exposed;
const llm = createLlm(config.agent, config.region);
const master = config.aws.dynamodb ? null : loadMasterKey({ keyFile: join(dirname(config.dataFile), 'saathi.key'), envKey: process.env.SAATHI_MASTER_KEY });
if (master?.created) console.log(`\n  Created a new encryption key at ${master.source}. Back it up together with the data file: without it the data cannot be read.`);
if (master && !process.env.SAATHI_RING_WEBHOOK_SECRET && config.ring.webhookSecret === 'local-ring-simulator-secret' && !config.demo) {
  config.ring.webhookSecret = deriveKey(master.key, 'ring-webhook').toString('base64url');
}
const services = createServices(config, {
  llmTranslate: llm?.translate, llmMood: llm?.mood,
  storeKey: master ? deriveKey(master.key, 'store') : null,
  mediaSigningKey: master ? deriveKey(master.key, 'media-links') : null,
  mediaEncryptionKey: master ? deriveKey(master.key, 'media') : null,
});
const baseUrl = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
const publicUrl = config.auth.publicUrl ?? `http://localhost:${config.port}`;

const cognito = config.auth.userPoolId && config.auth.webClientId
  ? createCognitoAccounts({ region: config.auth.region, userPoolId: config.auth.userPoolId, clientId: config.auth.webClientId, domain: config.auth.domain, publicUrl: config.auth.publicUrl ?? baseUrl })
  : null;
const legacySecret = (await services.store.get('meta', 'session-secret'))?.value ?? null;
const secret = config.web.sessionSecret ?? (master ? deriveKey(master.key, 'sessions').toString('base64url') : await sessionSecret(services.store));
const sessions = createSessions(secret, { store: services.store });
configurePepper(master ? deriveKey(master.key, 'pepper') : null);
const audit = createAuditLog({ store: services.store, key: master ? deriveKey(master.key, 'audit') : Buffer.from(`audit:${secret}`) });
const vault = master
  ? createSealer(deriveKey(master.key, 'vault'), { legacy: legacySecret ? createVault(legacySecret) : null })
  : createVault(secret);
const google = config.google.clientId && config.google.clientSecret ? createGoogle(config.google) : null;
const mailer = createMailer({ mail: config.mail, region: config.region, outboxDir: join(dirname(config.dataFile), 'outbox') });
const familyMail = createFamilyMail({ store: services.store, mailer, google, vault, publicUrl });
services.attachMail(familyMail);
const doorbell = createDoorbell({ store: services.store, services, vault, publicUrl });
const accounts = createAccounts({
  store: services.store, services, cognito, demo: config.web.demoAccounts, onInvite: (invite) => familyMail.sendInvite(invite),
  breachCheck: process.env.SAATHI_BREACH_CHECK === 'off' ? null : createBreachCheck(),
});
const site = new URL(publicUrl);
const security = createAccountSecurity({ accounts, store: services.store, sealer: vault, rp: { name: 'Saathi', id: site.hostname, origins: [site.origin] } });
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
config.web.canonicalLocalhost = true;
const app = createApp({ config, services, simulatorFor, assistantFor, verifier, optionalVerifier, accounts, sessions, allowedHosts, ringSimulator, google, familyMail, doorbell, security, audit });

doorbell.startAll().catch((err) => console.error('Ring listeners failed to start:', err.message));

app.listen(config.port, config.host, () => {
  console.log(`\n  Saathi is running${config.demo ? ' in DEMO mode (fictional family, short escalation waits, data in data/demo.json)' : ''}\n`);
  console.log(`  Open this in your browser:                   ${publicUrl}/`);
  console.log(`  Elder's tablet or Echo Show (pairing code):  ${publicUrl}/device.html`);
  console.log(`  MCP endpoint (Streamable HTTP, 2025-11-25):  ${baseUrl}/mcp   [auth: ${config.auth.mode}]`);
  console.log(`  Ring doorbell webhook (HMAC-signed):         ${baseUrl}/ring/events`);
  console.log(`  Accounts: ${cognito ? 'Amazon Cognito' : 'local (scrypt)'}${google ? ' + Google sign-in' : ''}${config.web.demoAccounts ? ' + demo accounts (riya@saathi.demo)' : ''}`);
  console.log(`  Email: ${mailer.real ? `${mailer.kind} from ${mailer.from}` : 'not set up (emails are printed here). Run "npm run setup" to send real email'}`);
  console.log(`  Alexa+ brain: ${llm ? `${llm.provider} (${llm.model})` : 'offline-planner'}`);
  console.log(`  Services: ${JSON.stringify(services.describe())}`);
  console.log(`  Data: ${master ? `encrypted at rest (AES-256-GCM, key ${fingerprint(master.key)} from ${master.source})` : 'Amazon DynamoDB'}\n`);
  if (process.env.SAATHI_OPEN_BROWSER === '1') {
    const [command, args] = process.platform === 'win32' ? ['explorer.exe', [`${publicUrl}/`]] : process.platform === 'darwin' ? ['open', [`${publicUrl}/`]] : ['xdg-open', [`${publicUrl}/`]];
    execFile(command, args, { shell: false, windowsHide: true }, () => {});
  }
});

setInterval(async () => {
  for (const householdId of await services.householdIds()) {
    try {
      await services.forHousehold(householdId).sweepReminders();
    } catch (err) {
      console.error(`reminders failed for ${householdId}`, err);
    }
  }
}, 60 * 1000).unref();

setInterval(async () => {
  for (const householdId of await services.householdIds()) {
    const saathi = services.forHousehold(householdId);
    try {
      await saathi.sweepMissedDoses();
      await saathi.sweepQuietDay();
      await saathi.sweepSupplies();
      await saathi.sweepAppointments();
      await saathi.sweepWeeklyLetter();
    } catch (err) {
      console.error(`sweep failed for ${householdId}`, err);
    }
  }
}, 5 * 60 * 1000).unref();
