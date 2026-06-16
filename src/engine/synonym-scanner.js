// Synonym overuse scanner.
// Per design §8 (synonym-scanner.js). Depends on data/language.js (stopwords)
// and data/synonyms.js (entry lookups). The synonyms module is injected via
// opts so tests can stub it without touching real assets.

import { STOPWORDS_EN, STOPWORDS_RU } from "../data/language.js";

const SUGGESTION_CAP = 2;
const DEFAULT_TOP_N = 3;

// Tokenize a message into lowercase word tokens. Splits on anything that is
// not a letter (Latin or Cyrillic). Single-character tokens and pure-emoji
// messages naturally drop out — no script characters means no tokens.
function tokenize(text) {
  if (typeof text !== "string") return [];
  const matches = text.toLowerCase().match(/[a-zà-ɏ]+|[а-яё]+/gi);
  return matches ?? [];
}

function stopwordSetFor(lang) {
  return lang === "ru" ? STOPWORDS_RU : STOPWORDS_EN;
}

/**
 * Find overused words in recent chat history and surface synonym suggestions.
 *
 * @param {string[]} chatHistory  Array of message texts (caller maps ST chat → strings).
 * @param {string}   lang         'en' | 'ru'.
 * @param {object}   settings     Settings object; reads settings.synonyms.scanDepth
 *                                 and settings.synonyms.minOccurrences.
 * @param {object}   [opts]       { synonyms } — injectable data/synonyms stub.
 * @returns {Array<{word: string, count: number, suggestions: string[]}>}
 */
export function findOverusedWords(chatHistory, lang, settings, opts = {}) {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return [];

  const synSettings = settings?.synonyms ?? {};
  const scanDepth = synSettings.scanDepth ?? 0;
  const minOccurrences = synSettings.minOccurrences ?? 1;

  if (scanDepth <= 0) return [];

  const synonyms = opts.synonyms;
  // If no synonyms module is wired, lookups default to "no entry" — we still
  // return [] rather than throwing. The injector layer wires the real module.
  const hasEntry = synonyms?.hasEntry ?? (() => false);
  const getSynonyms = synonyms?.getSynonyms ?? (() => []);

  const stopwords = stopwordSetFor(lang);
  const window_ = chatHistory.slice(-scanDepth);

  const counts = new Map();
  for (const message of window_) {
    for (const token of tokenize(message)) {
      if (stopwords.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  const result = [];
  for (const [word, count] of counts) {
    if (count < minOccurrences) continue;
    if (!hasEntry(lang, word)) continue;
    const allSuggestions = getSynonyms(lang, word);
    if (allSuggestions.length === 0) continue;
    const suggestions = allSuggestions.slice(0, SUGGESTION_CAP);
    result.push({ word, count, suggestions });
  }

  result.sort(
    (a, b) => b.count - a.count || a.word.localeCompare(b.word)
  );

  const topN =
    Number.isInteger(synSettings.topN) && synSettings.topN > 0
      ? synSettings.topN
      : DEFAULT_TOP_N;

  return result.slice(0, topN);
}
