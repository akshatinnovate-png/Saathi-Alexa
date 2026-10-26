import { config } from '../config.js';
import { createServices } from '../services.js';

let services;
export async function handler(_event, _context, overrides) {
  services ??= createServices(config, overrides);
  const sent = [];
  for (const householdId of await services.householdIds()) {
    const letters = await services.forHousehold(householdId).weeklyLetters({ send: true });
    sent.push(...letters.map((l) => ({ householdId, memberId: l.memberId, language: l.language })));
  }
  return { sent };
}
