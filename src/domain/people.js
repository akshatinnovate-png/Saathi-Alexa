const FORMS = {
  she: { subject: 'she', object: 'her', possessive: 'her', is: 'is', has: 'has', was: 'was' },
  he: { subject: 'he', object: 'him', possessive: 'his', is: 'is', has: 'has', was: 'was' },
  they: { subject: 'they', object: 'them', possessive: 'their', is: 'are', has: 'have', was: 'were' },
};

export const PRONOUNS = Object.keys(FORMS);

export function pronounsOf(person) {
  const p = FORMS[person?.pronoun] ?? FORMS.they;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  return { ...p, Subject: cap(p.subject), Possessive: cap(p.possessive), Object: cap(p.object) };
}

export const COUNTRIES = {
  IN: { name: 'India', emergency: '112' },
  US: { name: 'United States', emergency: '911' },
  CA: { name: 'Canada', emergency: '911' },
  GB: { name: 'United Kingdom', emergency: '999' },
  IE: { name: 'Ireland', emergency: '112' },
  AU: { name: 'Australia', emergency: '000' },
  NZ: { name: 'New Zealand', emergency: '111' },
  AE: { name: 'United Arab Emirates', emergency: '999' },
  SA: { name: 'Saudi Arabia', emergency: '911' },
  QA: { name: 'Qatar', emergency: '999' },
  SG: { name: 'Singapore', emergency: '995' },
  MY: { name: 'Malaysia', emergency: '999' },
  HK: { name: 'Hong Kong', emergency: '999' },
  JP: { name: 'Japan', emergency: '119' },
  NP: { name: 'Nepal', emergency: '102' },
  BD: { name: 'Bangladesh', emergency: '999' },
  LK: { name: 'Sri Lanka', emergency: '1990' },
  PK: { name: 'Pakistan', emergency: '1122' },
  ZA: { name: 'South Africa', emergency: '112' },
  KE: { name: 'Kenya', emergency: '999' },
  DE: { name: 'Germany', emergency: '112' },
  FR: { name: 'France', emergency: '112' },
  ES: { name: 'Spain', emergency: '112' },
  IT: { name: 'Italy', emergency: '112' },
  NL: { name: 'Netherlands', emergency: '112' },
  SE: { name: 'Sweden', emergency: '112' },
  CH: { name: 'Switzerland', emergency: '144' },
  MX: { name: 'Mexico', emergency: '911' },
  BR: { name: 'Brazil', emergency: '192' },
};

export function emergencyNumberFor(profile) {
  return profile?.emergencyNumber || COUNTRIES[profile?.country]?.emergency || null;
}

export function isTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return Boolean(tz);
  } catch {
    return false;
  }
}
