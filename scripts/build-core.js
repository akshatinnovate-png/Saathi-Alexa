import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
const flags = [`--remap-path-prefix=${root.replace(/[\\/]$/, '')}=.`, home && `--remap-path-prefix=${home}=~`].filter(Boolean).join(' ');
execFileSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'saathi-core'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: flags, CARGO_INCREMENTAL: '0', SOURCE_DATE_EPOCH: '0' },
});
const built = `${root}/target/wasm32-unknown-unknown/release/saathi_core.wasm`;
const target = `${root}/src/security/saathi-core.wasm`;
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const before = (() => { try { return hash(target); } catch { return null; } })();
copyFileSync(built, target);
const after = hash(target);
console.log(`saathi-core.wasm sha256 ${after}`);
if (process.argv.includes('--check') && before !== after) {
  console.error(`The committed saathi-core.wasm (${before}) does not match a fresh build (${after}). Run npm run build:core and commit the result.`);
  process.exit(1);
}
