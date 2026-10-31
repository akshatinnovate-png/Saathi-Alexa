const SVG_ONLY = /^\s*<svg[\s>][\s\S]*<\/svg>\s*$/i;
const FORBIDDEN = /<\s*(script|iframe|object|embed|foreignobject|link|meta|style|image|a\b)|(?:^|[^a-z0-9_-])on[a-z]+\s*=|javascript:|data:text\/html|href\s*=\s*["']?(?!#)/i;

export function checkSvg(markup) {
  const text = String(markup);
  if (!SVG_ONLY.test(text) || FORBIDDEN.test(text)) throw new TypeError('Saathi blocked HTML that is not a plain icon.');
  return text;
}

const policy = globalThis.trustedTypes?.createPolicy?.('saathi', { createHTML: checkSvg });

export const svg = (markup) => (policy ? policy.createHTML(markup) : checkSvg(markup));
