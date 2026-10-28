import { createHash, randomBytes } from 'node:crypto';

const DING = 'com.ring.pn.live-event.ding';
const MOTION = 'com.ring.pn.live-event.motion';
const PENDING_MS = 10 * 60 * 1000;
const hash = (token) => createHash('sha256').update(token).digest('hex');

export function doorKind(input) {
  const raw = String(input ?? '').toLowerCase();
  if (['ding', 'ring', 'press', 'pressed', 'doorbell', 'button'].some((k) => raw.includes(k))) return 'ding';
  if (['motion', 'movement', 'person', 'detected'].some((k) => raw.includes(k))) return 'motion';
  return null;
}

export function createDoorbell({ store, services, vault, publicUrl, ring = null, log = console }) {
  const listeners = new Map();
  const pending = new Map();
  const loadRing = async () => {
    if (ring) return ring;
    try {
      return {
        RingApi: (await import('ring-client-api')).RingApi,
        RingRestClient: (await import('ring-client-api/rest-client')).RingRestClient,
      };
    } catch {
      throw Object.assign(new Error('Ring support is not installed on this Saathi. Whoever runs it can add it with: npm run add-ring'), { status: 400, code: 'ring-missing' });
    }
  };

  const settings = async (householdId) => (await store.get('doorbellSettings', householdId)) ?? { id: householdId };
  const saveSettings = (s) => store.put('doorbellSettings', s);

  async function newHook(householdId) {
    const current = await settings(householdId);
    if (current.hookId) await store.remove('doorbellHooks', current.hookId);
    const token = `dbh_${randomBytes(24).toString('base64url')}`;
    const hookId = hash(token);
    await store.put('doorbellHooks', { id: hookId, householdId, createdAt: new Date().toISOString() });
    await saveSettings({ ...current, hookId, hook: vault.seal(token) });
    return `${publicUrl}/hooks/doorbell/${token}`;
  }

  async function handleHook(token, payload = {}) {
    const hook = token ? await store.get('doorbellHooks', hash(String(token))) : null;
    if (!hook) return null;
    const kind = doorKind(payload.event ?? payload.kind ?? payload.type ?? payload.action ?? 'ding');
    if (!kind) throw Object.assign(new Error('Send event "ding" or "motion".'), { status: 400 });
    return services.forHousehold(hook.householdId).doorEvent({ kind, deviceId: String(payload.device ?? 'doorbell').slice(0, 60) });
  }

  async function onRingToken(householdId, refreshToken, extra = {}) {
    const current = await settings(householdId);
    await saveSettings({ ...current, ring: { ...(current.ring ?? {}), ...extra, refreshToken: vault.seal(refreshToken) } });
  }

  async function listen(householdId) {
    const current = await settings(householdId);
    if (!current.ring?.refreshToken) return null;
    listeners.get(householdId)?.disconnect();
    const { RingApi } = await loadRing();
    const api = new RingApi({ refreshToken: vault.open(current.ring.refreshToken), controlCenterDisplayName: 'Saathi' });
    api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
      onRingToken(householdId, newRefreshToken).catch((err) => log.error('could not save the new Ring token:', err.message));
    });
    const cameras = await api.getCameras();
    for (const camera of cameras) {
      camera.onNewNotification.subscribe((notification) => {
        const category = notification?.android_config?.category ?? notification?.action;
        const kind = category === DING ? 'ding' : category === MOTION ? 'motion' : null;
        if (!kind) return;
        services.forHousehold(householdId).doorEvent({ kind, deviceId: `ring-${camera.id}` })
          .catch((err) => log.error(`doorbell event failed for ${householdId}:`, err.message));
      });
    }
    listeners.set(householdId, api);
    const names = cameras.map((c) => c.name);
    await saveSettings({ ...(await settings(householdId)), ring: { ...(await settings(householdId)).ring, cameras: names, listeningSince: new Date().toISOString(), error: null } });
    return names;
  }

  async function connected(householdId, client, email) {
    pending.delete(householdId);
    await onRingToken(householdId, client.refreshToken, { email, connectedAt: new Date().toISOString() });
    const cameras = await listen(householdId);
    return { connected: true, cameras };
  }

  return {
    newHook,
    handleHook,
    listen,

    async status(householdId) {
      const s = await settings(householdId);
      return {
        hookUrl: s.hook ? `${publicUrl}/hooks/doorbell/${vault.open(s.hook)}` : null,
        ring: s.ring?.refreshToken ? { connected: true, email: s.ring.email ?? null, cameras: s.ring.cameras ?? [], error: s.ring.error ?? null } : { connected: false },
        waitingForCode: pending.has(householdId),
      };
    },

    async connectRing(householdId, { email, password }) {
      if (!email || !password) throw Object.assign(new Error('Enter the email and password of the Ring account.'), { status: 400 });
      const { RingRestClient } = await loadRing();
      const client = new RingRestClient({ email: String(email).trim(), password: String(password) });
      try {
        await client.getAuth();
        return connected(householdId, client, email);
      } catch (err) {
        if (client.using2fa) {
          pending.set(householdId, { client, email, at: Date.now() });
          return { needsCode: true, prompt: client.promptFor2fa ?? 'Enter the code Ring sent you.' };
        }
        throw Object.assign(new Error(/correct/.test(err.message) ? 'Ring did not accept that email and password.' : `Ring said: ${err.message}`), { status: 400 });
      }
    },

    async verifyRingCode(householdId, code) {
      const p = pending.get(householdId);
      if (!p || Date.now() - p.at > PENDING_MS) throw Object.assign(new Error('Start again: enter the Ring email and password.'), { status: 400 });
      try {
        await p.client.getAuth(String(code ?? '').trim());
      } catch (err) {
        throw Object.assign(new Error(p.client.promptFor2fa?.startsWith('Invalid') ? 'That code was not right. Try the newest code.' : `Ring said: ${err.message}`), { status: 400 });
      }
      return connected(householdId, p.client, p.email);
    },

    async disconnectRing(householdId) {
      listeners.get(householdId)?.disconnect();
      listeners.delete(householdId);
      const s = await settings(householdId);
      delete s.ring;
      await saveSettings(s);
      return { connected: false };
    },

    async startAll() {
      for (const s of await store.list('doorbellSettings')) {
        if (!s.ring?.refreshToken) continue;
        try {
          await listen(s.id);
        } catch (err) {
          log.error(`Ring listener for ${s.id} failed:`, err.message);
          await saveSettings({ ...s, ring: { ...s.ring, error: err.message } });
        }
      }
    },

    stopAll() {
      for (const api of listeners.values()) api.disconnect();
      listeners.clear();
    },
  };
}
