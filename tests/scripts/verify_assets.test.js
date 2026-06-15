import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { verify } from "../../scripts/verify_assets.js";

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

  // (h) clean synthetic assets under tests/fixtures/ → passes
  test("clean synthetic assets under tests/fixtures pass", () => {
    const fixturesDir = path.join(import.meta.dirname, "..", "..", "fixtures");
    if (!fs.existsSync(fixturesDir)) {
      // Fixtures not yet created — skip
      return;
    }
    const result = verify(fixturesDir);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });
});
