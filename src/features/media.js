export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/x-m4a'];

export const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export function imageInput(buffer, contentType, { maxBytes = 6_000_000 } = {}) {
  const mimeType = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(mimeType)) throw bad('Send a photo (JPEG, PNG, WebP or HEIC).');
  if (!buffer?.length) throw bad('The photo is empty.');
  if (buffer.length > maxBytes) throw bad('That photo is too large. Try a smaller one.');
  return { mimeType, data: Buffer.from(buffer).toString('base64') };
}

export function audioInput(buffer, contentType, { maxBytes = 12_000_000 } = {}) {
  const mimeType = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!AUDIO_TYPES.includes(mimeType)) throw bad('That recording format is not supported.');
  if (!buffer?.length) throw bad('The recording is empty.');
  if (buffer.length > maxBytes) throw bad('The recording is too long. Keep it under about 20 minutes.');
  return { mimeType, data: Buffer.from(buffer).toString('base64') };
}

export function needsModel(llm, what) {
  if (!llm?.understand) throw bad(`${what} needs an AI model. Turn on Claude or Gemini in Saathi's settings.`, 503);
}

export const TIME_SLOTS = { morning: '08:00', afternoon: '14:00', evening: '18:00', night: '21:00' };

export function timesFrom(value) {
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const v of list) {
    const s = String(v ?? '').trim().toLowerCase();
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) out.push(s);
    else if (TIME_SLOTS[s]) out.push(TIME_SLOTS[s]);
  }
  return [...new Set(out)].sort().slice(0, 6);
}
