export const DEFAULT_FEED_URL = 'https://raw.githubusercontent.com/akshatinnovate-png/Saathi-Alexa/main/feeds/scam-patterns.json';
const ISSUES = 'https://github.com/akshatinnovate-png/Saathi-Alexa/issues/new';
export const PATTERN_KINDS = ['bank', 'code', 'money', 'prize', 'remote', 'threat', 'remote-access', 'remote-payment', 'otp-page', 'tech-support', 'gift-card', 'digital-arrest', 'tamper'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function parseFeed(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || data.version !== 1 || !Array.isArray(data.warnings)) throw new Error('Not a Saathi scam feed');
  return data.warnings.flatMap((w) => {
    const id = text(w?.id, 60);
    const say = Object.fromEntries(Object.entries(w?.say ?? {}).map(([l, v]) => [l, text(v, 400)]).filter(([l, v]) => /^[a-z]{2}$/.test(l) && v));
    const title = Object.fromEntries(Object.entries(w?.title ?? {}).map(([l, v]) => [l, text(v, 120)]).filter(([l, v]) => /^[a-z]{2}$/.test(l) && v));
    if (!/^[a-z0-9-]+$/.test(id) || !say.en || !title.en || !DATE.test(w.from ?? '') || !DATE.test(w.until ?? '')) return [];
    const countries = (Array.isArray(w.countries) ? w.countries : []).filter((c) => /^[A-Z]{2}$/.test(c));
    const kinds = (Array.isArray(w.kinds) ? w.kinds : []).filter((k) => PATTERN_KINDS.includes(k));
    return [{ id, title, say, countries, kinds, from: w.from, until: w.until }];
  });
}

export function activeWarnings(warnings, { country, today }) {
  return warnings.filter((w) => w.from <= today && today <= w.until && (!w.countries.length || (country && w.countries.includes(country))));
}

export function shareLink({ kinds, country, language }) {
  const clean = [...new Set((kinds ?? []).filter((k) => PATTERN_KINDS.includes(k)))].sort();
  const body = [
    'A Saathi household saw this kind of scam and chose to share the pattern. No names, numbers, messages or recordings are included.',
    '',
    `- Kinds: ${clean.join(', ') || 'unknown'}`,
    `- Country: ${/^[A-Z]{2}$/.test(country ?? '') ? country : 'unknown'}`,
    `- Language: ${/^[a-z]{2}$/.test(language ?? '') ? language : 'unknown'}`,
    '',
    'If you know how this scam is being told (for example "a call about an unpaid electricity bill"), add one line below. Please do not include anything that identifies a person.',
  ].join('\n');
  const params = new URLSearchParams({ title: `Scam pattern: ${clean.join(', ') || 'unknown'} (${country || 'unknown'})`, labels: 'scam-pattern', body });
  return { kinds: clean, country: country ?? null, language: language ?? null, url: `${ISSUES}?${params}` };
}

export function createScamNetwork({ url = DEFAULT_FEED_URL, fetchImpl = fetch, log = console } = {}) {
  let warnings = [];
  let fetchedAt = null;
  return {
    get warnings() { return warnings; },
    get fetchedAt() { return fetchedAt; },
    load(list) { warnings = parseFeed(list); fetchedAt = new Date().toISOString(); return warnings.length; },
    async refresh() {
      try {
        const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`feed answered ${res.status}`);
        const body = await res.text();
        if (body.length > 256_000) throw new Error('feed is too large');
        warnings = parseFeed(body);
        fetchedAt = new Date().toISOString();
        return warnings.length;
      } catch (err) {
        log.warn?.(`scam feed not updated: ${err.message}`);
        return null;
      }
    },
  };
}
