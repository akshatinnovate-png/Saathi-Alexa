import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileStore } from '../src/local/fileStore.js';
import { sealRecords } from '../src/security/sealed.js';
import { keyringFromMaster } from '../src/security/keyring.js';
import { scopeStore } from '../src/households/scope.js';
import { testServices } from './helpers.js';

const keyring = keyringFromMaster(Buffer.alloc(32, 9));

test('health details are sealed record by record, and read back normally', async () => {
  const services = testServices({ keyring });
  const saathi = services.forHousehold('default');
  const med = await saathi.saveMedication({ name: 'Metoprolol', purpose: 'for her heart rhythm', times: ['08:00'], description: 'small white round tablet' });
  await saathi.checkIn({ text: 'I miss my husband today', language: 'en' });
  await saathi.saveStory({ text: 'When I was young we lived by the river in Satara', title: 'The river', language: 'en' });
  const raw = JSON.stringify(await Promise.all(['medications', 'checkins', 'stories'].map((c) => services.store.list(c))));
  for (const secret of ['Metoprolol', 'heart rhythm', 'miss my husband', 'river in Satara']) assert.ok(!raw.includes(secret), `${secret} is visible in the store`);
  assert.ok(raw.includes('"$b":"b1.'));
  assert.ok((await saathi.careSetup()).medications.some((m) => m.name === 'Metoprolol'));
  assert.equal((await services.forHousehold('default').careSetup()).medications.find((m) => m.id === med.id).purpose, 'for her heart rhythm');
});

test('a sealed record cannot be moved to another family or another collection', async () => {
  const base = createFileStore({ persist: false });
  const a = sealRecords(scopeStore(base, 'family-a'), { keyring, householdId: 'family-a' });
  await a.put('medications', { id: 'm1', name: 'Donepezil', purpose: 'memory' });
  const sealed = (await base.list('hh#family-a#medications'))[0];
  await base.put('hh#family-b#medications', sealed);
  const b = sealRecords(scopeStore(base, 'family-b'), { keyring, householdId: 'family-b' });
  await assert.rejects(b.get('medications', 'm1'), /changed or belongs elsewhere/);
  await base.put('hh#family-a#appointments', sealed);
  await assert.rejects(a.get('appointments', 'm1'), /changed or belongs elsewhere/);
  const tampered = { ...sealed, $b: sealed.$b.slice(0, -2) + (sealed.$b.endsWith('A') ? 'BB' : 'AA') };
  await base.put('hh#family-a#medications', tampered);
  await assert.rejects(a.get('medications', 'm1'));
});

test('records written before sealing are sealed on the next start, and plain fields stay usable', async () => {
  const base = createFileStore({ persist: false });
  await base.put('medications', { id: 'old', name: 'Aspirin', purpose: 'blood thinner', time: '09:00', supply: { left: 10 } });
  const sealed = sealRecords(base, { keyring, householdId: 'default' });
  assert.equal(await sealed.migrate(), 1);
  const raw = await base.get('medications', 'old');
  assert.equal(raw.name, undefined);
  assert.equal(raw.time, '09:00');
  assert.deepEqual(raw.supply, { left: 10 });
  assert.equal((await sealed.get('medications', 'old')).name, 'Aspirin');
  const updated = await sealed.update('medications', 'old', { supply: { left: 9 } });
  assert.equal(updated.name, 'Aspirin');
  assert.equal((await sealed.get('medications', 'old')).supply.left, 9);
  assert.equal(await sealed.migrate(), 0);
});

test('a shortened authentication tag is refused, so a truncated record cannot be forged more cheaply', async () => {
  const ring = keyringFromMaster(Buffer.alloc(32, 9));
  const sealed = await ring.seal('class-b', Buffer.from('Amlodipine for blood pressure'), 'class-b|h|medications|m1');
  assert.equal((await ring.open('class-b', sealed, 'class-b|h|medications|m1')).toString(), 'Amlodipine for blood pressure');
  for (const length of [4, 8, 12, 15]) {
    await assert.rejects(ring.open('class-b', { ...sealed, tag: sealed.tag.subarray(0, length) }, 'class-b|h|medications|m1'));
  }
});
