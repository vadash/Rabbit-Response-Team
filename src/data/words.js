// Word bank loading and sampling.
// Per design §4 (asset URL resolution via import.meta.url), §5.1 (tuple shape),
// §8 (exports), §9.2 (lazy + per-language caching).
//
// The fetcher and URL resolver are injectable via configure() so unit tests can
// supply fixtures without touching the real bundled assets.

import { shuffleInPlace } from "../util/random.js";

const cache = { en: null, ru: null };

let urlResolver = defaultUrlResolver;
let fetcher = defaultFetcher;

function defaultUrlResolver(lang) {
  return new URL(`../../assets/${lang}/words.json`, import.meta.url).href;
}

async function defaultFetcher(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load word bank ${url}: ${res.status}`);
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

export async function ensureWordBankLoaded(lang) {
  if (cache[lang]) return;
  const url = urlResolver(lang);
  const data = await fetcher(url);
  cache[lang] = data;
}

export function getWordBank(lang) {
  return cache[lang] ?? [];
}

export function getWordMeta(lang, word) {
  const bank = cache[lang];
  if (!bank) return null;
  for (let i = 0; i < bank.length; i++) {
    if (bank[i][0] === word) {
      return { pos: bank[i][1], rank: bank[i][2] };
    }
  }
  return null;
}

export function sampleWords(lang, opts) {
  const {
    count = 0,
    pos,
    minRank = 1,
    maxRank = Number.POSITIVE_INFINITY,
    wordLength = 0,
    blacklist = new Set(),
    history = new Set(),
  } = opts;

  const bank = getWordBank(lang);
  if (!bank || bank.length === 0 || count <= 0) return [];

  const eligible = [];
  for (let i = 0; i < bank.length; i++) {
    const entry = bank[i];
    const word = entry[0];
    const p = entry[1];
    const rank = entry[2];

    if (blacklist.has(word)) continue;
    if (history.has(word)) continue;
    if (rank < minRank || rank > maxRank) continue;
    if (pos && !pos.includes(p)) continue;
    if (wordLength && word.length !== wordLength) continue;

    eligible.push(word);
  }

  shuffleInPlace(eligible);
  return eligible.slice(0, count);
}
