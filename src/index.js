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

const llm = createLlm(config.agent, config.region);
const services = createServices(config, { llmTranslate: llm?.translate });
const baseUrl = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;

const cognito = config.auth.userPoolId && config.auth.webClientId
  ? createCognitoAccounts({ region: config.auth.region, userPoolId: config.auth.userPoolId, clientId: config.auth.webClientId, domain: config.auth.domain, publicUrl: config.auth.publicUrl ?? baseUrl })
  : null;
const accounts = createAccounts({ store: services.store, services, cognito, demo: config.web.demoAccounts });
await accounts.ensureDemo();
const sessions = createSessions(await sessionSecret(services.store, config.web.sessionSecret));

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
const allowedHosts = process.env.SAATHI_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean);
const app = createApp({ config, services, simulatorFor, assistantFor, verifier, optionalVerifier, accounts, sessions, allowedHosts, ringSimulator });

app.listen(config.port, config.host, () => {
  console.log(`\n  Saathi is running\n`);
  console.log(`  Website (intro, sign in, family app):        ${baseUrl}/`);
  console.log(`  MCP endpoint (Streamable HTTP, 2025-11-25):  ${baseUrl}/mcp   [auth: ${config.auth.mode}]`);
  console.log(`  Ring doorbell webhook (HMAC-signed):         ${baseUrl}/ring/events`);
  console.log(`  Accounts: ${cognito ? 'Amazon Cognito' : 'local (scrypt)'}${config.web.demoAccounts ? ' + demo accounts (riya@saathi.demo)' : ''}`);
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
