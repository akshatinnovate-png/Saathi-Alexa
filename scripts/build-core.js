import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
const flags = [`--remap-path-prefix=${root.replace(/[\\/]$/, '')}=.`, home && `--remap-path-prefix=${home}=~`].filter(Boolean).join(' ');
execFileSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'saathi-core'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: flags, CARGO_INCREMENTAL: '0', SOURCE_DATE_EPOCH: '0' },
});
const built = `${root}/target/wasm32-unknown-unknown/release/saathi_core.wasm`;
const target = `${root}/src/security/saathi-core-wasm.js`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const embedded = () => Buffer.from(readFileSync(target, 'utf8').match(/'([A-Za-z0-9+/=]+)'/)[1], 'base64');
const before = (() => { try { return hash(embedded()); } catch { return null; } })();
const wasm = readFileSync(built);
writeFileSync(target, `export default '${wasm.toString('base64')}';\n`);
const after = hash(embedded());
console.log(`saathi-core.wasm sha256 ${after}`);
if (process.argv.includes('--check') && before !== after) {
  console.error(`The committed saathi-core-wasm.js (${before}) does not match a fresh build (${after}). Run npm run build:core and commit src/security/saathi-core-wasm.js.`);
  process.exit(1);
}
