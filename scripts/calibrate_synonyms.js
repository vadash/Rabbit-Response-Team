// Calibrate Top N + minOccurrences defaults for the synonym scanner redesign.
// Scans a real SillyTavern chat export and reports, across sliding windows of
// the last N assistant messages, how many words cross various frequency
// thresholds — so we can pick defaults that surface a useful number of words.
//
// Usage: node scripts/calibrate_synonyms.js <path-to-jsonl>

import { readFileSync } from 'node:fs';
import { STOPWORDS_EN, STOPWORDS_RU } from '../src/data/language.js';

const STOP = new Set([...STOPWORDS_EN, ...STOPWORDS_RU]);

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/calibrate_synonyms.js <path-to-jsonl>');
  process.exit(1);
}

// Match the production tokenizer in src/engine/synonym-scanner.js:
// split on runs of non-letter characters, Latin or Cyrillic.
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

function tokenize(text) {
  const out = [];
  for (const tok of (text ?? '').toLowerCase().match(TOKEN_RE) ?? []) {
    if (STOP.has(tok)) continue;
    if (tok.length < 3) continue;            // drop 1-2 char noise
    out.push(tok);
  }
  return out;
}

const raw = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);

const messages = [];
for (const line of raw) {
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  if (obj.is_user) continue;            // exclude user
  if (obj.is_system) continue;          // exclude greeting card / system notes
  if (!obj.mes) continue;
  messages.push(obj);
}

console.log(`Total non-user, non-system assistant messages: ${messages.length}`);

const WINDOW_SIZES = [5, 10, 15, 20];
const THRESHOLDS = [2, 3, 4, 5, 6];

function freqMapForWindow(window) {
  const counts = new Map();
  for (const msg of window) {
    for (const tok of tokenize(msg.mes)) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  return counts;
}

// Sample windows at every K-th assistant message to get a distribution,
// not just one snapshot.
const STEP = Math.max(1, Math.floor(messages.length / 50));

for (const W of WINDOW_SIZES) {
  console.log(`\n=== Window size: last ${W} assistant messages ===`);

  const samplesByThreshold = Object.fromEntries(
    THRESHOLDS.map((t) => [t, []]),
  );

  for (let i = W; i <= messages.length; i += STEP) {
    const window = messages.slice(i - W, i);
    const counts = freqMapForWindow(window);
    for (const t of THRESHOLDS) {
      let n = 0;
      for (const c of counts.values()) if (c >= t) n++;
      samplesByThreshold[t].push(n);
    }
  }

  for (const t of THRESHOLDS) {
    const arr = samplesByThreshold[t];
    if (arr.length === 0) continue;
    arr.sort((a, b) => a - b);
    const median = arr[Math.floor(arr.length / 2)];
    const mean = (arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(1);
    const p90 = arr[Math.floor(arr.length * 0.9)];
    const p10 = arr[Math.floor(arr.length * 0.1)];
    console.log(
      `  minOccurrences>=${t}: median=${median} mean=${mean} p10=${p10} p90=${p90} (n=${arr.length} windows sampled)`,
    );
  }
}

// Also: for the recommended window of 10, what's the typical top-N frequency?
// i.e., if we want "top 3 by frequency", what threshold does the 3rd-ranked
// word actually sit at?
console.log('\n=== Top-N word frequencies in window=10 (median across sampled windows) ===');
const Ns = [3, 5, 8];
const topNbyN = Object.fromEntries(Ns.map((n) => [n, []]));

for (let i = 10; i <= messages.length; i += STEP) {
  const window = messages.slice(i - 10, i);
  const counts = freqMapForWindow(window);
  const sorted = [...counts.values()].sort((a, b) => b - a);
  for (const n of Ns) {
    const v = sorted[n - 1]; // n-th highest count
    if (v !== undefined) topNbyN[n].push(v);
  }
}

for (const n of Ns) {
  const arr = topNbyN[n];
  if (arr.length === 0) continue;
  arr.sort((a, b) => a - b);
  const median = arr[Math.floor(arr.length / 2)];
  const mean = (arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(1);
  console.log(`  Top-${n}-th word frequency: median=${median} mean=${mean}`);
}

// Quick sanity dump: one example window at i=10 to eyeball
if (messages.length >= 10) {
  const w = messages.slice(0, 10);
  const counts = freqMapForWindow(w);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('\n=== Example: first 10 assistant messages, top 15 word counts ===');
  for (const [word, c] of sorted) console.log(`  ${c}\t${word}`);
}
