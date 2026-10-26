import { fileURLToPath } from 'node:url';

process.env.SAATHI_DEMO = 'true';
process.env.SAATHI_DATA_FILE ??= fileURLToPath(new URL('../data/demo.json', import.meta.url));
await import('../src/index.js');
