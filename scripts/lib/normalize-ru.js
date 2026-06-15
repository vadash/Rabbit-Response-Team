// Russian normalizer — transforms Badestrand-style rows into
// [word, pos, rank] tuples per design §5.1 / §10.2 steps 1–3.

import {
  lowercaseWord,
  rejectNonScript,
  rejectByLength,
  dedupeKeepLowestRank,
} from "./compact.js";

// Badestrand POS strings → single-character code.
const POS_MAP = {
  "существительное": "n",
  "глагол":           "v",
  "прилагательное":  "a",
  "наречие":         "r",
};

/**
 * Normalize a raw RU frequency list.
 * @param {Array<[string, string, number]>} rawRows
 * @returns {Array<[string, string, number]>} filtered, deduped tuples
 */
export function normalizeRu(rawRows) {
  const kept = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const word = lowercaseWord(row[0]);
    if (rejectNonScript(word)) continue;
    if (rejectByLength(word)) continue;
    const pos = POS_MAP[row[1]];
    if (pos === undefined) continue;
    const rank = row[2];
    kept.push([word, pos, rank]);
  }
  return dedupeKeepLowestRank(kept);
}
