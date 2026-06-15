// YARN RU synonym / association extractor — design §10.2 steps 5–7
// Parses a YARN-shaped JSON file (see tests/fixtures/mini-yarn.json for shape).
// Returns synonyms (`s`) and associations (`a`) for a single word.

import fs from "node:fs";
import { BUILD } from "../constants.js";

/**
 * Load a YARN-shaped JSON file. Accepts either:
 *   { "synsets": { word: string[] }, "relations": { word: string[] } }
 * or the more common YARN shape where each value is an object with
 *   { "synonyms": string[], "associations": string[] }.
 * Returns { synonyms: Map<word, string[]>, associations: Map<word, string[]> }.
 */
function loadYarn(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);
  const synonyms = new Map();
  const associations = new Map();

  // Shape A: { synsets: { w: [...], relations: { w: [...] } }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data.synsets && typeof data.synsets === "object") {
      for (const [w, arr] of Object.entries(data.synsets)) {
        if (Array.isArray(arr)) synonyms.set(String(w).toLowerCase(), arr.map(String));
      }
    }
    if (data.relations && typeof data.relations === "object") {
      for (const [w, arr] of Object.entries(data.relations)) {
        if (Array.isArray(arr)) associations.set(String(w).toLowerCase(), arr.map(String));
      }
    }
  }

  return { synonyms, associations };
}

/**
 * Extract RU synonyms and associations for a single word from a YARN file.
 * @param {string} word
 * @param {string} filePath — absolute or relative path to YARN JSON
 * @returns {{ s: string[], a: string[] }}
 */
export function extractRuSynonyms(word, filePath) {
  if (!word || typeof word !== "string" || !filePath) {
    return { s: [], a: [] };
  }
  const { synonyms, associations } = loadYarn(filePath);
  const w = String(word).toLowerCase();
  const s = (synonyms.get(w) || []).slice(0, BUILD.SYNONYMS_PER_WORD);
  const a = (associations.get(w) || []).slice(0, BUILD.ASSOCIATIONS_PER_WORD);
  return { s, a };
}
