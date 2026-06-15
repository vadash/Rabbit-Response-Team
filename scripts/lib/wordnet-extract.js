// WordNet EN synonym / association extractor — design §10.2 steps 5–7
// Loads the `wordnet-db` dict once, then answers per-word lookups.
// Synonyms = other words in the same synset(s) as the query word.
// Associations = words reachable via @ (hypernym) / ~ (hyponym) pointers.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { BUILD } from "../constants.js";

const require = createRequire(import.meta.url);
const WN_PATH = path.dirname(require.resolve("wordnet-db/package.json"));
const DICT_DIR = path.join(WN_PATH, "dict");

// ---------------------------------------------------------------------------
// Lazy-loaded indices. Built once on first lookup, then kept in memory.
// ---------------------------------------------------------------------------

/** @type {Map<string, Array<{ offset: string, pos: string }>> | null} */
let wordIndex = null;

/** @type {Map<string, { words: string[], pointers: Array<{ symbol: string, offset: string }> }> | null} */
let synsetIndex = null;

/**
 * Strip WordNet lemma quirks: underscores become spaces, apostrophe variants
 * normalized. WordNet keys are lowercased already.
 */
function normalizeLemma(raw) {
  return raw.replace(/_/g, " ").replace(/'/g, "'").toLowerCase();
}

/**
 * Parse a WordNet data.* file (one synset per line) into an offset-keyed map.
 * Returns Map<offset, { words: string[], pointers: Array<{symbol, offset}> }>.
 */
function parseDataFile(filePath) {
  const out = new Map();
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith(" ")) continue; // skip header / blank
    const [beforeGloss, _gloss] = line.split(" | ");
    if (!beforeGloss) continue;
    const tokens = beforeGloss.trim().split(/\s+/);
    if (tokens.length < 6) continue;
    const offset = tokens[0];
    // tokens[1] = lex_filenum, tokens[2] = ss_type, tokens[3] = w_cnt
    const wCnt = Number.parseInt(tokens[3], 10);
    if (!Number.isFinite(wCnt)) continue;
    const words = [];
    let pos = 4;
    for (let i = 0; i < wCnt; i++) {
      const w = tokens[pos];
      if (!w) break;
      words.push(normalizeLemma(w));
      // skip optional lex_id (single digit after the word, or # for satellite markers)
      pos++;
      if (pos < tokens.length && /^\d+$/.test(tokens[pos])) pos++;
    }
    if (pos >= tokens.length) continue;
    const pCnt = Number.parseInt(tokens[pos], 10);
    if (!Number.isFinite(pCnt)) continue;
    pos++;
    const pointers = [];
    for (let i = 0; i < pCnt; i++) {
      const symbol = tokens[pos];
      const ptrOffset = tokens[pos + 1];
      if (!symbol || !ptrOffset) break;
      pointers.push({ symbol, offset: ptrOffset });
      // skip target lex_filenum + target lex_id (2 tokens)
      pos += 4;
    }
    out.set(offset, { words, pointers });
  }
  return out;
}

/**
 * Parse an index.* file into a Map<lemma, Array<{offset, pos}>>.
 * One line per lemma+sense; multiple senses for the same lemma are merged.
 */
function parseIndexFile(filePath, posCode) {
  const out = new Map();
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith(" ")) continue;
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) continue;
    const lemma = normalizeLemma(tokens[0]);
    // tokens[1] = pos (n | v | a | r | s)
    // tokens[2] = synset_cnt
    // tokens[3] = p_cnt
    const synsetCnt = Number.parseInt(tokens[2], 10);
    if (!Number.isFinite(synsetCnt)) continue;
    // p_cnt pointer-symbol tokens follow; then sense_cnt, sense_id, then
    // synset_cnt offset tokens.
    const pCnt = Number.parseInt(tokens[3], 10);
    if (!Number.isFinite(pCnt)) continue;
    const senseCntIdx = 4 + pCnt;
    if (senseCntIdx >= tokens.length) continue;
    // sense_cnt not strictly needed — synset_cnt offsets follow sense_id
    const firstOffsetIdx = senseCntIdx + 2;
    const entries = out.get(lemma) || [];
    for (let i = 0; i < synsetCnt; i++) {
      const off = tokens[firstOffsetIdx + i];
      if (off) entries.push({ offset: off, pos: posCode });
    }
    out.set(lemma, entries);
  }
  return out;
}

function ensureLoaded() {
  if (wordIndex && synsetIndex) return;
  wordIndex = new Map();
  synsetIndex = new Map();
  const files = [
    { idx: "index.noun", pos: "n", data: "data.noun" },
    { idx: "index.verb", pos: "v", data: "data.verb" },
    { idx: "index.adj",  pos: "a", data: "data.adj" },
    { idx: "index.adv",  pos: "r", data: "data.adv" },
  ];
  for (const f of files) {
    const dataPath = path.join(DICT_DIR, f.data);
    const idxPath = path.join(DICT_DIR, f.idx);
    if (fs.existsSync(dataPath)) {
      for (const [off, info] of parseDataFile(dataPath)) {
        synsetIndex.set(off, info);
      }
    }
    if (fs.existsSync(idxPath)) {
      for (const [lemma, entries] of parseIndexFile(idxPath, f.pos)) {
        const prev = wordIndex.get(lemma) || [];
        wordIndex.set(lemma, prev.concat(entries));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract EN synonyms and associations for a single word.
 * @param {string} word
 * @returns {{ s: string[], a: string[] }}
 */
export function extractEnSynonyms(word) {
  if (!word || typeof word !== "string") {
    return { s: [], a: [] };
  }
  ensureLoaded();
  const lemma = normalizeLemma(word);
  const entries = wordIndex.get(lemma);
  if (!entries || entries.length === 0) {
    return { s: [], a: [] };
  }

  const synonymSet = new Set();
  const associationSet = new Set();

  for (const entry of entries) {
    const synset = synsetIndex.get(entry.offset);
    if (!synset) continue;

    // Synonyms = every other word in the same synset
    for (const w of synset.words) {
      if (w !== lemma) synonymSet.add(w);
    }

    // Associations = follow @ (hypernym) and ~ (hyponym) pointers
    for (const ptr of synset.pointers) {
      if (ptr.symbol !== "@" && ptr.symbol !== "~") continue;
      const target = synsetIndex.get(ptr.offset);
      if (!target) continue;
      for (const w of target.words) {
        if (w !== lemma) associationSet.add(w);
      }
    }
  }

  const s = Array.from(synonymSet).slice(0, BUILD.SYNONYMS_PER_WORD);
  const a = Array.from(associationSet).slice(0, BUILD.ASSOCIATIONS_PER_WORD);
  return { s, a };
}
