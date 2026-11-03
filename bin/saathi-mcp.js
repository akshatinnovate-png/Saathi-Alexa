#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config as baseConfig } from '../src/config.js';
import { createServices } from '../src/services.js';
import { createFileStore } from '../src/local/fileStore.js';
import { seedData } from '../src/domain/seed.js';
import { buildMcpServer, SERVER_INFO } from '../src/mcp/server.js';
import { installEgressGuard } from '../src/security/egress.js';

const HELP = `saathi-mcp ${SERVER_INFO.version}

Runs Saathi's MCP server over stdio with a fictional demo family, so you can try
every tool from Claude Desktop, Claude Code or any MCP client.

  npx -y saathi-alexa

Everything stays in memory and is gone when the client closes it. No keys, no
accounts, and no network: Saathi refuses every outside connection in this mode.
For a real family, run the full server instead: https://github.com/akshatinnovate-png/Saathi-Alexa
`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stderr.write(HELP);
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  process.stderr.write(`${SERVER_INFO.version}\n`);
  process.exit(0);
}

console.log = (...a) => console.error(...a);
console.info = (...a) => console.error(...a);
installEgressGuard({ allow: [], env: {} });

const mediaDir = mkdtempSync(join(tmpdir(), 'saathi-demo-'));
const cleanup = () => rmSync(mediaDir, { recursive: true, force: true });
process.on('exit', cleanup);

const config = {
  ...baseConfig,
  demo: true,
  mediaDir,
  aws: Object.fromEntries(Object.keys(baseConfig.aws).map((k) => [k, false])),
  escalation: { familyAckWaitSeconds: 20, neighbourAckWaitSeconds: 20 },
};
const services = createServices(config, {
  store: createFileStore({ persist: false, seed: () => seedData() }),
  metrics: { emit() {} },
});

const server = buildMcpServer(services.forHousehold(), { bus: services.localBus });
const transport = new StdioServerTransport();
transport.onclose = () => process.exit(0);
await server.connect(transport);
console.error('Saathi demo MCP server is running on stdio with a fictional family. Nothing leaves this computer.');
