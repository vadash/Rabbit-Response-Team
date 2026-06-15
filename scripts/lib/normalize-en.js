// English normalizer — transforms raw frequency-list rows into
// [word, pos, rank] tuples per design §5.1 / §10.2 steps 1–3.

import {
  lowercaseWord,
  rejectNonScript,
  rejectByLength,
  dedupeKeepLowestRank,
} from "./compact.js";

// Penn Treebank POS → single-character code.
const POS_MAP = {
  NN: "n", NNS: "n", NNP: "n", NNPS: "n",
  VB: "v", VBD: "v", VBG: "v", VBN: "v", VBP: "v", VBZ: "v",
  JJ: "a", JJR: "a", JJS: "a",
  RB: "r", RBR: "r", RBS: "r",
};

/**
 * Normalize a raw EN frequency list.
 * @param {Array<[string, string, number]>} rawRows
 * @returns {Array<[string, string, number]>} filtered, deduped tuples
 */
export function normalizeEn(rawRows) {
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
