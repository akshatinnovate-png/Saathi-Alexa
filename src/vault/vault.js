import { createHash, randomBytes } from 'node:crypto';
import { AuthError } from '../accounts/cognito.js';

const JOIN_MS = 10 * 60 * 1000;
const B64U = /^[A-Za-z0-9_-]+$/;
const SUITE = 'saathi-e2e-v1';

const sha256 = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(p.length);
    h.update(len).update(p);
  }
  return h.digest();
};

function checkPublic(pub) {
  if (pub?.suite !== SUITE || !B64U.test(pub.x25519 ?? '') || !B64U.test(pub.mlkem ?? '')) throw new AuthError('vault', 'That device key is not valid.');
  const x = Buffer.from(pub.x25519, 'base64url');
  const k = Buffer.from(pub.mlkem, 'base64url');
  if (x.length !== 32 || k.length !== 1184) throw new AuthError('vault', 'That device key is the wrong size.');
  return { x, k };
}

export function keyIdOf(pub) {
  const { x, k } = checkPublic(pub);
  return sha256(Buffer.from(SUITE), x, k).subarray(0, 16).toString('base64url');
}

function commitmentOf(pub, nonce) {
  const { x, k } = checkPublic(pub);
  return sha256(Buffer.from('saathi/commit'), x, k, Buffer.from(nonce, 'base64url')).toString('base64url');
}

const certOf = (cert) => {
  if (!cert || !Number.isInteger(Number(cert.epoch)) || typeof cert.mac !== 'string' || !B64U.test(cert.mac) || cert.mac.length > 64) throw new AuthError('vault', 'The device approval is missing.');
  return { epoch: Number(cert.epoch), mac: cert.mac };
};

const blob = (value, max = 4096) => {
  if (typeof value !== 'string' || !B64U.test(value) || value.length > max) throw new AuthError('vault', 'That key package is not valid.');
  return value;
};

export function createVault({ store, clock = () => new Date(), audit = null }) {
  const now = () => clock().toISOString();
  const log = (householdId, actor, action, detail = {}) => audit?.append({ householdId, actor, action, detail }).catch(() => {});
  const meta = (householdId) => store.get('vaultMeta', householdId);
  const devices = async (householdId) => (await store.list('vaultDevices')).filter((d) => d.householdId === householdId);
  const identity = (who) => (who.deviceId ? { kind: 'tablet', owner: null, deviceId: who.deviceId } : { kind: 'browser', owner: who.email, deviceId: null });
  const mine = (record, who) => (who.deviceId ? record.deviceId === who.deviceId : record.owner === who.email);

  async function addDevice(householdId, who, pub, label, by, cert) {
    const id = keyIdOf(pub);
    const existing = await store.get('vaultDevices', id);
    if (existing && existing.householdId !== householdId) throw new AuthError('vault', 'That device key belongs to another family.');
    const record = { id, householdId, ...identity(who), label: String(label ?? '').slice(0, 60) || (who.deviceId ? 'Saathi screen' : 'Browser'), pub, cert: certOf(cert), addedAt: now(), addedBy: by, status: 'active' };
    await store.put('vaultDevices', record);
    return record;
  }

  async function addRecovery(householdId, who, { pub, wrapped, split, cert }) {
    const id = keyIdOf(pub);
    for (const old of (await devices(householdId)).filter((d) => d.kind === 'recovery' && d.status === 'active' && d.id !== id)) {
      await store.update('vaultDevices', old.id, { status: 'removed', removedAt: now() });
    }
    await store.put('vaultDevices', { id, householdId, kind: 'recovery', owner: null, deviceId: null, label: split ? 'Recovery kit (3 sheets, any 2)' : 'Recovery kit', split: Boolean(split), pub, cert: certOf(cert), addedAt: now(), addedBy: who.email, status: 'active' });
    const m = await meta(householdId);
    const epochs = await storeGrants(householdId, id, wrapped, who.email);
    for (let e = 1; e <= m.epoch; e++) if (!epochs.includes(e)) throw new AuthError('vault', 'The recovery kit must hold every version of the family key.');
    return id;
  }

  async function storeGrants(householdId, keyId, wrapped, by) {
    const m = await meta(householdId);
    if (!Array.isArray(wrapped) || !wrapped.length) throw new AuthError('vault', 'No keys were sent.');
    const epochs = new Set();
    for (const w of wrapped) {
      const epoch = Number(w?.epoch);
      if (!Number.isInteger(epoch) || epoch < 1 || epoch > (m?.epoch ?? 1)) throw new AuthError('vault', 'That key is for an unknown version of the family key.');
      epochs.add(epoch);
      await store.put('vaultGrants', { id: `${keyId}:${epoch}`, householdId, keyId, epoch, wrapped: blob(w.wrapped), by, at: now() });
    }
    return [...epochs];
  }

  return {
    keyIdOf,

    async state(householdId, who) {
      const m = await meta(householdId);
      const all = await devices(householdId);
      const joins = (await store.list('vaultJoins')).filter((j) => j.householdId === householdId && j.expiresAt > now() && ['waiting', 'nonce', 'revealed'].includes(j.status));
      return {
        ready: Boolean(m),
        epoch: m?.epoch ?? 0,
        hasRecovery: all.some((d) => d.status === 'active' && d.kind === 'recovery'),
        recoverySplit: Boolean(all.find((d) => d.status === 'active' && d.kind === 'recovery')?.split),
        devices: all.filter((d) => d.status === 'active').map(({ id, kind, owner, label, addedAt, deviceId, pub, cert }) => ({ id, kind, owner, label, addedAt, deviceId: deviceId ?? null, pub, cert: cert ?? null, mine: who ? mine({ owner, deviceId }, who) : false })),
        joins: who?.email ? joins.map(({ id, kind, owner, label, status, createdAt, commit, approverNonce, pub, joinerNonce, approver }) => ({ id, kind, owner, label, status, createdAt, commit, approverNonce: approverNonce ?? null, pub: pub ?? null, joinerNonce: joinerNonce ?? null, approver: approver ?? null })) : [],
      };
    },

    async init(householdId, who, { device, wrapped, recovery }) {
      if (await meta(householdId)) throw new AuthError('vault', 'This family already has a private key. Join it from another device instead.');
      if (!recovery?.pub || !recovery?.wrapped) throw new AuthError('vault', 'Make the recovery kit first.');
      await store.put('vaultMeta', { id: householdId, epoch: 1, createdAt: now(), createdBy: who.email });
      const record = await addDevice(householdId, who, device.pub, device.label, who.email, device.cert);
      await storeGrants(householdId, record.id, wrapped, who.email);
      await addRecovery(householdId, who, recovery);
      log(householdId, who.email, 'family-key-created', { device: record.label, split: Boolean(recovery.split) });
      return { keyId: record.id, epoch: 1 };
    },

    async keysFor(householdId, who, keyId) {
      const record = await store.get('vaultDevices', String(keyId));
      const allowed = record?.kind === 'recovery' ? Boolean(who.email) : record && mine(record, who);
      if (!record || record.householdId !== householdId || record.status !== 'active' || !allowed) throw new AuthError('forbidden', 'Those keys are not for this device.');
      const grants = (await store.list('vaultGrants')).filter((g) => g.keyId === record.id && g.householdId === householdId);
      return { keyId: record.id, epoch: (await meta(householdId))?.epoch ?? 0, grants: grants.map(({ epoch, wrapped }) => ({ epoch, wrapped })) };
    },

    async startJoin(householdId, who, { commit, label }) {
      if (!(await meta(householdId))) throw new AuthError('vault', 'This family has no private key yet.');
      if (typeof commit !== 'string' || !B64U.test(commit) || commit.length !== 43) throw new AuthError('vault', 'That join request is not valid.');
      const open = (await store.list('vaultJoins')).filter((j) => j.householdId === householdId && j.expiresAt > now() && ['waiting', 'nonce', 'revealed'].includes(j.status));
      if (open.length >= 5) throw new AuthError('limit', 'Too many devices are waiting to join. Try again in a few minutes.');
      const join = { id: `vj_${randomBytes(12).toString('base64url')}`, householdId, ...identity(who), label: String(label ?? '').slice(0, 60), commit, status: 'waiting', createdAt: now(), expiresAt: new Date(clock().getTime() + JOIN_MS).toISOString() };
      await store.put('vaultJoins', join);
      log(householdId, who.email ?? who.deviceId, 'device-asked-for-family-key', { label: join.label });
      return { id: join.id, expiresAt: join.expiresAt };
    },

    async joinStatus(householdId, who, id) {
      const j = await store.get('vaultJoins', String(id));
      if (!j || j.householdId !== householdId || !mine(j, who)) throw new AuthError('forbidden', 'That request is not yours.');
      if (j.status !== 'approved' && j.status !== 'refused' && j.expiresAt < now()) return { status: 'expired' };
      return { status: j.status, approverNonce: j.approverNonce ?? null, keyId: j.keyId ?? null };
    },

    async approverNonce(householdId, who, id, nonce) {
      const j = await store.get('vaultJoins', String(id));
      if (!j || j.householdId !== householdId || j.expiresAt < now()) throw new AuthError('vault', 'That request has expired.');
      if (j.status !== 'waiting') throw new AuthError('vault', 'Someone else in the family is already checking this device.');
      if (j.owner && j.owner === who.email && j.kind === 'browser') {
        const hasOther = (await devices(householdId)).some((d) => d.status === 'active' && d.owner === who.email);
        if (!hasOther) throw new AuthError('vault', 'Approve this from one of your other devices, or ask someone else in the family.');
      }
      blob(nonce, 64);
      await store.update('vaultJoins', j.id, { status: 'nonce', approverNonce: nonce, approver: who.email });
      return { status: 'nonce' };
    },

    async reveal(householdId, who, id, { pub, nonce }) {
      const j = await store.get('vaultJoins', String(id));
      if (!j || j.householdId !== householdId || !mine(j, who)) throw new AuthError('forbidden', 'That request is not yours.');
      if (j.status !== 'nonce' || j.expiresAt < now()) throw new AuthError('vault', 'That request is not ready, or it expired.');
      blob(nonce, 64);
      if (commitmentOf(pub, nonce) !== j.commit) throw new AuthError('vault', 'The device key does not match what was promised.');
      await store.update('vaultJoins', j.id, { status: 'revealed', pub, joinerNonce: nonce });
      return { status: 'revealed' };
    },

    async decide(householdId, who, id, { approve, wrapped, cert }) {
      const j = await store.get('vaultJoins', String(id));
      if (!j || j.householdId !== householdId || j.expiresAt < now()) throw new AuthError('vault', 'That request has expired.');
      if (j.approver !== who.email) throw new AuthError('forbidden', 'Only the person who started checking this device can decide.');
      if (!approve) {
        await store.update('vaultJoins', j.id, { status: 'refused', decidedAt: now() });
        log(householdId, who.email, 'device-refused-family-key', { label: j.label });
        return { status: 'refused' };
      }
      if (j.status !== 'revealed') throw new AuthError('vault', 'Compare the pictures first.');
      const record = await addDevice(householdId, { email: j.owner, deviceId: j.deviceId }, j.pub, j.label, who.email, cert);
      const epochs = await storeGrants(householdId, record.id, wrapped, who.email);
      const m = await meta(householdId);
      if (!epochs.includes(m.epoch)) throw new AuthError('vault', 'The current family key was not included.');
      await store.update('vaultJoins', j.id, { status: 'approved', keyId: record.id, decidedAt: now() });
      log(householdId, who.email, 'device-given-family-key', { label: record.label, kind: record.kind });
      return { status: 'approved', keyId: record.id };
    },

    async rotate(householdId, who, { epoch, removed = [], grants }) {
      const m = await meta(householdId);
      if (!m) throw new AuthError('vault', 'This family has no private key yet.');
      if (Number(epoch) !== m.epoch + 1) throw new AuthError('vault', 'Someone else changed the family key just now. Try again.');
      const all = (await devices(householdId)).filter((d) => d.status === 'active');
      const gone = new Set(removed.map(String));
      const remaining = all.filter((d) => !gone.has(d.id));
      const covered = new Set((grants ?? []).map((g) => String(g.keyId)));
      const missing = remaining.filter((d) => !covered.has(d.id));
      if (missing.length) throw new AuthError('vault', `The new key was not given to: ${missing.map((d) => d.label).join(', ')}.`);
      await store.update('vaultMeta', householdId, { epoch: m.epoch + 1, rotatedAt: now() });
      for (const d of all.filter((x) => gone.has(x.id))) await store.update('vaultDevices', d.id, { status: 'removed', removedAt: now() });
      for (const g of grants) {
        if (gone.has(String(g.keyId))) throw new AuthError('vault', 'A removed device cannot get the new key.');
        await store.put('vaultGrants', { id: `${g.keyId}:${m.epoch + 1}`, householdId, keyId: String(g.keyId), epoch: m.epoch + 1, wrapped: blob(g.wrapped), by: who.email, at: now() });
        await store.update('vaultDevices', String(g.keyId), { cert: certOf(g.cert) });
      }
      log(householdId, who.email, 'family-key-rotated', { epoch: m.epoch + 1, removed: removed.length });
      return { epoch: m.epoch + 1 };
    },

    async removeDevicesOf(householdId, match) {
      const out = [];
      for (const d of (await devices(householdId)).filter((x) => x.status === 'active' && match(x))) out.push(d.id);
      return out;
    },

    async setRecovery(householdId, who, recovery) {
      if (!(await meta(householdId))) throw new AuthError('vault', 'This family has no private key yet.');
      const id = await addRecovery(householdId, who, recovery ?? {});
      log(householdId, who.email, 'family-recovery-kit-replaced', { split: Boolean(recovery?.split) });
      return { keyId: id };
    },

    async recoverDevice(householdId, who, { device, wrapped }) {
      if (!(await meta(householdId))) throw new AuthError('vault', 'This family has no private key yet.');
      const record = await addDevice(householdId, who, device.pub, device.label, `${who.email} (recovery kit)`, device.cert);
      await storeGrants(householdId, record.id, wrapped, who.email);
      log(householdId, who.email, 'family-key-restored-from-recovery-kit', { device: record.label });
      return { keyId: record.id };
    },
  };
}
