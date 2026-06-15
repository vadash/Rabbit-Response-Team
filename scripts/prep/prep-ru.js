// Raw-data preparation for Russian.
// Combines FrequencyWords (frequency rank) + Badestrand CSVs (POS) into the
// [word, pos, rank] tuple shape that scripts/lib/normalize-ru.js expects.
//
// Inputs (scripts/raw/):
//   ru-freq.txt      — "word count" lines, sorted by frequency desc
//                      (source: https://github.com/hermitdave/FrequencyWords)
//   ru-nouns.csv     — bare-word rows (source: Badestrand/russian-dictionary)
//   ru-adjectives.csv
//   ru-verbs.csv
//
// Output (overwrites scripts/raw/ru.json):
//   [[word, "существительное"|"прилагательное"|"глагол", rank], ...]
//
// Usage: node scripts/prep/prep-ru.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RAW = path.join(REPO_ROOT, "scripts", "raw");

function readBadestrandSet(filePath) {
  const out = new Set();
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, "utf-8");
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) { // skip header
    const line = lines[i];
    if (!line) continue;
    const cols = line.split("\t");
    const bare = cols[0];
    if (!bare) continue;
    out.add(bare.toLowerCase());
  }
  return out;
}

const nouns = readBadestrandSet(path.join(RAW, "ru-nouns.csv"));
const adjs = readBadestrandSet(path.join(RAW, "ru-adjectives.csv"));
const verbs = readBadestrandSet(path.join(RAW, "ru-verbs.csv"));
console.error(`Badestrand: ${nouns.size} nouns, ${adjs.size} adj, ${verbs.size} verbs`);

const freqPath = path.join(RAW, "ru-freq.txt");
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
  if (nouns.has(w)) pos = "существительное";
  else if (verbs.has(w)) pos = "глагол";
  else if (adjs.has(w)) pos = "прилагательное";
  if (!pos) { skipped++; continue; }
  rank++;
  seen.add(w);
  out.push([w, pos, rank]);
}

fs.writeFileSync(path.join(RAW, "ru.json"), JSON.stringify(out));
console.error(`Wrote ${out.length} tuples to scripts/raw/ru.json (skipped ${skipped} words without Badestrand POS)`);
