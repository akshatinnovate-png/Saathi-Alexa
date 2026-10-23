import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { config } from '../config.js';
import { createServices } from '../services.js';
import { verifySignature, normaliseRingEvent, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../ring/webhook.js';

let services;
let secretPromise;

function secret() {
  if (!config.ring.webhookSecretArn) return Promise.resolve(config.ring.webhookSecret);
  secretPromise ??= new SecretsManagerClient({ region: config.region })
    .send(new GetSecretValueCommand({ SecretId: config.ring.webhookSecretArn }))
    .then((out) => out.SecretString);
  return secretPromise;
}

export async function handler(event, _context, overrides) {
  services ??= createServices(config, overrides);
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const check = verifySignature({ secret: await secret(), signature: headers[SIGNATURE_HEADER], timestamp: headers[TIMESTAMP_HEADER], rawBody });
  if (!check.ok) return { statusCode: 401, body: JSON.stringify({ error: check.reason }) };
  let ringEvent;
  try {
    ringEvent = normaliseRingEvent(JSON.parse(rawBody));
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
  }
  const result = await services.saathi.doorEvent(ringEvent);
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) };
}

export function _reset() {
  services = undefined;
  secretPromise = undefined;
}
