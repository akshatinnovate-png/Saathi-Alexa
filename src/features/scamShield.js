import { createReadStream, statSync } from 'node:fs';
import { bad } from './media.js';

const SHA256 = /^[a-f0-9]{64}$/;
const HTTPS = /^https:\/\/[^\s]+$/;

export function modelFrom(env = process.env) {
  const sha256 = String(env.SAATHI_GEMMA_MODEL_SHA256 ?? '').trim().toLowerCase();
  const url = String(env.SAATHI_GEMMA_MODEL_URL ?? '').trim();
  const file = String(env.SAATHI_GEMMA_MODEL_FILE ?? '').trim();
  const name = String(env.SAATHI_GEMMA_MODEL_NAME ?? 'Gemma 3 1B').trim().slice(0, 60);
  if (!SHA256.test(sha256)) return null;
  if (file) {
    try {
      const { size } = statSync(file);
      return { name, sha256, bytes: size, file, url: null };
    } catch {
      return null;
    }
  }
  if (HTTPS.test(url)) return { name, sha256, bytes: Number(env.SAATHI_GEMMA_MODEL_BYTES) || null, file: null, url };
  return null;
}

export function createScamShield({ services, model = null }) {
  const saathiFor = (householdId) => services.forHousehold(householdId);

  return {
    async view(householdId) {
      const saathi = saathiFor(householdId);
      const me = await saathi.elder();
      return {
        enabled: Boolean(me?.scamShield?.enabled),
        language: me?.language ?? 'en',
        model: model ? { name: model.name, sha256: model.sha256, bytes: model.bytes, url: model.file ? '/api/scam-shield/model' : model.url } : null,
        recent: await saathi.scamShieldEvents({ limit: 10 }),
      };
    },

    async report(householdId, input = {}) {
      const me = await saathiFor(householdId).elder();
      if (!me?.scamShield?.enabled) throw bad('Scam Shield is switched off for this household.', 409);
      return saathiFor(householdId).reportScamMessage(input);
    },

    sendModel(res) {
      if (!model?.file) throw bad('No on-device model is set up on this Saathi.', 404);
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-length', String(model.bytes));
      res.setHeader('x-content-sha256', model.sha256);
      res.setHeader('cache-control', 'private, max-age=86400, immutable');
      createReadStream(model.file).pipe(res);
    },
  };
}
