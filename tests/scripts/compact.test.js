import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  lowercaseWord,
  rejectNonScript,
  rejectByLength,
  dedupeKeepLowestRank,
  capList,
} from "../../scripts/lib/compact.js";

describe("compact — lowercaseWord", () => {
  test("lowercases ASCII", () => {
    assert.equal(lowercaseWord("APPLE"), "apple");
  });

  test("lowercases Cyrillic", () => {
    assert.equal(lowercaseWord("ЯБЛОКО"), "яблоко");
  });

  test("preserves already-lowercase input", () => {
    assert.equal(lowercaseWord("apple"), "apple");
  });

  test("handles empty string", () => {
    assert.equal(lowercaseWord(""), "");
  });
});

describe("compact — rejectNonScript", () => {
  test("accepts pure Latin", () => {
    assert.equal(rejectNonScript("apple"), false);
  });

  test("accepts pure Cyrillic", () => {
    assert.equal(rejectNonScript("яблоко"), false);
  });

  test("rejects digits", () => {
    assert.equal(rejectNonScript("abc123"), true);
  });

  test("rejects punctuation / symbols", () => {
    assert.equal(rejectNonScript("hello!"), true);
    assert.equal(rejectNonScript("foo-bar"), true);
    assert.equal(rejectNonScript("über"), true); // Latin Extended — outside allowed range
  });

  test("rejects mixed Latin + Cyrillic", () => {
    assert.equal(rejectNonScript("appleяблоко"), true);
  });

  test("rejects whitespace", () => {
    assert.equal(rejectNonScript("hello world"), true);
  });

  test("rejects empty string", () => {
    assert.equal(rejectNonScript(""), true);
  });
});

describe("compact — rejectByLength", () => {
  test("rejects words shorter than min (default 2)", () => {
    assert.equal(rejectByLength("a"), true);
  });

  test("accepts words at min boundary", () => {
    assert.equal(rejectByLength("ab"), false);
  });

  test("accepts words at max boundary (default 20)", () => {
    assert.equal(rejectByLength("a".repeat(20)), false);
  });

  test("rejects words longer than max", () => {
    assert.equal(rejectByLength("a".repeat(21)), true);
  });

  test("respects custom min/max", () => {
    assert.equal(rejectByLength("abc", 4, 10), true);
    assert.equal(rejectByLength("abcdef", 4, 10), false);
    assert.equal(rejectByLength("abcdefghijk", 4, 10), true);
  });
});

describe("compact — dedupeKeepLowestRank", () => {
  test("keeps lowest rank when duplicate word appears", () => {
    const input = [
      ["apple", "n", 500],
      ["apple", "n", 100],
      ["banana", "n", 200],
    ];
    const result = dedupeKeepLowestRank(input);
    const apples = result.filter(t => t[0] === "apple");
    assert.equal(apples.length, 1);
    assert.equal(apples[0][2], 100);
  });

  test("does not mutate input", () => {
    const input = [
      ["apple", "n", 500],
      ["apple", "n", 100],
    ];
    const snapshot = input.map(t => t.slice());
    dedupeKeepLowestRank(input);
    assert.deepEqual(input, snapshot);
  });

  test("returns new array", () => {
    const input = [["apple", "n", 1]];
    const result = dedupeKeepLowestRank(input);
    assert.notEqual(result, input);
  });

  test("handles empty input", () => {
    assert.deepEqual(dedupeKeepLowestRank([]), []);
  });

  test("preserves order of first-seen unique words", () => {
    const input = [
      ["cherry", "n", 300],
      ["apple", "n", 200],
      ["banana", "n", 100],
    ];
    const result = dedupeKeepLowestRank(input);
    assert.deepEqual(
      result.map(t => t[0]),
      ["cherry", "apple", "banana"]
    );
  });
});

describe("compact — capList", () => {
  test("truncates to N when list is longer", () => {
    assert.deepEqual(capList([1, 2, 3, 4, 5], 3), [1, 2, 3]);
  });

  test("returns full list when shorter than N", () => {
    assert.deepEqual(capList([1, 2], 5), [1, 2]);
  });

  test("returns empty when input is empty", () => {
    assert.deepEqual(capList([], 5), []);
  });

  test("returns empty when N is zero", () => {
    assert.deepEqual(capList([1, 2, 3], 0), []);
  });

  test("does not mutate input", () => {
    const input = [1, 2, 3];
    capList(input, 2);
    assert.deepEqual(input, [1, 2, 3]);
  });
});
