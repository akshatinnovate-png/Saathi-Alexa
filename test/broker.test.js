import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openKeyring, findBroker, keyringFromMaster } from '../src/security/keyring.js';
import { createFileStore } from '../src/local/fileStore.js';

const broker = findBroker();
const skip = broker ? false : 'saathi-broker is not built (cargo build --release -p saathi-broker)';
const withTpm = broker && process.env.SAATHI_TCTI ? false : 'no TPM configured (set SAATHI_TCTI to a software TPM)';

async function keyDir() {
  const dir = await mkdtemp(join(tmpdir(), 'saathi-broker-'));
  const master = randomBytes(32);
  await writeFile(join(dir, 'saathi.key'), `${master.toString('base64')}\n`, { mode: 0o600 });
  return { dir, master };
}

test('the broker computes exactly what the in-process keyring computes, without Node ever holding the key', { skip }, async () => {
  const { dir, master } = await keyDir();
  const ring = await openKeyring({ dataDir: dir, broker, env: { ...process.env, SAATHI_KEYRING: '' } });
  const local = keyringFromMaster(master);
  try {
    assert.equal(ring.mode, 'broker');
    assert.equal(ring.keySource, 'file');
    assert.equal(ring.fingerprint, local.fingerprint.slice(0, 16));
    for (const purpose of ['sessions', 'audit', 'pepper', 'media-links']) {
      for (const textKey of [false, true]) {
        const data = randomBytes(40);
        assert.deepEqual(await ring.hmac(purpose, data, { textKey }), await local.hmac(purpose, data, { textKey }), `${purpose} ${textKey}`);
      }
    }
    const sealed = await ring.seal('vault', Buffer.from('ring refresh token'), 'saathi/vault');
    assert.equal((await local.open('vault', sealed, 'saathi/vault')).toString(), 'ring refresh token');
    const mine = await local.seal('store', Buffer.from('{"a":1}'), 'SAATHI-ENC1');
    assert.equal((await ring.open('store', mine, 'SAATHI-ENC1')).toString(), '{"a":1}');
    await assert.rejects(ring.open('vault', sealed, 'saathi/other'), /changed|wrong/);
    await assert.rejects(ring.hmac('root', Buffer.from('x')), /unknown key purpose/);
    if (process.platform === 'linux') {
      assert.equal(ring.hardening.syscall_filter, true);
      assert.equal(ring.hardening.no_dumps, true);
    }
  } finally {
    ring.close();
  }
});

test('the data file written through the broker is sealed and reads back', { skip }, async () => {
  const { dir } = await keyDir();
  const ring = await openKeyring({ dataDir: dir, broker, env: { ...process.env, SAATHI_KEYRING: '' } });
  try {
    const file = join(dir, 'saathi.json');
    const store = createFileStore({ file, keyring: ring });
    await store.put('notes', { id: 'n1', text: 'the spare key is under the mat' });
    await new Promise((r) => setTimeout(r, 200));
    const raw = await readFile(file, 'utf8');
    assert.match(raw, /^SAATHI-ENC1/);
    assert.ok(!raw.includes('spare key'));
    assert.equal((await createFileStore({ file, keyring: ring }).get('notes', 'n1')).text, 'the spare key is under the mat');
  } finally {
    ring.close();
  }
});

test('if the broker dies, Saathi is told instead of carrying on without it', { skip }, async () => {
  const { dir } = await keyDir();
  let died = null;
  const ring = await openKeyring({ dataDir: dir, broker, env: { ...process.env, SAATHI_KEYRING: '' }, onBrokerExit: (err) => { died = err; } });
  const pid = ring.pid;
  if (pid) process.kill(pid, 'SIGKILL');
  else ring.kill();
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(died, 'onBrokerExit was called');
  await assert.rejects(ring.hmac('audit', Buffer.from('x')), /not running|stopped/);
});

test('a TPM-sealed key opens only through the broker, and a changed boot state locks it', { skip: withTpm }, async () => {
  const { dir, master } = await keyDir();
  const out = JSON.parse(execFileSync(broker, ['protect', '--dir', dir], { encoding: 'utf8', env: { ...process.env, TSS2_LOG: 'all+NONE' } }));
  assert.equal(out.protection, 'tpm');
  assert.equal(existsSync(join(dir, 'saathi.key')), false);
  const ring = await openKeyring({ dataDir: dir, broker, env: { ...process.env, SAATHI_KEYRING: '' } });
  try {
    assert.equal(ring.keySource, 'tpm');
    const data = Buffer.from('hello');
    assert.deepEqual(await ring.hmac('audit', data), await keyringFromMaster(master).hmac('audit', data));
  } finally {
    ring.close();
  }
  await assert.rejects(openKeyring({ dataDir: dir, broker: null, env: { ...process.env, SAATHI_KEYRING: '' } }), /security chip/);
  if (process.env.SAATHI_TPM_EXTEND_PCR7 === '1') {
    execFileSync('tpm2_pcrextend', ['7:sha256=0000000000000000000000000000000000000000000000000000000000000001'], { env: { ...process.env, TPM2TOOLS_TCTI: process.env.SAATHI_TCTI } });
    await assert.rejects(openKeyring({ dataDir: dir, broker, env: { ...process.env, SAATHI_KEYRING: '' } }), /refused|could not open/);
    const back = JSON.parse(execFileSync(broker, ['restore', '--dir', await mkdtemp(join(tmpdir(), 'saathi-restore-')), '--code', out.recovery], { encoding: 'utf8', env: { ...process.env, TSS2_LOG: 'all+NONE' } }));
    assert.equal(back.restored, true);
  }
});
