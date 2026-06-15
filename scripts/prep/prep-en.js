// Raw-data preparation for English.
// Combines FrequencyWords (frequency rank) + WordNet (POS) into the
// [word, pos, rank] tuple shape that scripts/lib/normalize-en.js expects.
//
// Inputs (scripts/raw/):
//   en-freq.txt — "word count" lines, sorted by frequency desc
//                  (source: https://github.com/hermitdave/FrequencyWords)
//
// Output (overwrites scripts/raw/en.json):
//   [[word, "NN"|"VB"|"JJ"|"RB", rank], ...]   (Penn Treebank tags)
//
// Usage: node scripts/prep/prep-en.js

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RAW = path.join(REPO_ROOT, "scripts", "raw");

const require = createRequire(import.meta.url);
const WN_PATH = path.dirname(require.resolve("wordnet-db/package.json"));
const DICT_DIR = path.join(WN_PATH, "dict");

function parseIndex(filePath, pennTag) {
  const out = new Map();
  if (!fs.existsSync(filePath)) return out;
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith(" ")) continue;
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) continue;
    const lemma = tokens[0].toLowerCase().replace(/_/g, " ");
    if (!out.has(lemma)) out.set(lemma, pennTag);
  }
  return out;
}

const nounMap = parseIndex(path.join(DICT_DIR, "index.noun"), "NN");
const verbMap = parseIndex(path.join(DICT_DIR, "index.verb"), "VB");
const adjMap = parseIndex(path.join(DICT_DIR, "index.adj"), "JJ");
const advMap = parseIndex(path.join(DICT_DIR, "index.adv"), "RB");
console.error(`WordNet: ${nounMap.size} nouns, ${verbMap.size} verbs, ${adjMap.size} adj, ${advMap.size} adv`);

const freqPath = path.join(RAW, "en-freq.txt");
if (!fs.existsSync(freqPath)) {
  console.error(`Missing ${freqPath}. Download from FrequencyWords first.`);
  process.exit(1);
}

const freqLines = fs.readFileSync(freqPath, "utf-8").split(/\r?\n/);
const out = [];
const seen = new Set();
let rank = 0;
let skipped = 0;
for (const line of freqLines) {
  if (!line) continue;
  const [word] = line.split(" ");
  if (!word) continue;
  const w = word.toLowerCase();
  if (seen.has(w)) continue;
  let pos = null;
  if (nounMap.has(w)) pos = "NN";
  else if (verbMap.has(w)) pos = "VB";
  else if (adjMap.has(w)) pos = "JJ";
  else if (advMap.has(w)) pos = "RB";
  if (!pos) { skipped++; continue; }
  rank++;
  seen.add(w);
  out.push([w, pos, rank]);
}

fs.writeFileSync(path.join(RAW, "en.json"), JSON.stringify(out));
console.error(`Wrote ${out.length} tuples to scripts/raw/en.json (skipped ${skipped} words without WordNet POS)`);
