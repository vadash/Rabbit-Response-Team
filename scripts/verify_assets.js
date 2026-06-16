// Postbuild asset verifier — design §10.3
// Validates that generated assets meet all pipeline rules.
// Exits nonzero on any failure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD } from "./constants.js";
import { normalize } from "./lib/stemmer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Verify all assets under assetsDir.
 *
 * @param {string} assetsDir — absolute path to assets/ directory
 * @param {{ verbose?: boolean }} [opts] — verbose=true enables per-step stderr
 *   progress and per-offender diagnostics. CLI sets this from DEBUG_VERIFY.
 * @returns {{
 *   ok: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   totalBytes: number,
 *   stemOffenders: { en: Array<{key:string, stem:string}>, ru: Array<{key:string, stem:string}> }
 * }}
 */
export function verify(assetsDir, opts = {}) {
  const verbose = !!opts.verbose;
  /** @param {...unknown} a */
  const vlog = (...a) => {
    if (verbose) process.stderr.write(a.join(" ") + "\n");
  };

  const errors = [];
  const warnings = [];
  let totalBytes = 0;
  /** @type {{ en: any[], ru: any[] }} */
  const stemOffenders = { en: [], ru: [] };

  vlog(`[verify] start; verbose=${verbose}; assetsDir=${assetsDir}`);


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

    // (d) Synonym key must correspond to a word in the bank.
    // Synonym keys are stems (Task 5); words.json holds headwords. Compare via
    // normalize() so a stemmed synonym key matches the headword it derived from.
    const wordStems = new Set();
    for (const w of wordSet) {
      const s = normalize(w, lang);
      if (s) wordStems.add(s);
    }
    vlog(`[verify][${lang}] words.json produced ${wordStems.size} unique stem(s)`);
    for (const word of Object.keys(synonyms)) {
      if (!wordStems.has(word)) {
        errors.push(
          `${lang}/synonyms.json: key "${word}" not found in words.json (nor its stem)`
        );
      }
    }

    // (h) Stem-key invariant — every synonyms key must equal normalize(key, lang).
    // Build pipeline (Task 5) writes stemmed keys; this catches hand-edits that
    // re-introduce headword-form keys and break runtime lookup parity.
    {
      const keys = Object.keys(synonyms);
      vlog(`[verify][${lang}] stem-invariant check on ${keys.length} synonym key(s)`);
      const offenders = [];
      let scanned = 0;
      const progressInterval = Math.max(1000, Math.floor(keys.length / 10));
      for (const key of keys) {
        scanned++;
        const stem = normalize(key, lang);
        if (key !== stem) {
          offenders.push({ key, stem });
        }
        if (verbose && scanned % progressInterval === 0) {
          vlog(`[verify][${lang}]   scanned ${scanned}/${keys.length}, ${offenders.length} offender(s) so far`);
        }
      }
      stemOffenders[lang] = offenders;
      vlog(`[verify][${lang}] stem-invariant: ${offenders.length} offender(s) of ${scanned}`);
      if (offenders.length > 0) {
        const preview = offenders.slice(0, 5).map(o => `"${o.key}"→"${o.stem}"`).join(", ");
        errors.push(
          `${lang}/synonyms.json: ${offenders.length} key(s) not stemmed (key !== normalize(key, lang)). First: ${preview}`
        );
        if (verbose) {
          const show = offenders.slice(0, 50);
          for (const o of show) {
            vlog(`[verify][${lang}]   ✗ "${o.key}" → stem "${o.stem}"`);
          }
          if (offenders.length > show.length) {
            vlog(`[verify][${lang}]   ...and ${offenders.length - show.length} more`);
          }
        }
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
  vlog(`[verify] done; ok=${ok}; errors=${errors.length}; warnings=${warnings.length}`);
  return { ok, errors, warnings, totalBytes, stemOffenders };
}

// CLI entry point — only runs when invoked directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("verify_assets.js") ||
   process.argv[1].endsWith("verify_assets"));

if (isDirectRun) {
  const assetsDir = process.argv[2] || path.join(process.cwd(), "assets");
  const verbose = ["1", "true", "yes"].includes((process.env.DEBUG_VERIFY || "").toLowerCase());
  const result = verify(assetsDir, { verbose });

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
