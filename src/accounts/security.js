import { createHash, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import {
  generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { AuthError } from './cognito.js';
import { newTotpSecret, verifyTotp, otpauthUrl, newRecoveryCodes } from '../security/totp.js';

const CHALLENGE_MS = 5 * 60 * 1000;
const RECOVERY = /^[a-z2-7]{5}-[a-z2-7]{5}$/;

export function createAccountSecurity({ accounts, store, sealer, rp, clock = () => new Date() }) {
  const recoveryHash = (email, code) => createHash('sha256').update(`saathi-recovery:${email}:${code.toLowerCase()}`).digest('base64url');
  const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const need = async (email) => {
    const account = await accounts.raw(email);
    if (!account) throw new AuthError('account', 'Please log in again.');
    return account;
  };

  async function verifyMfa(email, code) {
    const account = await need(email);
    const given = String(code ?? '').trim().toLowerCase();
    if (RECOVERY.test(given)) {
      const hash = recoveryHash(account.email, given);
      const codes = account.recovery ?? [];
      const match = codes.find((c) => same(c, hash));
      if (!match) return null;
      await accounts.update(account.email, { recovery: codes.filter((c) => c !== match) });
      return { method: 'recovery', left: codes.length - 1 };
    }
    if (!account.totp?.enabled) return null;
    const step = verifyTotp(await sealer.open(account.totp.secret), given, { now: clock().getTime(), lastStep: account.totp.lastStep ?? -1 });
    if (step === null) return null;
    await accounts.update(account.email, { totp: { ...account.totp, lastStep: step } });
    return { method: 'totp' };
  }

  return {
    rp,
    verifyMfa,

    async summary(email) {
      const account = await need(email);
      return {
        hasPassword: Boolean(account.passwordHash),
        totp: Boolean(account.totp?.enabled),
        recoveryLeft: (account.recovery ?? []).length,
        passkeys: (account.passkeys ?? []).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt ?? null, backedUp: Boolean(p.backedUp) })),
      };
    },

    async startTotp(email) {
      const account = await need(email);
      if (account.totp?.enabled) throw new AuthError('exists', 'Two-step sign-in is already on.');
      const secret = newTotpSecret();
      await accounts.update(account.email, { totpPending: { secret: await sealer.seal(secret), at: clock().toISOString() } });
      const url = otpauthUrl({ secret, account: account.email });
      return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), url, qr: await QRCode.toString(url, { type: 'svg', margin: 1 }) };
    },

    async confirmTotp(email, code) {
      const account = await need(email);
      const pending = account.totpPending;
      if (!pending || clock().getTime() - Date.parse(pending.at) > 15 * 60 * 1000) throw new AuthError('code', 'Start again: the setup expired.');
      const step = verifyTotp(await sealer.open(pending.secret), code, { now: clock().getTime() });
      if (step === null) throw new AuthError('code', 'That code was not right. Type the 6 numbers your app shows now.');
      const codes = newRecoveryCodes();
      await accounts.update(account.email, {
        totp: { enabled: true, secret: pending.secret, lastStep: step, enabledAt: clock().toISOString() },
        totpPending: null,
        recovery: codes.map((c) => recoveryHash(account.email, c)),
      });
      return { recoveryCodes: codes };
    },

    async disableTotp(email, code) {
      if (!(await verifyMfa(email, code))) throw new AuthError('code', 'That code was not right.');
      await accounts.update(email, { totp: null, recovery: [] });
      return { totp: false };
    },

    async newRecoveryCodes(email, code) {
      if (!(await verifyMfa(email, code))) throw new AuthError('code', 'That code was not right.');
      const codes = newRecoveryCodes();
      await accounts.update(email, { recovery: codes.map((c) => recoveryHash(email, c)) });
      return { recoveryCodes: codes };
    },

    async passkeyRegistrationOptions(email) {
      const account = await need(email);
      const options = await generateRegistrationOptions({
        rpName: rp.name, rpID: rp.id, userName: account.email, userDisplayName: account.name ?? account.email,
        userID: createHash('sha256').update(`saathi-user:${account.email}`).digest().subarray(0, 32),
        attestationType: 'none',
        excludeCredentials: (account.passkeys ?? []).map((p) => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        supportedAlgorithmIDs: [-7, -8, -257],
        extensions: { prf: {} },
      });
      await accounts.update(account.email, { webauthnChallenge: { value: options.challenge, at: clock().toISOString() } });
      return options;
    },

    async registerPasskey(email, response, name) {
      const account = await need(email);
      const challenge = account.webauthnChallenge;
      if (!challenge || clock().getTime() - Date.parse(challenge.at) > CHALLENGE_MS) throw new AuthError('passkey', 'That took too long. Please try again.');
      await accounts.update(account.email, { webauthnChallenge: null });
      let result;
      try {
        result = await verifyRegistrationResponse({ response, expectedChallenge: challenge.value, expectedOrigin: rp.origins, expectedRPID: rp.id, requireUserVerification: true });
      } catch (err) {
        throw new AuthError('passkey', `The passkey could not be saved: ${err.message}`);
      }
      if (!result.verified) throw new AuthError('passkey', 'The passkey could not be verified.');
      const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
      if (await store.get('passkeyIndex', credential.id)) throw new AuthError('exists', 'That passkey is already saved.');
      const passkey = {
        id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter,
        transports: response.response?.transports ?? credential.transports ?? [], deviceType: credentialDeviceType, backedUp: credentialBackedUp,
        name: String(name || 'Passkey').slice(0, 40), createdAt: clock().toISOString(),
      };
      await accounts.update(account.email, { passkeys: [...(account.passkeys ?? []), passkey] });
      await store.put('passkeyIndex', { id: credential.id, email: account.email });
      return { id: passkey.id, name: passkey.name };
    },

    async removePasskey(email, id) {
      const account = await need(email);
      const left = (account.passkeys ?? []).filter((p) => p.id !== id);
      if (left.length === (account.passkeys ?? []).length) return false;
      if (!left.length && !account.passwordHash && account.provider === 'local') throw new AuthError('forbidden', 'Keep at least one way to sign in.');
      await accounts.update(account.email, { passkeys: left });
      await store.remove('passkeyIndex', id);
      return true;
    },

    passkeyLoginOptions: () => generateAuthenticationOptions({ rpID: rp.id, userVerification: 'required' }),

    async verifyPasskeyLogin(response, expectedChallenge) {
      const index = response?.id ? await store.get('passkeyIndex', String(response.id)) : null;
      if (!index) throw new AuthError('passkey', 'That passkey is not registered here.');
      const account = await need(index.email);
      const passkey = (account.passkeys ?? []).find((p) => p.id === index.id);
      if (!passkey) throw new AuthError('passkey', 'That passkey was removed.');
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response, expectedChallenge, expectedOrigin: rp.origins, expectedRPID: rp.id, requireUserVerification: true,
          credential: { id: passkey.id, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')), counter: passkey.counter, transports: passkey.transports },
        });
      } catch (err) {
        throw new AuthError('passkey', `The passkey could not be checked: ${err.message}`);
      }
      if (!result.verified) throw new AuthError('passkey', 'The passkey could not be checked.');
      const { newCounter } = result.authenticationInfo;
      if (passkey.counter > 0 && newCounter <= passkey.counter) throw new AuthError('passkey', 'This passkey looks cloned, so it was refused. Remove it and add it again.');
      await accounts.update(account.email, { passkeys: account.passkeys.map((p) => (p.id === passkey.id ? { ...p, counter: newCounter, lastUsedAt: clock().toISOString() } : p)) });
      return account.email;
    },
  };
}
