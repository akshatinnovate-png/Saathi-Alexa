import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileStore } from '../src/local/fileStore.js';
import { sealRecords } from '../src/security/sealed.js';
import { keyringFromMaster } from '../src/security/keyring.js';
import { testServices } from './helpers.js';

test('medical ID: details are cleaned up and only known blood groups are kept', async () => {
  const { saathi } = testServices();
  const out = await saathi.updateProfile({ medical: { allergies: '  Penicillin  ', conditions: 'x'.repeat(900), bloodGroup: 'Z+', doctor: 'Dr. Mehta', doctorPhone: '+91 20 0000 0001', notes: 'Hearing aid' } });
  assert.equal(out.medical.allergies, 'Penicillin');
  assert.equal(out.medical.conditions.length, 400);
  assert.equal(out.medical.bloodGroup, '');
  assert.equal((await saathi.updateProfile({ medical: { bloodGroup: 'AB-' } })).medical.bloodGroup, 'AB-');
});

test('medical ID: allergies and conditions are sealed at rest', async () => {
  const raw = createFileStore({ persist: false, seed: () => ({}) });
  const sealed = sealRecords(raw, { keyring: keyringFromMaster(Buffer.alloc(32, 5)), householdId: 'h1' });
  await sealed.put('profile', { id: 'elder', name: 'Kamala', medical: { allergies: 'Penicillin', conditions: 'Diabetes' } });
  const onDisk = JSON.stringify(await raw.get('profile', 'elder'));
  assert.ok(!onDisk.includes('Penicillin') && !onDisk.includes('Diabetes'));
  assert.equal((await sealed.get('profile', 'elder')).medical.allergies, 'Penicillin');
});
