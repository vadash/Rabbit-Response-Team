import { normalize } from "../../src/util/normalize.js";

export { normalize };

/**
 * Union two arrays preserving first-seen order.
 * @param {string[]} base
 * @param {string[]} add
 * @returns {string[]}
 */
function unionOrdered(base, add) {
  const seen = new Set(base);
  const out = [...base];
  for (const x of add) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Re-key a { word: { s, a } } synonyms map by normalize(word, lang).
 * Headwords that collapse to the same stem merge their s/a arrays with
 * first-seen dedupe. Values are preserved verbatim (not stemmed).
 *
 * @param {Record<string, { s: string[], a: string[] }>} synonyms
 * @param {"en"|"ru"|string} lang
 * @returns {Record<string, { s: string[], a: string[] }>}
 */
export function stemAndMergeSynonyms(synonyms, lang) {
  const out = {};
  for (const [word, entry] of Object.entries(synonyms)) {
    const key = normalize(word, lang);
    if (!key) continue;
    const existing = out[key];
    if (!existing) {
      out[key] = { s: [...entry.s], a: [...entry.a] };
      continue;
    }
    existing.s = unionOrdered(existing.s, entry.s);
    existing.a = unionOrdered(existing.a, entry.a);
  }
  return out;
}
