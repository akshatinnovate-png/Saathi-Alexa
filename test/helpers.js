import { config as baseConfig } from '../src/config.js';
import { createServices } from '../src/services.js';
import { createFileStore } from '../src/local/fileStore.js';
import { seedData } from '../src/domain/seed.js';
import { keyringFromMaster } from '../src/security/keyring.js';

export const sealedSuite = process.env.SAATHI_TEST_SEAL === '1' ? keyringFromMaster(Buffer.alloc(32, 7)) : null;

export const quiet = { emit() {} };

export function testConfig(patch = {}) {
  return {
    ...baseConfig,
    demo: true,
    aws: Object.fromEntries(Object.keys(baseConfig.aws).map((k) => [k, false])),
    escalation: { familyAckWaitSeconds: 1, neighbourAckWaitSeconds: 1 },
    ...patch,
  };
}

export const fixedClock = () => new Date('2026-10-23T05:30:00Z');

export function testServices(overrides = {}) {
  const sleeps = [];
  const services = createServices(testConfig(), {
    store: createFileStore({ persist: false, seed: () => seedData(fixedClock()) }),
    metrics: quiet,
    clock: fixedClock,
    sleep: async (ms) => { sleeps.push(ms); },
    keyring: sealedSuite,
    ...overrides,
  });
  return { ...services, sleeps };
}
