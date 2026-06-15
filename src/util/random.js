// Pure-function sampling and history helpers used by engine/random-words.js.
// Per design §8 — no I/O, no side effects beyond the passed-in array.

/**
 * In-place Fisher-Yates shuffle. Returns the same array reference.
 * Pure — mutates `arr` but nothing else.
 *
 * @param {Array<unknown>} arr
 * @returns {Array<unknown>} the same reference, now shuffled
 */
export function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Return up to `n` unique elements from `pool`, excluding anything in
 * `exclude`. Never returns duplicates. Does not mutate `pool`.
 *
 * Sampling is done by shuffling a copy of the eligible pool and slicing.
 * This keeps the implementation simple and the output unbiased while
 * avoiding the bookkeeping of a set-based draw loop.
 *
 * @param {Array<string>} pool
 * @param {number} n
 * @param {Set<string>} exclude
 * @returns {Array<string>}
 */
export function sampleWithoutReplacement(pool, n, exclude) {
  if (n <= 0 || pool.length === 0) return [];

  // Build a filtered copy — never mutate the caller's array.
  const eligible = [];
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i];
    if (!exclude.has(w)) eligible.push(w);
  }

  if (eligible.length === 0) return [];

  // Fisher-Yates on the eligible copy, then slice the first n.
  // Reusing shuffleInPlace keeps the implementation DRY.
  shuffleInPlace(eligible);
  return eligible.slice(0, Math.min(n, eligible.length));
}

/**
 * Push a word onto the front of a history buffer, capping length at
 * `maxSize`. If the word is already present the call is a no-op (no
 * duplicate, no reorder).
 *
 * Returns a new array — does not mutate the caller's array.
 *
 * @param {Array<string>} history
 * @param {string} word
 * @param {number} maxSize
 * @returns {Array<string>}
 */
export function pushUniqueHistory(history, word, maxSize) {
  if (history.includes(word)) return history;

  const next = [word, ...history];
  if (next.length > maxSize) next.length = maxSize;
  return next;
}
