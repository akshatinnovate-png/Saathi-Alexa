import { createHash, randomBytes } from 'node:crypto';
import {
  CognitoIdentityProviderClient, SignUpCommand, ConfirmSignUpCommand, InitiateAuthCommand, ResendConfirmationCodeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cognitoIssuer } from '../auth/verifier.js';

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const COGNITO_ERRORS = {
  UsernameExistsException: ['exists', 'An account with this email already exists. Try logging in.'],
  NotAuthorizedException: ['credentials', 'That email and password do not match.'],
  UserNotFoundException: ['credentials', 'That email and password do not match.'],
  UserNotConfirmedException: ['unconfirmed', 'Please confirm your email with the code we sent you.'],
  CodeMismatchException: ['code', 'That code is not right. Check the latest email from Saathi.'],
  ExpiredCodeException: ['code', 'That code has expired. We can send a new one.'],
  InvalidPasswordException: ['password', 'Use at least 10 characters, with letters and a number.'],
  LimitExceededException: ['limit', 'Too many attempts. Please wait a few minutes.'],
  TooManyRequestsException: ['limit', 'Too many attempts. Please wait a few minutes.'],
};

function translateError(err) {
  const known = COGNITO_ERRORS[err.name];
  return known ? new AuthError(known[0], known[1]) : err;
}

export function createCognitoAccounts({ region, userPoolId, clientId, domain, publicUrl, client, jwks }) {
  const idp = client ?? new CognitoIdentityProviderClient({ region });
  const issuer = cognitoIssuer({ region, userPoolId });
  const keys = jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const call = async (command) => {
    try {
      return await idp.send(command);
    } catch (err) {
      throw translateError(err);
    }
  };

  async function verifyIdToken(idToken) {
    const { payload } = await jwtVerify(idToken, keys, { issuer, audience: clientId });
    if (payload.token_use !== 'id') throw new AuthError('credentials', 'Not an identity token');
    return { sub: payload.sub, email: String(payload.email ?? '').toLowerCase(), name: payload.name ?? payload.given_name ?? null, emailVerified: payload.email_verified === true || payload.email_verified === 'true' };
  }

  return {
    kind: 'cognito',
    async signUp({ email, password, name }) {
      await call(new SignUpCommand({
        ClientId: clientId,
        Username: email,
        Password: password,
        UserAttributes: [{ Name: 'email', Value: email }, ...(name ? [{ Name: 'name', Value: name }] : [])],
      }));
      return { confirm: true };
    },
    async confirm({ email, code }) {
      await call(new ConfirmSignUpCommand({ ClientId: clientId, Username: email, ConfirmationCode: code }));
    },
    async resend({ email }) {
      await call(new ResendConfirmationCodeCommand({ ClientId: clientId, Username: email }));
    },
    async login({ email, password }) {
      const out = await call(new InitiateAuthCommand({
        ClientId: clientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }));
      if (!out.AuthenticationResult?.IdToken) throw new AuthError('challenge', 'This account needs an extra sign-in step that Saathi does not support yet.');
      return verifyIdToken(out.AuthenticationResult.IdToken);
    },
    socialStart(provider) {
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(16).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const url = new URL(`https://${domain}.auth.${region}.amazoncognito.com/oauth2/authorize`);
      url.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: `${publicUrl}/auth/callback`,
        scope: 'openid email profile', identity_provider: provider, state,
        code_challenge: challenge, code_challenge_method: 'S256',
      }).toString();
      return { url: url.toString(), verifier, state };
    },
    async socialFinish({ code, verifier }) {
      const res = await fetch(`https://${domain}.auth.${region}.amazoncognito.com/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: `${publicUrl}/auth/callback`, code_verifier: verifier }),
      });
      if (!res.ok) throw new AuthError('social', 'The sign-in provider did not accept that login.');
      return verifyIdToken((await res.json()).id_token);
    },
  };
}
