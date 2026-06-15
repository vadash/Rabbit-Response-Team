import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractRuSynonyms } from "../../scripts/lib/yarn-extract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "mini-yarn.json");

describe("extractRuSynonyms", () => {
  test("known word returns synonym and association arrays", () => {
    const result = extractRuSynonyms("яблоко", FIXTURE_PATH);
    assert.equal(typeof result, "object");
    assert.ok(Array.isArray(result.s), "s must be an array");
    assert.ok(Array.isArray(result.a), "a must be an array");
    // mini-yarn fixture has entries for яблоко
    assert.deepEqual(result.s.sort(), ["плод", "фрукт"].sort());
    assert.deepEqual(result.a.sort(), ["сад", "дерево", "урожай"].sort());
  });

  test("unknown word returns empty arrays", () => {
    const result = extractRuSynonyms("несуществующееслово", FIXTURE_PATH);
    assert.deepEqual(result, { s: [], a: [] });
  });

  test("caps synonyms to SYNONYMS_PER_WORD", () => {
    // Build a fixture with many synonyms
    const big = {
      synsets: { captest: Array.from({ length: 20 }, (_, i) => `s${i}`) },
      relations: { captest: Array.from({ length: 30 }, (_, i) => `a${i}`) },
    };
    const tmp = path.join(__dirname, "..", "fixtures", "tmp-cap.json");
    fs.writeFileSync(tmp, JSON.stringify(big));
    try {
      const result = extractRuSynonyms("captest", tmp);
      assert.ok(result.s.length <= 8, `expected <= 8 synonyms, got ${result.s.length}`);
      assert.ok(result.a.length <= 12, `expected <= 12 associations, got ${result.a.length}`);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test("does not include the query word itself in results", () => {
    const result = extractRuSynonyms("яблоко", FIXTURE_PATH);
    assert.ok(!result.s.includes("яблоко"));
    assert.ok(!result.a.includes("яблоко"));
  });

  test("returns empty for empty string", () => {
    const result = extractRuSynonyms("", FIXTURE_PATH);
    assert.deepEqual(result, { s: [], a: [] });
  });

  test("throws on missing file", () => {
    assert.throws(() => extractRuSynonyms("яблоко", "/nonexistent/path.json"), {
      code: "ENOENT",
    });
  });
});
