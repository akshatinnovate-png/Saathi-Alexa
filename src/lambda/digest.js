import { config } from '../config.js';
import { createServices } from '../services.js';

let services;
export async function handler(event, _context, overrides) {
  services ??= createServices(config, overrides);
  const sent = [];
  for (const householdId of await services.householdIds()) {
    const letters = (event?.force ? await services.forHousehold(householdId).weeklyLetters({ send: true }) : await services.forHousehold(householdId).sweepWeeklyLetter()) ?? [];
    sent.push(...letters.map((l) => ({ householdId, memberId: l.memberId, language: l.language })));
  }
  return { sent };
}
