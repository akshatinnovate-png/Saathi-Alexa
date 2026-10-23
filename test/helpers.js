import { config as baseConfig } from '../src/config.js';
import { createServices } from '../src/services.js';
import { createFileStore } from '../src/local/fileStore.js';

export const quiet = { emit() {} };

export function testConfig(patch = {}) {
  return {
    ...baseConfig,
    aws: Object.fromEntries(Object.keys(baseConfig.aws).map((k) => [k, false])),
    escalation: { familyAckWaitSeconds: 1, neighbourAckWaitSeconds: 1 },
    ...patch,
  };
}

export const fixedClock = () => new Date('2026-10-23T05:30:00Z');

export function testServices(overrides = {}) {
  const sleeps = [];
  const services = createServices(testConfig(), {
    store: createFileStore({ persist: false }),
    metrics: quiet,
    clock: fixedClock,
    sleep: async (ms) => { sleeps.push(ms); },
    ...overrides,
  });
  return { ...services, sleeps };
}
