import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeRu } from "../../scripts/lib/normalize-ru.js";

// Badestrand dictionary POS strings (Russian full names).
const POS = {
  NOUN: "существительное",
  VERB: "глагол",
  ADJ: "прилагательное",
  ADV: "наречие",
  UNKNOWN: "междометие",
};

describe("normalizeRu — POS mapping", () => {
  test("maps known noun/verb/adj/adv tags", () => {
    const rows = [
      ["Яблоко", POS.NOUN, 100],
      ["Бежать", POS.VERB, 200],
      ["Быстрый", POS.ADJ, 300],
      ["Медленно", POS.ADV, 400],
    ];
    const result = normalizeRu(rows);
    const byWord = Object.fromEntries(result.map(t => [t[0], t[1]]));
    assert.equal(byWord.яблоко, "n");
    assert.equal(byWord.бежать, "v");
    assert.equal(byWord.быстрый, "a");
    assert.equal(byWord.медленно, "r");
  });

  test("drops unknown POS without throwing", () => {
    const rows = [
      ["Яблоко", POS.NOUN, 100],
      ["Ой", POS.UNKNOWN, 200],
    ];
    const result = normalizeRu(rows);
    const words = result.map(t => t[0]);
    assert.ok(words.includes("яблоко"));
    assert.ok(!words.includes("ой"));
  });
});

describe("normalizeRu — filtering", () => {
  test("lowercases words", () => {
    const rows = [["ЯБЛОКО", POS.NOUN, 100]];
    const result = normalizeRu(rows);
    assert.equal(result[0][0], "яблоко");
  });

  test("rejects words with digits", () => {
    const rows = [
      ["яблоко123", POS.NOUN, 100],
      ["яблоко", POS.NOUN, 200],
    ];
    const result = normalizeRu(rows);
    const words = result.map(t => t[0]);
    assert.ok(!words.includes("яблоко123"));
    assert.ok(words.includes("яблоко"));
  });

  test("rejects words with mixed script", () => {
    const rows = [
      ["яблокоapple", POS.NOUN, 100],
      ["яблоко", POS.NOUN, 200],
    ];
    const result = normalizeRu(rows);
    const words = result.map(t => t[0]);
    assert.ok(!words.includes("яблокоapple"));
    assert.ok(words.includes("яблоко"));
  });

  test("rejects words shorter than 2 chars", () => {
    const rows = [
      ["я", POS.NOUN, 100],
      ["яб", POS.NOUN, 200],
    ];
    const result = normalizeRu(rows);
    const words = result.map(t => t[0]);
    assert.ok(!words.includes("я"));
    assert.ok(words.includes("яб"));
  });

  test("rejects words longer than 20 chars", () => {
    const rows = [
      ["а".repeat(20), POS.NOUN, 100],
      ["а".repeat(21), POS.NOUN, 200],
    ];
    const result = normalizeRu(rows);
    const words = result.map(t => t[0]);
    assert.ok(words.includes("а".repeat(20)));
    assert.ok(!words.includes("а".repeat(21)));
  });
});

describe("normalizeRu — dedup and output shape", () => {
  test("dedupes by word keeping lowest rank", () => {
    const rows = [
      ["Яблоко", POS.NOUN, 500],
      ["Яблоко", POS.NOUN, 100],
      ["Банан", POS.NOUN, 200],
    ];
    const result = normalizeRu(rows);
    const apples = result.filter(t => t[0] === "яблоко");
    assert.equal(apples.length, 1);
    assert.equal(apples[0][2], 100);
  });

  test("output is array of [word, pos, rank] tuples", () => {
    const rows = [["Яблоко", POS.NOUN, 100]];
    const result = normalizeRu(rows);
    assert.equal(result.length, 1);
    const entry = result[0];
    assert.ok(Array.isArray(entry));
    assert.equal(entry.length, 3);
    assert.equal(typeof entry[0], "string");
    assert.equal(typeof entry[1], "string");
    assert.equal(typeof entry[2], "number");
  });

  test("returns empty for empty input", () => {
    assert.deepEqual(normalizeRu([]), []);
  });

  test("does not mutate input", () => {
    const rows = [["Яблоко", POS.NOUN, 100]];
    const snapshot = rows.map(r => r.slice());
    normalizeRu(rows);
    assert.deepEqual(rows, snapshot);
  });
});
