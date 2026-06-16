// Canonical match-key pipeline shared by the build scripts and runtime.
// Reduces a raw token to its stem-based comparison key.
// Order matters: ё→е must run BEFORE the Snowball RU stemmer.

import { stem as stemEn } from "./porter.js";
import { stem as stemRu } from "./snowball-ru.js";

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
    return stemRu(lower.replace(/ё/g, "е"));
  }
  if (lang === "en") {
    return stemEn(lower);
  }
  return lower;
}
