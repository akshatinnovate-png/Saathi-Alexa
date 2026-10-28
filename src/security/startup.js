const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopbackHost(host) {
  return LOOPBACK.has(String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase());
}

export function exposure(config) {
  const site = config.auth?.publicUrl ? new URL(config.auth.publicUrl) : null;
  const publicSite = Boolean(site && !isLoopbackHost(site.hostname));
  return { publicSite, exposed: publicSite || !isLoopbackHost(config.host), site };
}

export function startupProblems(config, { env = process.env } = {}) {
  const { exposed, publicSite, site } = exposure(config);
  const errors = [];
  const warnings = [];
  if (exposed && config.web?.requireLogin === false && !config.demo) {
    errors.push('SAATHI_REQUIRE_LOGIN=false is only allowed when Saathi listens on this computer alone. Anyone on the network could read the family\'s data.');
  }
  if (exposed && config.web?.sessionSecret && config.web.sessionSecret.length < 32) {
    errors.push('SAATHI_SESSION_SECRET is too short. Use at least 32 random characters, or remove it and let Saathi make its own key.');
  }
  if (env.SAATHI_MASTER_KEY && Buffer.from(env.SAATHI_MASTER_KEY, 'base64').length < 32) {
    errors.push('SAATHI_MASTER_KEY must be 32 random bytes in base64. Make one with: node -e "console.log(crypto.randomBytes(32).toString(\'base64\'))"');
  }
  if (publicSite && site.protocol !== 'https:') {
    warnings.push(`The public address ${site.origin} is not https. Passwords and sign-in links would travel unencrypted.`);
  }
  if (exposed && !config.demo && env.SAATHI_RING_WEBHOOK_SECRET === undefined && config.ring?.webhookSecret === 'local-ring-simulator-secret') {
    warnings.push('No Ring webhook secret was set, so Saathi made a private one from its encryption key.');
  }
  if (exposed && config.demo) {
    warnings.push('Demo mode is reachable from the network. The demo family\'s password is public.');
  }
  return { errors, warnings, exposed };
}
