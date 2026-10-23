import { config } from '../config.js';
import { createServices } from '../services.js';

let services;
export async function handler() {
  services ??= createServices(config);
  const raised = await services.saathi.sweepMissedDoses();
  const quietDay = await services.saathi.sweepQuietDay();
  return { raised, quietDay };
}
