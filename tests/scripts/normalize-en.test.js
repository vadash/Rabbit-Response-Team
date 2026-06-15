import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeEn } from "../../scripts/lib/normalize-en.js";

// Penn Treebank-style tags the EN source emits.
const POS = {
  NOUN: "NN",
  VERB: "VB",
  ADJ: "JJ",
  ADV: "RB",
  PROPN: "NNP",
  UNKNOWN: "FW",
};

describe("normalizeEn — POS mapping", () => {
  test("maps known noun/verb/adj/adv tags", () => {
    const rows = [
      ["Apple", POS.NOUN, 100],
      ["Run", POS.VERB, 200],
      ["Quick", POS.ADJ, 300],
      ["Slowly", POS.ADV, 400],
    ];
    const result = normalizeEn(rows);
    const byWord = Object.fromEntries(result.map(t => [t[0], t[1]]));
    assert.equal(byWord.apple, "n");
    assert.equal(byWord.run, "v");
    assert.equal(byWord.quick, "a");
    assert.equal(byWord.slowly, "r");
  });

  test("maps plural/progressive/participle/comparative/superlative forms", () => {
    const rows = [
      ["Apples", "NNS", 100],
      ["Running", "VBG", 200],
      ["Quicker", "JJR", 300],
      ["Slowest", "RBS", 400],
    ];
    const result = normalizeEn(rows);
    const byWord = Object.fromEntries(result.map(t => [t[0], t[1]]));
    assert.equal(byWord.apples, "n");
    assert.equal(byWord.running, "v");
    assert.equal(byWord.quicker, "a");
    assert.equal(byWord.slowest, "r");
  });

  test("maps proper nouns (NNP / NNPS)", () => {
    const rows = [
      ["London", "NNP", 500],
      ["Smiths", "NNPS", 600],
    ];
    const result = normalizeEn(rows);
    const byWord = Object.fromEntries(result.map(t => [t[0], t[1]]));
    assert.equal(byWord.london, "n");
    assert.equal(byWord.smiths, "n");
  });

  test("drops unknown POS without throwing", () => {
    const rows = [
      ["Apple", POS.NOUN, 100],
      ["Café", POS.UNKNOWN, 200],
    ];
    const result = normalizeEn(rows);
    const words = result.map(t => t[0]);
    assert.ok(words.includes("apple"));
    assert.ok(!words.includes("café"));
  });
});

describe("normalizeEn — filtering", () => {
  test("lowercases words", () => {
    const rows = [["APPLE", "NN", 100]];
    const result = normalizeEn(rows);
    assert.equal(result[0][0], "apple");
  });

  test("rejects words with digits", () => {
    const rows = [
      ["abc123", "NN", 100],
      ["apple", "NN", 200],
    ];
    const result = normalizeEn(rows);
    const words = result.map(t => t[0]);
    assert.ok(!words.includes("abc123"));
    assert.ok(words.includes("apple"));
  });

  test("rejects words with mixed Latin + Cyrillic", () => {
    const rows = [
      ["appleяблоко", "NN", 100],
      ["яблоко", "NN", 200],
    ];
    const result = normalizeEn(rows);
    const words = result.map(t => t[0]);
    assert.ok(!words.includes("appleяблоко"));
    assert.ok(words.includes("яблоко"));
  });

  test("rejects words shorter than 2 chars", () => {
    const rows = [
      ["a", "NN", 100],
      ["ab", "NN", 200],
    ];
    const result = normalizeEn(rows);
    const words = result.map(t => t[0]);
    assert.ok(!words.includes("a"));
    assert.ok(words.includes("ab"));
  });

  test("rejects words longer than 20 chars", () => {
    const rows = [
      ["a".repeat(20), "NN", 100],
      ["a".repeat(21), "NN", 200],
    ];
    const result = normalizeEn(rows);
    const words = result.map(t => t[0]);
    assert.ok(words.includes("a".repeat(20)));
    assert.ok(!words.includes("a".repeat(21)));
  });
});

describe("normalizeEn — dedup and output shape", () => {
  test("dedupes by word keeping lowest rank", () => {
    const rows = [
      ["Apple", "NN", 500],
      ["Apple", "NN", 100],
      ["Banana", "NN", 200],
    ];
    const result = normalizeEn(rows);
    const apples = result.filter(t => t[0] === "apple");
    assert.equal(apples.length, 1);
    assert.equal(apples[0][2], 100);
  });

  test("output is array of [word, pos, rank] tuples", () => {
    const rows = [["Apple", "NN", 100]];
    const result = normalizeEn(rows);
    assert.equal(result.length, 1);
    const entry = result[0];
    assert.ok(Array.isArray(entry));
    assert.equal(entry.length, 3);
    assert.equal(typeof entry[0], "string");
    assert.equal(typeof entry[1], "string");
    assert.equal(typeof entry[2], "number");
  });

  test("returns empty for empty input", () => {
    assert.deepEqual(normalizeEn([]), []);
  });

  test("does not mutate input", () => {
    const rows = [["Apple", "NN", 100]];
    const snapshot = rows.map(r => r.slice());
    normalizeEn(rows);
    assert.deepEqual(rows, snapshot);
  });
});
