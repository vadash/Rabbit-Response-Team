// Build orchestrator — design §10.2
// Wires the normalize / extract helpers from Tasks 2–3 into a single pipeline
// that reads raw sources, produces words.json and synonyms.json, and leaves
// them in assets/{en,ru}/.
//
// Usage:
//   node scripts/build_assets.js                  # build from default raw sources
//   node scripts/build_assets.js ./my-raw-dir    # build from a custom dir
//
// Raw sources must be placed in scripts/raw/ (see scripts/raw/README.md).
// Without them the pipeline fails fast with a clear exit code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD } from "./constants.js";
import { writeJsonAtomic } from "./lib/write-json.js";
import { normalizeEn } from "./lib/normalize-en.js";
import { normalizeRu } from "./lib/normalize-ru.js";
import { extractEnSynonyms } from "./lib/wordnet-extract.js";
import { extractRuSynonyms } from "./lib/yarn-extract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Assertion: SYNONYMS_TOP_N ≤ WORDS_TOP_N
// ---------------------------------------------------------------------------
if (BUILD.SYNONYMS_TOP_N > BUILD.WORDS_TOP_N) {
  console.error(
    `FATAL: SYNONYMS_TOP_N (${BUILD.SYNONYMS_TOP_N}) must be ≤ WORDS_TOP_N (${BUILD.WORDS_TOP_N})`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Locate a raw source file. Checks (in order):
 *   rawDir/<lang>.*
 * Falls back to a well-known filename if the caller passed a directory.
 * Returns the resolved path or null.
 */
function findRawFile(rawDir, lang) {
  const candidates = {
    en: ["en.json", "en-wordfreq.json", "en-frequency.json", "en.txt"],
    ru: ["ru.json", "ru-dictionary.json", "ru-freq.json", "ru.txt"],
  };
  for (const name of candidates[lang]) {
    const p = path.join(rawDir, name);
    if (fs.existsSync(p)) return p;
  }
  // Fallback: any json/txt file prefixed with the lang code
  for (const entry of fs.readdirSync(rawDir)) {
    if (entry.startsWith(lang) && (entry.endsWith(".json") || entry.endsWith(".txt"))) {
      return path.join(rawDir, entry);
    }
  }
  return null;
}

/**
 * Load a raw source file. Supports:
 *   - JSON array of [word, pos, rank] tuples
 *   - JSON array of { word, pos, rank } objects
 *   - Plain text, one word per line (no POS — skipped by normalizer)
 * Returns Array<[word, pos, rank]> in the tuple form the normalizers expect.
 */
function loadRawTuples(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(data)) {
      throw new Error(`${filePath}: expected a JSON array`);
    }
    const out = [];
    for (const item of data) {
      if (Array.isArray(item) && item.length >= 3) {
        out.push([String(item[0]), String(item[1]), Number(item[2])]);
      } else if (item && typeof item === "object" && "word" in item) {
        out.push([String(item.word), String(item.pos ?? item.tag ?? item.upos), Number(item.rank ?? item.frequency ?? 0)]);
      }
    }
    return out;
  }
  if (ext === ".txt" || ext === ".csv") {
    const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
    const out = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split(/[,\t]/);
      if (parts.length >= 3) {
        out.push([String(parts[0]), String(parts[1]), Number(parts[2])]);
      }
    }
    return out;
  }
  throw new Error(`${filePath}: unsupported extension ${ext}`);
}

/**
 * Locate the YARN JSON file for Russian synonyms.
 * YARN is distributed as a single JSON file with { synsets, relations }.
 */
function findYarnFile(rawDir) {
  for (const name of ["yarn.json", "yarn-ru.json", "ru-yarn.json", "YARN.json"]) {
    const p = path.join(rawDir, name);
    if (fs.existsSync(p)) return p;
  }
  for (const entry of fs.readdirSync(rawDir)) {
    if (entry.toLowerCase().includes("yarn") && entry.endsWith(".json")) {
      return path.join(rawDir, entry);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-language pipeline
// ---------------------------------------------------------------------------

function buildLanguage(lang, rawPath, normalize, extractSynonyms, yarnPath) {
  console.log(`[${lang}] Loading raw source: ${path.relative(REPO_ROOT, rawPath)}`);
  const rawRows = loadRawTuples(rawPath);
  console.log(`[${lang}] Raw rows: ${rawRows.length}`);

  console.log(`[${lang}] Normalizing...`);
  const normalized = normalize(rawRows);
  console.log(`[${lang}] After normalize: ${normalized.length}`);

  // Sort by rank ascending (most common first), take WORDS_TOP_N
  normalized.sort((a, b) => a[2] - b[2]);
  const words = normalized.slice(0, BUILD.WORDS_TOP_N);
  console.log(`[${lang}] After top-${BUILD.WORDS_TOP_N} slice: ${words.length}`);

  const wordsPath = path.join(REPO_ROOT, "assets", lang, "words.json");
  writeJsonAtomic(wordsPath, words);
  console.log(`[${lang}] Wrote ${path.relative(REPO_ROOT, wordsPath)}`);

  // Synonyms: walk the top SYNONYMS_TOP_N words in the trimmed bank.
  // For RU, yarn-extract.js reloads+parses yarn.json on every call. With a
  // ~15MB source and 20k lookups, that's 300GB of JSON parsing. Pre-trim
  // yarn.json to only word-bank keys once, write a temp file, and point the
  // extractor at it so each per-call load is cheap.
  console.log(`[${lang}] Extracting synonyms (top ${BUILD.SYNONYMS_TOP_N})...`);
  let effectiveYarnPath = yarnPath;
  if (yarnPath) {
    const yarnRaw = JSON.parse(fs.readFileSync(yarnPath, "utf-8"));
    const bankSet = new Set(words.map(w => w[0]));
    const trimmed = { synsets: {}, relations: {} };
    if (yarnRaw.synsets) {
      for (const k of Object.keys(yarnRaw.synsets)) {
        if (bankSet.has(k)) trimmed.synsets[k] = yarnRaw.synsets[k];
      }
    }
    if (yarnRaw.relations) {
      for (const k of Object.keys(yarnRaw.relations)) {
        if (bankSet.has(k)) trimmed.relations[k] = yarnRaw.relations[k];
      }
    }
    const tmpDir = path.join(REPO_ROOT, "scripts", "raw", ".tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    effectiveYarnPath = path.join(tmpDir, `yarn-trimmed-${process.pid}.json`);
    fs.writeFileSync(effectiveYarnPath, JSON.stringify(trimmed));
    console.log(`[${lang}] Trimmed yarn: ${Object.keys(trimmed.synsets).length} syn / ${Object.keys(trimmed.relations).length} rel keys`);
  }

  const synonyms = {};
  const limit = Math.min(BUILD.SYNONYMS_TOP_N, words.length);
  for (let i = 0; i < limit; i++) {
    const word = words[i][0];
    const { s, a } = extractSynonyms(word, effectiveYarnPath);
    if (s.length === 0 && a.length === 0) continue;
    synonyms[word] = { s, a };
  }
  if (effectiveYarnPath !== yarnPath) {
    try { fs.unlinkSync(effectiveYarnPath); } catch { /* best-effort */ }
  }
  console.log(`[${lang}] Words with synonym entries: ${Object.keys(synonyms).length}`);

  const synonymsPath = path.join(REPO_ROOT, "assets", lang, "synonyms.json");
  writeJsonAtomic(synonymsPath, synonyms);
  console.log(`[${lang}] Wrote ${path.relative(REPO_ROOT, synonymsPath)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const rawDir = process.argv[2] || path.join(REPO_ROOT, "scripts", "raw");
  if (!fs.existsSync(rawDir)) {
    console.error(`Raw source directory not found: ${rawDir}`);
    console.error("See scripts/raw/README.md for download instructions.");
    process.exit(1);
  }

  const enRaw = findRawFile(rawDir, "en");
  const ruRaw = findRawFile(rawDir, "ru");
  if (!enRaw) {
    console.error("No English raw source found in " + rawDir);
    console.error("See scripts/raw/README.md for download instructions.");
    process.exit(1);
  }
  if (!ruRaw) {
    console.error("No Russian raw source found in " + rawDir);
    console.error("See scripts/raw/README.md for download instructions.");
    process.exit(1);
  }

  const yarnPath = findYarnFile(rawDir);
  if (!yarnPath) {
    console.error("No YARN file found in " + rawDir);
    console.error("See scripts/raw/README.md for download instructions.");
    process.exit(1);
  }

  console.log(`Building assets from ${path.relative(REPO_ROOT, rawDir)}`);
  console.log("---");
  buildLanguage("en", enRaw, normalizeEn, extractEnSynonyms, null);
  console.log("---");
  buildLanguage("ru", ruRaw, normalizeRu, extractRuSynonyms, yarnPath);
  console.log("---");
  console.log("Done. Run `node scripts/verify_assets.js` to validate.");
}

main();
