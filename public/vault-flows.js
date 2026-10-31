import {
  newDevice, deviceFromSeed, encodePublic, decodePublic, keyId, wrapFor, unwrapWith, wrapContext, contentContext,
  sealContent, openContent, commitment, sasPictures, newRecoverySecret, recoverySecretFromCode, recoveryDevice,
  splitSecret, combineShares, random, b64u, unb64u, deviceCert, checkCert,
} from './vault-crypto.js';

export async function unlockKeys(call, householdId, device) {
  const id = await keyId(device.public);
  const { grants, epoch } = await call('GET', `/api/vault/keys/${id}`);
  const keys = new Map();
  for (const g of grants) keys.set(g.epoch, await unwrapWith(device, g.wrapped, wrapContext(householdId, g.epoch, id)));
  return { keyId: id, keys, epoch };
}

async function wrapAll(householdId, keys, pub) {
  const id = await keyId(pub);
  return Promise.all([...keys].map(async ([epoch, key]) => ({ epoch, wrapped: await wrapFor(pub, key, wrapContext(householdId, epoch, id)) })));
}

async function certFor(householdId, keys, pub) {
  const epoch = Math.max(...keys.keys());
  return deviceCert(keys.get(epoch), epoch, householdId, await keyId(pub));
}

async function makeRecovery(householdId, keys, { split = false } = {}) {
  const { secret, code } = await newRecoverySecret();
  const device = await recoveryDevice(secret, householdId);
  const sheets = split ? await splitSecret(secret) : null;
  secret.fill(0);
  return { body: { pub: encodePublic(device.public), wrapped: await wrapAll(householdId, keys, device.public), cert: await certFor(householdId, keys, device.public), split }, code: split ? null : code, sheets };
}

export async function createFamilyKey(call, householdId, { label, split = false } = {}) {
  const device = newDevice();
  const familyKey = random(32);
  const keys = new Map([[1, familyKey]]);
  const recovery = await makeRecovery(householdId, keys, { split });
  const out = await call('POST', '/api/vault/init', { device: { pub: encodePublic(device.public), label, cert: await certFor(householdId, keys, device.public) }, wrapped: await wrapAll(householdId, keys, device.public), recovery: recovery.body });
  return { device, keys, epoch: 1, keyId: out.keyId, recoveryCode: recovery.code, recoverySheets: recovery.sheets };
}

export async function replaceRecoveryKit(call, householdId, keys, { split = false } = {}) {
  const recovery = await makeRecovery(householdId, keys, { split });
  await call('PUT', '/api/vault/recovery', recovery.body);
  return { recoveryCode: recovery.code, recoverySheets: recovery.sheets };
}

export async function beginJoin(call, { label } = {}) {
  const device = newDevice();
  const nonce = random(16);
  const commit = await commitment(device.public, nonce);
  const { id } = await call('POST', '/api/vault/join', { commit, label });
  return { id, device, nonce, commit };
}

export async function joinerStep(call, join) {
  const status = await call('GET', `/api/vault/join/${join.id}`);
  if (status.status === 'nonce' && !join.revealed) {
    await call('POST', `/api/vault/join/${join.id}/reveal`, { pub: encodePublic(join.device.public), nonce: b64u(join.nonce) });
    join.revealed = true;
    join.pictures = await sasPictures(join.commit, join.device.public, join.nonce, unb64u(status.approverNonce));
    return { status: 'compare', pictures: join.pictures };
  }
  if (status.status === 'approved') return { status: 'approved' };
  if (['refused', 'expired'].includes(status.status)) return { status: status.status };
  return { status: join.revealed ? 'compare' : 'waiting', pictures: join.pictures ?? null };
}

export async function approverBegin(call, request) {
  const nonce = random(16);
  await call('POST', `/api/vault/join/${request.id}/nonce`, { nonce: b64u(nonce) });
  return { id: request.id, commit: request.commit, nonce };
}

export async function approverPictures(call, check) {
  const state = await call('GET', '/api/vault');
  const request = state.joins.find((j) => j.id === check.id);
  if (!request || request.status !== 'revealed') return null;
  const pub = decodePublic(request.pub);
  if ((await commitment(pub, unb64u(request.joinerNonce))) !== check.commit) throw new Error('The device sent a different key than it promised. Do not approve it.');
  check.pub = pub;
  check.pictures = await sasPictures(check.commit, pub, unb64u(request.joinerNonce), check.nonce);
  return check.pictures;
}

export async function approverDecide(call, householdId, keys, check, approve) {
  if (!approve) return call('POST', `/api/vault/join/${check.id}/decide`, { approve: false });
  if (!check.pub) throw new Error('Compare the pictures first.');
  return call('POST', `/api/vault/join/${check.id}/decide`, { approve: true, wrapped: await wrapAll(householdId, keys, check.pub), cert: await certFor(householdId, keys, check.pub) });
}

export async function verifyDevices(householdId, keys, devices) {
  const good = [];
  const bad = [];
  for (const d of devices) {
    const pub = decodePublic(d.pub);
    const ok = (await keyId(pub)) === d.id && (await checkCert(keys, householdId, d.id, d.cert));
    (ok ? good : bad).push({ ...d, publicKey: pub });
  }
  return { good, bad };
}

export async function rotateFamilyKey(call, householdId, keys, { remove = [] } = {}) {
  const state = await call('GET', '/api/vault');
  const epoch = state.epoch + 1;
  const familyKey = random(32);
  const removed = new Set(remove);
  const { good, bad } = await verifyDevices(householdId, keys, state.devices);
  const forged = bad.filter((d) => !removed.has(d.id));
  if (forged.length) throw new Error(`Stopped: ${forged.map((d) => d.label).join(', ')} was never approved by your family. Someone may have tampered with the server.`);
  const grants = [];
  for (const d of good.filter((x) => !removed.has(x.id))) {
    grants.push({ keyId: d.id, wrapped: await wrapFor(d.publicKey, familyKey, wrapContext(householdId, epoch, d.id)), cert: await deviceCert(familyKey, epoch, householdId, d.id) });
  }
  await call('POST', '/api/vault/rotate', { epoch, removed: [...removed], grants });
  keys.set(epoch, familyKey);
  return epoch;
}

export async function recoverWithCode(call, householdId, { code, sheets, label } = {}) {
  const secret = sheets ? await combineShares(sheets) : await recoverySecretFromCode(code);
  const kit = await recoveryDevice(secret, householdId);
  secret.fill(0);
  const { keys } = await unlockKeys(call, householdId, kit);
  const device = newDevice();
  const out = await call('POST', '/api/vault/recover', { device: { pub: encodePublic(device.public), label, cert: await certFor(householdId, keys, device.public) }, wrapped: await wrapAll(householdId, keys, device.public) });
  return { device, keys, keyId: out.keyId };
}

export async function seal(householdId, keys, kind, itemId, bytes) {
  const epoch = Math.max(...keys.keys());
  return sealContent(keys.get(epoch), epoch, contentContext(householdId, kind, itemId), bytes);
}

export async function open(householdId, keys, kind, itemId, blob) {
  return openContent(keys, contentContext(householdId, kind, itemId), blob);
}

export { deviceFromSeed };
