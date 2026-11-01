import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pin = JSON.parse(readFileSync(join(ROOT, 'installer', 'node.json'), 'utf8'));
const stage = join(ROOT, 'build', 'windows');
const app = join(stage, 'app');
const cache = join(ROOT, 'build', 'cache');
const exe = (name) => join(ROOT, 'target', 'release', `${name}.exe`);
const step = (text) => console.log(`\n> ${text}`);

for (const bin of ['saathi', 'saathi-broker', 'sahay']) {
  if (!existsSync(exe(bin))) throw new Error(`${exe(bin)} is missing. Build it first: cargo build --locked --release -p saathi-launcher -p saathi-broker -p sahay`);
}

step('Fresh stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(app, 'bin'), { recursive: true });
mkdirSync(join(stage, 'runtime'), { recursive: true });
mkdirSync(cache, { recursive: true });

step('App files');
for (const dir of ['src', 'public', 'scripts']) cpSync(join(ROOT, dir), join(app, dir), { recursive: true });
for (const file of ['package.json', 'package-lock.json', '.npmrc', 'LICENSE', 'README.md', 'SECURITY.md']) copyFileSync(join(ROOT, file), join(app, file));
rmSync(join(app, 'scripts', 'e2e.js'));
rmSync(join(app, 'scripts', 'a11y.js'));
rmSync(join(app, 'scripts', 'package-windows.js'));

step('Production dependencies (lockfile only, no install scripts)');
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });

step('Key broker and launcher');
copyFileSync(exe('saathi-broker'), join(app, 'bin', 'saathi-broker.exe'));
copyFileSync(exe('saathi'), join(stage, 'saathi.exe'));
copyFileSync(exe('sahay'), join(stage, 'Sahay.exe'));
copyFileSync(join(ROOT, 'installer', 'saathi.ico'), join(stage, 'saathi.ico'));

step(`Node.js ${pin.version}, checked against its pinned SHA-256`);
const zip = join(cache, pin.file);
if (!existsSync(zip)) {
  const res = await fetch(pin.url);
  if (!res.ok) throw new Error(`Could not download ${pin.url}: ${res.status}`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
}
const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
if (digest !== pin.sha256) {
  rmSync(zip);
  throw new Error(`Node.js download does not match its pinned hash (got ${digest}, expected ${pin.sha256}). Nothing was packaged.`);
}
const unpack = join(cache, 'node');
rmSync(unpack, { recursive: true, force: true });
mkdirSync(unpack, { recursive: true });
if (process.platform === 'win32') execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', unpack], { stdio: 'inherit' });
else execFileSync('unzip', ['-q', zip, '-d', unpack], { stdio: 'inherit' });
const folder = join(unpack, pin.file.replace(/\.zip$/, ''));
copyFileSync(join(folder, 'node.exe'), join(stage, 'runtime', 'node.exe'));
copyFileSync(join(folder, 'LICENSE'), join(stage, 'runtime', 'LICENSE'));

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
writeFileSync(join(stage, 'VERSION'), `${version}\n`);
console.log(`\nStaged Saathi ${version} in ${stage}`);
console.log(`Build the installer with: iscc /DAppVersion=${version} ${join('installer', 'saathi.iss')}`);
