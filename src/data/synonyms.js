// Synonym and association lookups.
// Per design §4 (asset URL resolution via import.meta.url), §5.2 (entry shape),
// §8 (exports), §9.2 (lazy + per-language caching).
//
// The fetcher and URL resolver are injectable via configure() so unit tests can
// supply fixtures without touching the real bundled assets.

const cache = { en: null, ru: null };

let urlResolver = defaultUrlResolver;
let fetcher = defaultFetcher;

function defaultUrlResolver(lang) {
  return new URL(`../../assets/${lang}/synonyms.json`, import.meta.url).href;
}

async function defaultFetcher(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load synonyms ${url}: ${res.status}`);
  }
  return res.json();
}

export function configure({ fetcher: f, urlResolver: r } = {}) {
  if (f) fetcher = f;
  if (r) urlResolver = r;
}

export function _resetCache() {
  cache.en = null;
  cache.ru = null;
}

export async function ensureSynonymsLoaded(lang) {
  if (cache[lang]) return;
  const url = urlResolver(lang);
  const data = await fetcher(url);
  cache[lang] = data;
}

export function getSynonyms(lang, word) {
  const data = cache[lang];
  if (!data) return [];
  return data[word]?.s ?? [];
}

export function getAssociations(lang, word) {
  const data = cache[lang];
  if (!data) return [];
  return data[word]?.a ?? [];
}

export function hasEntry(lang, word) {
  const data = cache[lang];
  if (!data) return false;
  return Object.prototype.hasOwnProperty.call(data, word);
}
