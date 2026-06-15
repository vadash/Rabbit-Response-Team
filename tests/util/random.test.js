// TDD tests for src/util/random.js
// Covers: shuffleInPlace, sampleWithoutReplacement, pushUniqueHistory.
// Per design §8 — pure functions, no I/O.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  shuffleInPlace,
  sampleWithoutReplacement,
  pushUniqueHistory,
} from "../../src/util/random.js";

describe("shuffleInPlace", () => {
  test("returns the same array reference", () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffleInPlace(arr);
    assert.strictEqual(result, arr);
  });

  test("preserves the same elements (no loss, no duplication)", () => {
    const arr = ["apple", "banana", "cherry", "date"];
    shuffleInPlace(arr);
    assert.deepStrictEqual(arr.slice().sort(), ["apple", "banana", "cherry", "date"].slice().sort());
  });

  test("with a stubbed Math.random, returns a deterministic order", () => {
    // Fisher-Yates: for array of length N, the algorithm iterates i from N-1
    // down to 1, picking j in [0, i] and swapping arr[i] with arr[j].
    // Stub Math.random to return predictable values:
    //   call 1 (i=3): j = Math.floor(0.1 * 4) = 0  → swap arr[3] and arr[0]
    //   call 2 (i=2): j = Math.floor(0.5 * 3) = 1  → swap arr[2] and arr[1]
    //   call 3 (i=1): j = Math.floor(0.9 * 2) = 1  → swap arr[1] with itself
    // Starting arr: [1, 2, 3, 4]
    //   after i=3 swap(3,0): [4, 2, 3, 1]
    //   after i=2 swap(2,1): [4, 3, 2, 1]
    //   after i=1 swap(1,1): [4, 3, 2, 1]
    const arr = [1, 2, 3, 4];
    const returns = [0.1, 0.5, 0.9];
    let callIndex = 0;
    const original = Math.random;
    Math.random = () => {
      const v = returns[callIndex];
      callIndex += 1;
      return v;
    };
    try {
      shuffleInPlace(arr);
      assert.deepStrictEqual(arr, [4, 3, 2, 1]);
    } finally {
      Math.random = original;
    }
  });

  test("handles a single-element array", () => {
    const arr = [42];
    shuffleInPlace(arr);
    assert.deepStrictEqual(arr, [42]);
  });

  test("handles an empty array", () => {
    const arr = [];
    shuffleInPlace(arr);
    assert.deepStrictEqual(arr, []);
  });
});

describe("sampleWithoutReplacement", () => {
  test("returns n unique elements when pool is large enough", () => {
    const pool = ["a", "b", "c", "d", "e", "f", "g"];
    const result = sampleWithoutReplacement(pool, 3, new Set());
    assert.strictEqual(result.length, 3);
    const unique = new Set(result);
    assert.strictEqual(unique.size, 3);
    // Every result element comes from the pool.
    for (const w of result) assert.ok(pool.includes(w));
  });

  test("returns fewer than n when pool is smaller than n", () => {
    const pool = ["a", "b"];
    const result = sampleWithoutReplacement(pool, 5, new Set());
    // Can't return more than the pool holds.
    assert.ok(result.length <= 2);
    const unique = new Set(result);
    assert.strictEqual(unique.size, result.length);
  });

  test("returns empty when pool is empty", () => {
    const result = sampleWithoutReplacement([], 3, new Set());
    assert.deepStrictEqual(result, []);
  });

  test("returns empty when n is zero", () => {
    const result = sampleWithoutReplacement(["a", "b"], 0, new Set());
    assert.deepStrictEqual(result, []);
  });

  test("excludes items in the exclude set", () => {
    const pool = ["a", "b", "c", "d", "e"];
    const exclude = new Set(["a", "c", "e"]);
    const result = sampleWithoutReplacement(pool, 3, exclude);
    // Only "b" and "d" are eligible — can return at most 2.
    assert.ok(result.length <= 2);
    for (const w of result) assert.ok(!exclude.has(w));
  });

  test("never returns duplicates", () => {
    const pool = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const result = sampleWithoutReplacement(pool, 7, new Set());
    const unique = new Set(result);
    assert.strictEqual(unique.size, result.length);
  });

  test("excludes all pool items → returns empty", () => {
    const pool = ["a", "b", "c"];
    const exclude = new Set(["a", "b", "c"]);
    const result = sampleWithoutReplacement(pool, 2, exclude);
    assert.deepStrictEqual(result, []);
  });
});

describe("pushUniqueHistory", () => {
  test("adds a new word to the front", () => {
    const history = ["b", "c"];
    const result = pushUniqueHistory(history, "a", 10);
    assert.deepStrictEqual(result, ["a", "b", "c"]);
  });

  test("caps at maxSize by dropping the oldest entry", () => {
    const history = ["b", "c", "d"];
    const result = pushUniqueHistory(history, "a", 3);
    // Adding "a" makes 4 items → drop oldest ("d").
    assert.deepStrictEqual(result, ["a", "b", "c"]);
    assert.strictEqual(result.length, 3);
  });

  test("drops multiple oldest entries when over cap", () => {
    const history = ["c", "d", "e"];
    const result = pushUniqueHistory(history, "a", 2);
    // After push: ["a", "c", "d", "e"] → cap to 2 → ["a", "c"].
    assert.deepStrictEqual(result, ["a", "c"]);
    assert.strictEqual(result.length, 2);
  });

  test("is a no-op when the word already exists in history", () => {
    const history = ["a", "b", "c"];
    const result = pushUniqueHistory(history, "b", 10);
    assert.deepStrictEqual(result, ["a", "b", "c"]);
  });

  test("handles empty history", () => {
    const result = pushUniqueHistory([], "a", 5);
    assert.deepStrictEqual(result, ["a"]);
  });

  test("maxSize of 1 keeps only the newest word", () => {
    const result = pushUniqueHistory(["old"], "new", 1);
    assert.deepStrictEqual(result, ["new"]);
  });
});
