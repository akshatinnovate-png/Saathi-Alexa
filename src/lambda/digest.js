import { config } from '../config.js';
import { createServices } from '../services.js';

let services;
export async function handler(_event, _context, overrides) {
  services ??= createServices(config, overrides);
  const letters = await services.saathi.weeklyLetters({ send: true });
  return { sent: letters.map((l) => ({ memberId: l.memberId, language: l.language })) };
}
