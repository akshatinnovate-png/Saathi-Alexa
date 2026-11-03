import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = `${root}/src/security/saathi-core.wasm`;
if (process.argv.includes('--if-missing')) {
  if (existsSync(target)) process.exit(0);
  try {
    execFileSync('cargo', ['--version'], { stdio: 'ignore' });
  } catch {
    console.warn('saathi-core.wasm is not built and Rust is not installed. Install Rust from https://rustup.rs and run npm run build:core.');
    process.exit(0);
  }
}
const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
const flags = [`--remap-path-prefix=${root.replace(/[\\/]$/, '')}=.`, home && `--remap-path-prefix=${home}=~`].filter(Boolean).join(' ');
execFileSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'saathi-core'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: flags, CARGO_INCREMENTAL: '0', SOURCE_DATE_EPOCH: '0' },
});
const built = `${root}/target/wasm32-unknown-unknown/release/saathi_core.wasm`;
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
copyFileSync(built, target);
rmSync(`${root}/src/security/saathi-core-wasm.js`, { force: true });
const after = hash(target);
console.log(`saathi-core.wasm sha256 ${after}`);
if (process.argv.includes('--check')) {
  execFileSync('cargo', ['clean', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'saathi-core'], { cwd: root, stdio: 'inherit' });
  execFileSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'saathi-core'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: flags, CARGO_INCREMENTAL: '0', SOURCE_DATE_EPOCH: '0' },
  });
  const again = hash(built);
  if (again !== after) {
    console.error(`saathi-core.wasm is not reproducible: ${after} then ${again}.`);
    process.exit(1);
  }
  console.log('saathi-core.wasm builds reproducibly.');
}
