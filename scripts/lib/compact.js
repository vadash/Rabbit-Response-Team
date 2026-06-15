// Shared compact/normalize helpers for the build pipeline.
// Pure functions only — no I/O, no mutation of inputs.

const LATIN_RE = /^[a-z]+$/;
const CYRILLIC_RE = /^[а-яё]+$/;

/**
 * Lowercase a word. Returns a new string.
 */
export function lowercaseWord(w) {
  return w.toLowerCase();
}

/**
 * Reject words that contain anything other than pure Latin or pure Cyrillic.
 * Returns true if the word should be rejected.
 */
export function rejectNonScript(w) {
  return !LATIN_RE.test(w) && !CYRILLIC_RE.test(w);
}

/**
 * Reject words shorter than min (default 2) or longer than max (default 20).
 * Returns true if the word should be rejected.
 */
export function rejectByLength(w, min = 2, max = 20) {
  return w.length < min || w.length > max;
}

/**
 * Dedupe [word, pos, rank] tuples by word — keeps the entry with the lowest rank.
 * Returns a new array; input is not mutated.
 */
export function dedupeKeepLowestRank(tuples) {
  const best = new Map();
  for (let i = 0; i < tuples.length; i++) {
    const t = tuples[i];
    const w = t[0];
    const r = t[2];
    const prev = best.get(w);
    if (prev === undefined || r < prev[2]) {
      best.set(w, t);
    }
  }
  // Preserve first-seen order
  const seen = new Set();
  const out = [];
  for (const t of tuples) {
    const w = t[0];
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(best.get(w));
  }
  return out;
}

/**
 * Cap an array to at most n elements. Returns a new array.
 */
export function capList(arr, n) {
  if (n <= 0) return [];
  if (arr.length <= n) return arr.slice();
  return arr.slice(0, n);
}
