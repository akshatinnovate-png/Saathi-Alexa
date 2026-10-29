import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const bytes = readFileSync(new URL('./saathi-core.wasm', import.meta.url));
const { exports: wasm } = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const CORE_SHA256 = createHash('sha256').update(bytes).digest('hex');

function call(request) {
  const input = encoder.encode(JSON.stringify(request));
  const ptr = wasm.saathi_alloc(input.length);
  new Uint8Array(wasm.memory.buffer, ptr, input.length).set(input);
  const packed = wasm.saathi_call(ptr, input.length);
  wasm.saathi_free(ptr, input.length);
  const outPtr = Number(packed >> 32n);
  const outLen = Number(packed & 0xffffffffn);
  const text = decoder.decode(new Uint8Array(wasm.memory.buffer, outPtr, outLen).slice());
  wasm.saathi_free(outPtr, outLen);
  const out = JSON.parse(text);
  if (out.error) throw new Error(`saathi-core: ${out.error}`);
  return out;
}

const b64 = (key) => Buffer.from(key).toString('base64');

export const coreVersion = () => call({ op: 'version' }).version;
export const coreCatalog = () => call({ op: 'actions' });

export function decide({ principal, action, household }) {
  return call({ op: 'decide', principal, action, household: String(household ?? '') });
}

export function mayCallTool({ scopes = null, tool, exposed = false }) {
  return call({ op: 'tool', caller: scopes ? { scopes } : { local: true }, tool, exposed }).ok;
}

export function sessionState({ kind, createdAt, lastSeenAt, reauthAt = null, now = Date.now() }) {
  const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));
  const reauth = reauthAt ? ms(reauthAt) : null;
  return call({ op: 'session', kind, created: ms(createdAt), lastSeen: ms(lastSeenAt), reauthAt: Number.isFinite(reauth) ? reauth : null, now });
}

export function chainLink(key, prev, canonical) {
  return call({ op: 'chain.link', key: b64(key), prev, canonical }).mac;
}

export function chainVerify(key, rows, head) {
  return call({ op: 'chain.verify', key: b64(key), rows, head });
}
