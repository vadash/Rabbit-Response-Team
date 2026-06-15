import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { extractEnSynonyms } from "../../scripts/lib/wordnet-extract.js";

describe("extractEnSynonyms", () => {
  test("known word returns synonym and association arrays", () => {
    const result = extractEnSynonyms("apple");
    assert.equal(typeof result, "object");
    assert.ok(Array.isArray(result.s), "s must be an array");
    assert.ok(Array.isArray(result.a), "a must be an array");
    // apple is in WordNet — should have at least one synonym or association
    assert.ok(result.s.length + result.a.length > 0, "expected non-empty result for 'apple'");
    // all entries must be lowercase strings
    for (const w of result.s) {
      assert.equal(typeof w, "string");
      assert.equal(w, w.toLowerCase());
    }
    for (const w of result.a) {
      assert.equal(typeof w, "string");
      assert.equal(w, w.toLowerCase());
    }
  });

  test("unknown word returns empty arrays", () => {
    const result = extractEnSynonyms("xyzzyplugh-nonexistent");
    assert.deepEqual(result, { s: [], a: [] });
  });

  test("caps synonyms to SYNONYMS_PER_WORD", () => {
    // Find a word with many synonyms by probing a common one
    const result = extractEnSynonyms("person");
    assert.ok(result.s.length <= 8, `expected <= 8 synonyms, got ${result.s.length}`);
    assert.ok(result.a.length <= 12, `expected <= 12 associations, got ${result.a.length}`);
  });

  test("does not include the query word itself in results", () => {
    const result = extractEnSynonyms("apple");
    assert.ok(!result.s.includes("apple"), "synonyms should not include query word");
    assert.ok(!result.a.includes("apple"), "associations should not include query word");
  });

  test("returns empty for empty string", () => {
    const result = extractEnSynonyms("");
    assert.deepEqual(result, { s: [], a: [] });
  });

  test("does not mutate input", () => {
    const word = "apple";
    extractEnSynonyms(word);
    assert.equal(word, "apple");
  });
});
