import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  newDevice, deviceFromSeed, encodePublic, decodePublic, keyId, wrapFor, unwrapWith, wrapContext, contentContext,
  sealContent, openContent, contentEpoch, commitment, sasPictures, newRecoverySecret, recoverySecretFromCode,
  splitSecret, combineShares, random, utf8, text, equal, b64u, unb64u, SAS_EMOJI,
} from '../public/vault-crypto.js';

test('a device key is rebuilt exactly from its 96-byte seed', async () => {
  const a = newDevice();
  const b = deviceFromSeed(a.seed);
  assert.ok(equal(a.public.x25519, b.public.x25519));
  assert.ok(equal(a.public.mlkem, b.public.mlkem));
  assert.equal(a.public.mlkem.length, 1184);
  const round = decodePublic(JSON.parse(JSON.stringify(encodePublic(a.public))));
  assert.equal(await keyId(round), await keyId(a.public));
  assert.throws(() => decodePublic({ suite: 'other', x25519: '', mlkem: '' }));
});

test('the family key is wrapped with post-quantum hybrid encryption for exactly one device and one context', async () => {
  const phone = newDevice();
  const thief = newDevice();
  const familyKey = random(32);
  const id = await keyId(phone.public);
  const ctx = wrapContext('h1', 1, id);
  const wrapped = await wrapFor(phone.public, familyKey, ctx);
  assert.ok(equal(await unwrapWith(phone, wrapped, ctx), familyKey));
  await assert.rejects(unwrapWith(thief, wrapped, ctx));
  await assert.rejects(unwrapWith(phone, wrapped, wrapContext('h2', 1, id)), /changed|not for this family/);
  await assert.rejects(unwrapWith(phone, wrapped, wrapContext('h1', 2, id)));
  const bytes = unb64u(wrapped);
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(unwrapWith(phone, b64u(bytes), ctx));
  assert.notEqual(await wrapFor(phone.public, familyKey, ctx), wrapped);
});

test('private content opens only with the right epoch key and the right label', async () => {
  const keys = new Map([[1, random(32)], [2, random(32)]]);
  const ctx = contentContext('h1', 'voice', 'note-7');
  const blob = await sealContent(keys.get(2), 2, ctx, utf8('Aaji, we are coming on Sunday'));
  assert.equal(contentEpoch(blob), 2);
  assert.equal(text(await openContent(keys, ctx, blob)), 'Aaji, we are coming on Sunday');
  await assert.rejects(openContent(keys, contentContext('h1', 'voice', 'note-8'), blob), /changed|not for this family/);
  await assert.rejects(openContent(new Map([[1, keys.get(1)]]), ctx, blob), /does not have the key/);
  const swapped = blob.slice();
  swapped[14] = 1;
  await assert.rejects(openContent(keys, ctx, swapped));
  await assert.rejects(openContent(keys, ctx, utf8('plain text')), /not a private Saathi item/);
});

test('the pictures bind the device key: a server that swaps the key cannot keep the same pictures', async () => {
  const tablet = newDevice();
  const evil = newDevice();
  const nd = random(16);
  const nf = random(16);
  const commit = await commitment(tablet.public, nd);
  const honest = await sasPictures(commit, tablet.public, nd, nf);
  assert.equal(honest.length, 3);
  assert.ok(honest.every((e) => SAS_EMOJI.includes(e)));
  assert.notEqual(await commitment(evil.public, nd), commit);
  let matches = 0;
  for (let i = 0; i < 300; i++) {
    const fake = newDevice();
    const fakeNonce = random(16);
    if ((await sasPictures(await commitment(fake.public, fakeNonce), fake.public, fakeNonce, nf)).join('') === honest.join('')) matches++;
  }
  assert.ok(matches <= 1, `forged keys matched the pictures ${matches} times out of 300`);
});

test('recovery codes round-trip and catch typos', async () => {
  const { secret, code } = await newRecoverySecret();
  assert.match(code, /^[A-Z2-9]{5}(-[A-Z2-9]{1,5})+$/);
  assert.ok(equal(await recoverySecretFromCode(code.toLowerCase().replaceAll('-', ' ')), secret));
  const typo = code.replace(/[A-Z2-9]/, (c) => (c === 'A' ? 'B' : 'A'));
  await assert.rejects(recoverySecretFromCode(typo), /typo/);
  await assert.rejects(recoverySecretFromCode('ONE1'), /never use/);
});

test('any 2 of the 3 family sheets rebuild the recovery secret, and 1 sheet reveals nothing useful', async () => {
  await fc.assert(fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), async (secretArr) => {
    const secret = Uint8Array.from(secretArr);
    const [a, b, c] = await splitSecret(secret);
    for (const pair of [[a, b], [b, c], [a, c], [c, a]]) assert.ok(equal(await combineShares(pair), secret));
    await assert.rejects(combineShares([a, a]), /same/);
  }), { numRuns: 40 });
  const s1 = random(32);
  const s2 = random(32);
  const one = await splitSecret(s1);
  const other = await splitSecret(s2);
  assert.ok(!equal(await combineShares([one[0], other[1]]), s1));
});
