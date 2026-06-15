// Postbuild asset verifier — design §10.3
// Validates that generated assets meet all pipeline rules.
// Exits nonzero on any failure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD } from "./constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Verify all assets under assetsDir.
 * @param {string} assetsDir — absolute path to assets/ directory
 * @returns {{ ok: boolean, errors: string[], warnings: string[], totalBytes: number }}
 */
export function verify(assetsDir) {
  const errors = [];
  const warnings = [];
  let totalBytes = 0;

  // (a) assets/ dir must exist
  if (!fs.existsSync(assetsDir)) {
    errors.push(`Assets directory missing: ${assetsDir}`);
    return { ok: false, errors, warnings, totalBytes: 0 };
  }

  // Per-language checks
  const langs = ["en", "ru"];
  const allWords = {}; // lang → Set<word>

  for (const lang of langs) {
    const langDir = path.join(assetsDir, lang);
    const wordsPath = path.join(langDir, "words.json");
    const synonymsPath = path.join(langDir, "synonyms.json");

    // words.json must exist
    if (!fs.existsSync(wordsPath)) {
      errors.push(`${lang}/words.json missing`);
      continue;
    }
    if (!fs.existsSync(synonymsPath)) {
      errors.push(`${lang}/synonyms.json missing`);
      continue;
    }

    // Parse words
    let words;
    try {
      words = JSON.parse(fs.readFileSync(wordsPath, "utf-8"));
    } catch (e) {
      errors.push(`${lang}/words.json: parse error — ${e.message}`);
      continue;
    }

    // Parse synonyms
    let synonyms;
    try {
      synonyms = JSON.parse(fs.readFileSync(synonymsPath, "utf-8"));
    } catch (e) {
      errors.push(`${lang}/synonyms.json: parse error — ${e.message}`);
      continue;
    }

    // (b) Empty word bank
    if (!Array.isArray(words) || words.length === 0) {
      errors.push(`${lang}/words.json: empty word bank (0 entries)`);
      continue;
    }

    // (c) Word count
    if (words.length < BUILD.WORDS_TOP_N) {
      // Warn if source was smaller than target; fail only if zero
      if (words.length === 0) {
        errors.push(`${lang}/words.json: zero entries`);
      } else {
        warnings.push(
          `${lang}/words.json: ${words.length} entries < WORDS_TOP_N ${BUILD.WORDS_TOP_N} (source smaller)`
        );
      }
    }

    // (e) Duplicate check
    const wordSet = new Set();
    for (const entry of words) {
      const w = entry[0];
      if (wordSet.has(w)) {
        errors.push(`${lang}/words.json: duplicate word "${w}"`);
      }
      wordSet.add(w);
    }
    allWords[lang] = wordSet;

    // Smoke check: 10 random words have expected tuple shape
    const sampleSize = Math.min(10, words.length);
    for (let i = 0; i < sampleSize; i++) {
      const entry = words[i];
      if (
        !Array.isArray(entry) ||
        entry.length < 3 ||
        typeof entry[0] !== "string" ||
        typeof entry[1] !== "string" ||
        typeof entry[2] !== "number"
      ) {
        errors.push(
          `${lang}/words.json: entry at index ${i} has invalid shape (expected [word, pos, rank])`
        );
      }
    }

    // (d) Synonym key must exist in words
    for (const word of Object.keys(synonyms)) {
      if (!wordSet.has(word)) {
        errors.push(
          `${lang}/synonyms.json: key "${word}" not found in words.json`
        );
      }
    }

    // Size accounting
    totalBytes += fs.statSync(wordsPath).size + fs.statSync(synonymsPath).size;
  }

  // (f)(g) Total size bounds
  if (totalBytes > 0) {
    if (totalBytes < BUILD.ASSETS_MIN_SIZE_BYTES) {
      errors.push(
        `Total assets size ${totalBytes} bytes (${(totalBytes / 1024 / 1024).toFixed(2)} MB) below minimum ${BUILD.ASSETS_MIN_SIZE_BYTES} bytes (${BUILD.ASSETS_MIN_SIZE_BYTES / 1024 / 1024} MB)`
      );
    }
    if (totalBytes > BUILD.ASSETS_MAX_SIZE_BYTES) {
      errors.push(
        `Total assets size ${totalBytes} bytes (${(totalBytes / 1024 / 1024).toFixed(2)} MB) above maximum ${BUILD.ASSETS_MAX_SIZE_BYTES} bytes (${BUILD.ASSETS_MAX_SIZE_BYTES / 1024 / 1024} MB)`
      );
    }
  }

  // Check no single file exceeds 100 MB
  const allFiles = [];
  try {
    for (const lang of langs) {
      const langDir = path.join(assetsDir, lang);
      if (fs.existsSync(langDir)) {
        for (const f of fs.readdirSync(langDir)) {
          const fp = path.join(langDir, f);
          if (fs.statSync(fp).isFile()) {
            allFiles.push(fp);
          }
        }
      }
    }
    // Also check top-level files in assets/
    for (const f of fs.readdirSync(assetsDir)) {
      const fp = path.join(assetsDir, f);
      if (fs.statSync(fp).isFile()) {
        allFiles.push(fp);
      }
    }
  } catch {
    // ignore
  }
  for (const fp of allFiles) {
    const size = fs.statSync(fp).size;
    if (size > 100 * 1024 * 1024) {
      errors.push(`${path.relative(assetsDir, fp)}: exceeds 100 MB single-file limit`);
    }
  }

  const ok = errors.length === 0;
  return { ok, errors, warnings, totalBytes };
}

// CLI entry point — only runs when invoked directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("verify_assets.js") ||
   process.argv[1].endsWith("verify_assets"));

if (isDirectRun) {
  const assetsDir = process.argv[2] || path.join(process.cwd(), "assets");
  const result = verify(assetsDir);

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      process.stderr.write(`⚠ ${w}\n`);
    }
  }

  if (!result.ok) {
    for (const e of result.errors) {
      process.stderr.write(`✖ ${e}\n`);
    }
    process.stderr.write(`\nVerification FAILED — ${result.errors.length} error(s)\n`);
    process.exit(1);
  }

  process.stdout.write(
    `✔ Verification passed — ${(result.totalBytes / 1024 / 1024).toFixed(2)} MB total\n`
  );
}
