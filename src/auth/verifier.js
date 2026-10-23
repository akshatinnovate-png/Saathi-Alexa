import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { ALL_SCOPES, SCOPES } from './scopes.js';

export function createVerifier(auth) {
  switch (auth.mode) {
    case 'none':
      return null;
    case 'static':
      return createStaticVerifier(auth);
    case 'cognito':
      return createCognitoVerifier(auth);
    default:
      throw new Error(`Unknown auth mode ${auth.mode}`);
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createStaticVerifier({ elderToken, familyToken }) {
  const entries = [
    elderToken && { token: elderToken, clientId: 'elder-device', scopes: ALL_SCOPES },
    familyToken && { token: familyToken, clientId: 'family-device', scopes: [SCOPES.family] },
  ].filter(Boolean);
  return {
    async verifyAccessToken(token) {
      const match = entries.find((e) => safeEqual(token, e.token));
      if (!match) throw new InvalidTokenError('Unknown token');
      return { token, clientId: match.clientId, scopes: match.scopes, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    },
  };
}

export function cognitoIssuer({ region, userPoolId }) {
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

export function createCognitoVerifier({ region, userPoolId, clientIds = [], jwks }) {
  const issuer = cognitoIssuer({ region, userPoolId });
  const keySet = jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return {
    async verifyAccessToken(token) {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, keySet, { issuer }));
      } catch (err) {
        throw new InvalidTokenError(`Invalid token: ${err.code ?? err.message}`);
      }
      if (payload.token_use !== 'access') throw new InvalidTokenError('Not an access token');
      if (clientIds.length && !clientIds.includes(payload.client_id)) throw new InvalidTokenError('Unknown client');
      return {
        token,
        clientId: payload.client_id,
        scopes: String(payload.scope ?? '').split(' ').filter((s) => ALL_SCOPES.includes(s)),
        expiresAt: payload.exp,
        extra: { sub: payload.sub, username: payload.username },
      };
    },
  };
}

export function cognitoOAuthMetadata({ region, userPoolId, domain }) {
  const base = `https://${domain}.auth.${region}.amazoncognito.com`;
  return {
    issuer: cognitoIssuer({ region, userPoolId }),
    authorization_endpoint: `${base}/oauth2/authorize`,
    token_endpoint: `${base}/oauth2/token`,
    revocation_endpoint: `${base}/oauth2/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    scopes_supported: ALL_SCOPES,
  };
}
