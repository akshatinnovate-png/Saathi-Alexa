import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { config } from '../config.js';
import { createServices } from '../services.js';
import { buildMcpServer } from '../mcp/server.js';
import { createVerifier, cognitoIssuer } from '../auth/verifier.js';
import { ALL_SCOPES } from '../auth/scopes.js';

let services;
let verifier;

export function toRequest(event) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) if (v !== undefined) headers.set(k, v);
  const host = headers.get('host') ?? 'localhost';
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const method = event.requestContext?.http?.method ?? 'POST';
  const body = event.body === undefined || event.body === null ? undefined
    : event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
  return new Request(`https://${host}${event.rawPath ?? '/mcp'}${query}`, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body });
}

export async function fromResponse(response) {
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: response.body ? await response.text() : '',
  };
}

const json = (statusCode, body, headers = {}) => ({ statusCode, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

function resourceUrl(request) {
  const url = new URL(request.url);
  return `${config.auth.publicUrl ?? url.origin}/mcp`;
}

function protectedResourceMetadata(request) {
  return {
    resource: resourceUrl(request),
    authorization_servers: config.auth.mode === 'cognito' ? [cognitoIssuer(config.auth)] : [],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Saathi',
  };
}

async function authenticate(request) {
  if (!verifier) return { authInfo: undefined };
  const header = request.headers.get('authorization') ?? '';
  const metadataUrl = `${new URL(resourceUrl(request)).origin}/.well-known/oauth-protected-resource/mcp`;
  const challenge = (error) => json(401, { error, error_description: 'A valid Saathi access token is required' }, {
    'www-authenticate': `Bearer error="${error}", resource_metadata="${metadataUrl}"`,
  });
  if (!/^Bearer\s+\S+/i.test(header)) return { response: challenge('invalid_token') };
  try {
    const authInfo = await verifier.verifyAccessToken(header.replace(/^Bearer\s+/i, ''));
    if (authInfo.expiresAt && authInfo.expiresAt < Date.now() / 1000) return { response: challenge('invalid_token') };
    return { authInfo };
  } catch {
    return { response: challenge('invalid_token') };
  }
}

export async function handler(event, _context, overrides) {
  services ??= createServices(config, overrides);
  verifier ??= overrides?.verifier ?? createVerifier(config.auth);
  const request = toRequest(event);

  if (new URL(request.url).pathname.startsWith('/.well-known/oauth-protected-resource')) {
    return json(200, protectedResourceMetadata(request));
  }

  const { authInfo, response } = await authenticate(request);
  if (response) return response;

  const server = buildMcpServer(services.saathi);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await fromResponse(await transport.handleRequest(request, { authInfo }));
  } finally {
    await server.close();
  }
}

export function _reset() {
  services = undefined;
  verifier = undefined;
}
