export const LANGUAGES = {
  en: { name: 'English', native: 'English', bcp47: 'en-IN', pollyVoice: 'Kajal', pollyLanguage: 'en-IN' },
  hi: { name: 'Hindi', native: 'हिन्दी', bcp47: 'hi-IN', pollyVoice: 'Kajal', pollyLanguage: 'hi-IN' },
  mr: { name: 'Marathi', native: 'मराठी', bcp47: 'mr-IN', pollyVoice: 'Kajal', pollyLanguage: 'hi-IN' },
  ta: { name: 'Tamil', native: 'தமிழ்', bcp47: 'ta-IN', pollyVoice: null, pollyLanguage: null },
  bn: { name: 'Bengali', native: 'বাংলা', bcp47: 'bn-IN', pollyVoice: null, pollyLanguage: null },
  es: { name: 'Spanish', native: 'Español', bcp47: 'es-US', pollyVoice: 'Lupe', pollyLanguage: 'es-US' },
  fr: { name: 'French', native: 'Français', bcp47: 'fr-FR', pollyVoice: 'Lea', pollyLanguage: 'fr-FR' },
  ar: { name: 'Arabic', native: 'العربية', bcp47: 'ar-AE', pollyVoice: 'Hala', pollyLanguage: 'ar-AE' },
};

export const LANGUAGE_CODES = Object.keys(LANGUAGES);

export function languageName(code) {
  return LANGUAGES[code]?.name ?? code;
}
