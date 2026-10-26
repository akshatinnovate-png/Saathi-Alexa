import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = process.env.SAATHI_ENV_FILE ?? fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
