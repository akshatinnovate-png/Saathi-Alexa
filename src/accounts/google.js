import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { rfc822 } from '../mail/mailer.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()), state: b64url(randomBytes(16)) };
}

export function createVault(secret) {
  const key = createHash('sha256').update(`saathi-vault:${secret}`).digest();
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), body].map(b64url).join('.');
    },
    open(sealed) {
      const [iv, tag, body] = String(sealed).split('.').map((p) => Buffer.from(p, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    },
  };
}

export function createGoogle({ clientId, clientSecret, fetchImpl = fetch, jwks }) {
  const keys = jwks ?? createRemoteJWKSet(new URL(JWKS_URL));

  async function token(params) {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error_description ?? json.error ?? `Google token request failed (${res.status})`);
    return json;
  }

  return {
    authUrl({ redirectUri, state, challenge, nonce, gmail = false, loginHint }) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: ['openid', 'email', 'profile', ...(gmail ? [GMAIL_SEND_SCOPE] : [])].join(' '),
        state,
        ...(nonce ? { nonce } : {}),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: gmail ? 'consent' : 'select_account',
        ...(gmail ? { access_type: 'offline', include_granted_scopes: 'true' } : {}),
        ...(loginHint ? { login_hint: loginHint } : {}),
      });
      return `${AUTH_URL}?${params}`;
    },

    async finish({ code, verifier, redirectUri, nonce }) {
      const tokens = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
      const { payload } = await jwtVerify(tokens.id_token, keys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: clientId });
      if (nonce && payload.nonce !== nonce) throw new Error('The Google sign-in did not match this request.');
      if (!payload.email || payload.email_verified === false) throw new Error('Google did not confirm an email address for this account.');
      return {
        identity: { email: String(payload.email).toLowerCase(), name: payload.name ?? payload.given_name ?? null, sub: `google:${payload.sub}`, picture: payload.picture ?? null },
        refreshToken: tokens.refresh_token ?? null,
        scopes: String(tokens.scope ?? '').split(' '),
      };
    },

    gmailSender({ email, name, refreshToken }) {
      let cached = null;
      const accessToken = async () => {
        if (cached && cached.expires > Date.now() + 60_000) return cached.token;
        const out = await token({ grant_type: 'refresh_token', refresh_token: refreshToken });
        cached = { token: out.access_token, expires: Date.now() + (out.expires_in ?? 3600) * 1000 };
        return cached.token;
      };
      return {
        kind: 'gmail-api',
        from: email,
        async send({ to, subject, html, text, replyTo }) {
          const raw = Buffer.from(rfc822({ from: name ? `"${name.replace(/["\\\r\n]/g, '')}" <${email}>` : email, to, subject, html, text, replyTo })).toString('base64url');
          const res = await fetchImpl(GMAIL_SEND_URL, {
            method: 'POST',
            headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
            body: JSON.stringify({ raw }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error?.message ?? `Gmail send failed (${res.status})`);
          return json.id;
        },
      };
    },
  };
}
