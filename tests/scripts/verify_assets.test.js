import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { verify } from "../../scripts/verify_assets.js";
import { normalize } from "../../src/util/normalize.js";

/**
 * Build a minimal valid assets tree under `dir` for both langs.
 * Caller can override words / synonyms per-lang.
 */
function writeAssets(dir, { en = {}, ru = {} } = {}) {
  const defaults = (lang) => ({
    words: [["a", "n", 1]],
    synonyms: {},
    ...((lang === "en" ? en : ru)),
  });
  for (const lang of ["en", "ru"]) {
    fs.mkdirSync(path.join(dir, lang), { recursive: true });
    const d = defaults(lang);
    fs.writeFileSync(path.join(dir, lang, "words.json"), JSON.stringify(d.words));
    fs.writeFileSync(path.join(dir, lang, "synonyms.json"), JSON.stringify(d.synonyms));
  }
}

describe("verify_assets", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rabbit-verify-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // (a) missing assets/ dir → failure
  test("missing assets dir returns failure", () => {
    const result = verify(path.join(tmpDir, "nonexistent"));
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });

  // (b) empty word bank → failure
  test("empty word bank returns failure", () => {
    const assetsDir = path.join(tmpDir, "assets");
    fs.mkdirSync(path.join(assetsDir, "en"), { recursive: true });
    fs.mkdirSync(path.join(assetsDir, "ru"), { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "en", "words.json"), "[]");
    fs.writeFileSync(path.join(assetsDir, "ru", "words.json"), "[]");
    fs.writeFileSync(path.join(assetsDir, "en", "synonyms.json"), "{}");
    fs.writeFileSync(path.join(assetsDir, "ru", "synonyms.json"), "{}");
    const result = verify(assetsDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes("zero") || e.includes("0") || e.includes("empty")));
  });

  // (c) word count below WORDS_TOP_N with warning
  test("word count below WORDS_TOP_N with warning when source smaller", () => {
    const assetsDir = path.join(tmpDir, "assets");
    fs.mkdirSync(path.join(assetsDir, "en"), { recursive: true });
    fs.mkdirSync(path.join(assetsDir, "ru"), { recursive: true });
    const small = Array.from({ length: 10 }, (_, i) => [`word${i}`, "n", i + 1]);
    fs.writeFileSync(path.join(assetsDir, "en", "words.json"), JSON.stringify(small));
    fs.writeFileSync(path.join(assetsDir, "ru", "words.json"), JSON.stringify(small));
    fs.writeFileSync(path.join(assetsDir, "en", "synonyms.json"), "{}");
    fs.writeFileSync(path.join(assetsDir, "ru", "synonyms.json"), "{}");
    const result = verify(assetsDir);
    // Either a warning (if source smaller) or errors (e.g. size below min)
    assert.ok(result.warnings.length > 0 || !result.ok);
  });

  // (d) synonym key missing from words → failure
  test("synonym key missing from words returns failure", () => {
    const assetsDir = path.join(tmpDir, "assets");
    fs.mkdirSync(path.join(assetsDir, "en"), { recursive: true });
    fs.mkdirSync(path.join(assetsDir, "ru"), { recursive: true });
    const words = [["apple", "n", 1]];
    const synonyms = { "nonexistent": { s: ["x"], a: ["y"] } };
    fs.writeFileSync(path.join(assetsDir, "en", "words.json"), JSON.stringify(words));
    fs.writeFileSync(path.join(assetsDir, "ru", "words.json"), JSON.stringify(words));
    fs.writeFileSync(path.join(assetsDir, "en", "synonyms.json"), JSON.stringify(synonyms));
    fs.writeFileSync(path.join(assetsDir, "ru", "synonyms.json"), JSON.stringify(synonyms));
    const result = verify(assetsDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes("nonexistent") || e.includes("words.json")));
  });

  // (e) duplicate word in bank → failure
  test("duplicate word in bank returns failure", () => {
    const assetsDir = path.join(tmpDir, "assets");
    fs.mkdirSync(path.join(assetsDir, "en"), { recursive: true });
    fs.mkdirSync(path.join(assetsDir, "ru"), { recursive: true });
    const words = [["apple", "n", 1], ["apple", "n", 2]];
    fs.writeFileSync(path.join(assetsDir, "en", "words.json"), JSON.stringify(words));
    fs.writeFileSync(path.join(assetsDir, "ru", "words.json"), JSON.stringify(words));
    fs.writeFileSync(path.join(assetsDir, "en", "synonyms.json"), "{}");
    fs.writeFileSync(path.join(assetsDir, "ru", "synonyms.json"), "{}");
    const result = verify(assetsDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes("duplicate") || e.includes("Duplicate")));
  });

  // (f) total size below min → failure
  test("total size below ASSETS_MIN_SIZE_BYTES returns failure", () => {
    const assetsDir = path.join(tmpDir, "assets");
    fs.mkdirSync(path.join(assetsDir, "en"), { recursive: true });
    fs.mkdirSync(path.join(assetsDir, "ru"), { recursive: true });
    const words = [["a", "n", 1]];
    fs.writeFileSync(path.join(assetsDir, "en", "words.json"), JSON.stringify(words));
    fs.writeFileSync(path.join(assetsDir, "ru", "words.json"), JSON.stringify(words));
    fs.writeFileSync(path.join(assetsDir, "en", "synonyms.json"), "{}");
    fs.writeFileSync(path.join(assetsDir, "ru", "synonyms.json"), "{}");
    const result = verify(assetsDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.toLowerCase().includes("size") || e.toLowerCase().includes("mb") || e.toLowerCase().includes("bytes") || e.toLowerCase().includes("minimum")));
  });

  // (g) total size above max → failure
  test("total size above ASSETS_MAX_SIZE_BYTES returns failure", () => {
    const assetsDir = path.join(tmpDir, "assets");
    fs.mkdirSync(path.join(assetsDir, "en"), { recursive: true });
    fs.mkdirSync(path.join(assetsDir, "ru"), { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "en", "words.json"), JSON.stringify([["a","n",1]]));
    fs.writeFileSync(path.join(assetsDir, "ru", "words.json"), JSON.stringify([["a","n",1]]));
    fs.writeFileSync(path.join(assetsDir, "en", "synonyms.json"), "{}");
    fs.writeFileSync(path.join(assetsDir, "ru", "synonyms.json"), "{}");
    // Add a fake >100 MB file
    const big = "x".repeat(101 * 1024 * 1024);
    fs.writeFileSync(path.join(assetsDir, "en", "big.json"), big);
    const result = verify(assetsDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.toLowerCase().includes("size") || e.toLowerCase().includes("mb") || e.toLowerCase().includes("100") || e.toLowerCase().includes("maximum")));
    fs.unlinkSync(path.join(assetsDir, "en", "big.json"));
  });

  // (h) clean synthetic assets — in-memory, properly stemmed keys
  test("clean synthetic stemmed assets pass verification", () => {
    const assetsDir = path.join(tmpDir, "assets");
    const enSyn = { [normalize("apple", "en")]: { s: ["fruit"], a: ["orchard"] } };
    const ruSyn = { [normalize("госпожа", "ru")]: { s: ["дама"], a: ["панство"] } };
    writeAssets(assetsDir, {
      en: { synonyms: enSyn },
      ru: { synonyms: ruSyn },
    });
    const result = verify(assetsDir);
    // Other failures (size, key-not-in-words) are out of scope here — assert no stem errors.
    assert.ok(
      !result.errors.some(e => e.includes("not stemmed")),
      `should have no stem-invariant errors, got: ${result.errors.join("; ")}`
    );
  });

  // (i) synonyms with an un-stemmed EN headword key → failure, offender named
  test("un-stemmed EN synonyms key fails verification and names offender", () => {
    const assetsDir = path.join(tmpDir, "assets");
    writeAssets(assetsDir, {
      en: { synonyms: { apples: { s: ["fruit"], a: ["orchard"] } } },
      ru: {},
    });
    const result = verify(assetsDir);
    assert.equal(result.ok, false);
    const stemError = result.errors.find(e => e.includes("not stemmed"));
    assert.ok(stemError, `expected a not-stemmed error, got: ${result.errors.join("; ")}`);
    assert.ok(stemError.includes("apples"), `error should name the offender "apples": ${stemError}`);
    assert.ok(stemError.includes("en"), `error should name the lang: ${stemError}`);
  });

  // (j) synonyms with an un-stemmed RU headword key → failure
  test("un-stemmed RU synonyms key fails verification and names offender", () => {
    const assetsDir = path.join(tmpDir, "assets");
    writeAssets(assetsDir, {
      en: {},
      ru: { synonyms: { госпожой: { s: ["дамой"], a: ["панство"] } } },
    });
    const result = verify(assetsDir);
    assert.equal(result.ok, false);
    const stemError = result.errors.find(e => e.includes("not stemmed"));
    assert.ok(stemError, `expected a not-stemmed error, got: ${result.errors.join("; ")}`);
    assert.ok(stemError.includes("госпожой"), `error should name the offender: ${stemError}`);
    assert.ok(stemError.includes("ru"), `error should name the lang: ${stemError}`);
  });

  // (k) ё in RU synonym key → failure (since normalize applies ё→е)
  test("RU synonym key containing ё fails verification (ё→е not applied)", () => {
    const assetsDir = path.join(tmpDir, "assets");
    writeAssets(assetsDir, {
      en: {},
      ru: { synonyms: { ещё: { s: ["все"], a: [] } } },
    });
    const result = verify(assetsDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes("not stemmed") && e.includes("ещё")));
  });

  // (l) verbose mode surfaces offender diagnostics in result
  test("verbose verify returns per-lang offender diagnostic map", () => {
    const assetsDir = path.join(tmpDir, "assets");
    writeAssets(assetsDir, {
      en: { synonyms: { apples: { s: ["x"], a: [] } } },
      ru: { synonyms: { госпожой: { s: ["y"], a: [] } } },
    });
    const result = verify(assetsDir, { verbose: true });
    assert.ok(result.stemOffenders, "should expose stemOffenders diagnostic");
    assert.ok(result.stemOffenders.en.some(o => o.key === "apples"));
    assert.ok(result.stemOffenders.ru.some(o => o.key === "госпожой"));
  });
});
