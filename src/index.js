import { config } from './config.js';
import { createServices } from './services.js';
import { createApp } from './http/app.js';
import { createLlm } from './agent/llm.js';
import { createAlexaSimulator } from './agent/alexaSimulator.js';
import { createVerifier } from './auth/verifier.js';
import { createRingSimulator } from './ring/webhook.js';

const llm = createLlm(config.agent, config.region);
const services = createServices(config, { llmTranslate: llm?.translate });
const verifier = createVerifier(config.auth);
const baseUrl = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;

const simulatorToken = process.env.SAATHI_SIMULATOR_TOKEN ?? config.auth.elderToken;
const simulator = createAlexaSimulator({
  mcpUrl: `${baseUrl}/mcp`,
  headers: simulatorToken ? { Authorization: `Bearer ${simulatorToken}` } : undefined,
  llm,
  translator: services.translator,
  publish: (type, detail) => services.localBus.publish(type, detail),
});
simulator.brain = llm ? `${llm.provider} (${llm.model})` : 'offline-planner';

const ringSimulator = createRingSimulator({ url: `${baseUrl}/ring/events`, secret: config.ring.webhookSecret });
const allowedHosts = process.env.SAATHI_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean);
const app = createApp({ config, services, simulator, verifier, allowedHosts, ringSimulator });

app.listen(config.port, config.host, () => {
  console.log(`\n  Saathi is running\n`);
  console.log(`  MCP endpoint (Streamable HTTP, 2025-11-25):  ${baseUrl}/mcp   [auth: ${config.auth.mode}]`);
  console.log(`  Ring doorbell webhook (HMAC-signed):         ${baseUrl}/ring/events`);
  console.log(`  Alexa+ device simulator:                     ${baseUrl}/`);
  console.log(`  Family dashboard:                            ${baseUrl}/family.html`);
  console.log(`  Alexa+ brain: ${simulator.brain}`);
  console.log(`  Services: ${JSON.stringify(services.describe())}\n`);
});

setInterval(async () => {
  try {
    await services.saathi.sweepMissedDoses();
    await services.saathi.sweepQuietDay();
    await services.saathi.sweepSupplies();
    await services.saathi.sweepAppointments();
  } catch (err) {
    console.error('sweep failed', err);
  }
}, 5 * 60 * 1000).unref();
