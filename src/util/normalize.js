// Canonical match-key pipeline shared by the build scripts and runtime.
// Reduces a raw token to its stem-based comparison key.
// Order matters: ё→е must run BEFORE the Snowball RU stemmer.
//
// The stemmer is applied iteratively to a fixed point: Porter (EN) and
// Snowball (RU) are NOT idempotent on their own output (e.g. RU "сказал" →
// "сказа" → "сказ"). Iterating guarantees `normalize(x) === normalize(normalize(x))`,
// which the asset verifier relies on and which makes runtime token lookup
// match the build-time key form.

import { stem as stemEn } from "./porter.js";
import { stem as stemRu } from "./snowball-ru.js";

const MAX_STEM_ITERATIONS = 8;

/**
 * Apply `stem` repeatedly until output stabilises (or safety cap hit).
 * @param {(s: string) => string} stem
 * @param {string} input
 * @returns {string}
 */
function toFixedPoint(stem, input) {
  let current = input;
  for (let i = 0; i < MAX_STEM_ITERATIONS; i++) {
    const next = stem(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Reduce a raw token to its match key.
 * @param {unknown} word
 * @param {"en"|"ru"|"auto"|string} lang
 * @returns {string}
 */
export function normalize(word, lang) {
  if (typeof word !== "string") return "";
  const lower = word.toLowerCase().trim();
  if (lower === "") return "";

  if (lang === "ru") {
    return toFixedPoint(stemRu, lower.replace(/ё/g, "е"));
  }
  if (lang === "en") {
    return toFixedPoint(stemEn, lower);
  }
  return lower;
}
