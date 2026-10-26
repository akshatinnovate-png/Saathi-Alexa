import { config } from '../config.js';
import { createServices } from '../services.js';

let services;
export async function handler(_event, _context, overrides) {
  services ??= createServices(config, overrides);
  const results = {};
  for (const householdId of await services.householdIds()) {
    const saathi = services.forHousehold(householdId);
    try {
      results[householdId] = {
        raised: await saathi.sweepMissedDoses(),
        quietDay: await saathi.sweepQuietDay(),
        refills: await saathi.sweepSupplies(),
        escorts: await saathi.sweepAppointments(),
      };
    } catch (err) {
      results[householdId] = { error: err.message };
    }
  }
  const demo = results.default ?? {};
  return { ...demo, households: results };
}
