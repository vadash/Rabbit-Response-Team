import { test } from "node:test";
import assert from "node:assert/strict";

import { extractTokens } from "../../src/util/tokenize.js";

test("extractTokens: basic EN splits into lowercase tokens", () => {
  assert.deepEqual(extractTokens("Hello world"), ["hello", "world"]);
});

test("extractTokens: basic RU splits into lowercase tokens", () => {
  assert.deepEqual(extractTokens("Привет мир"), ["привет", "мир"]);
});

test("extractTokens: apostrophe splits token (preserves current behavior)", () => {
  assert.deepEqual(extractTokens("don't"), ["don", "t"]);
});

test("extractTokens: hyphen splits token", () => {
  assert.deepEqual(extractTokens("well-known"), ["well", "known"]);
});

test("extractTokens: strips punctuation", () => {
  assert.deepEqual(extractTokens("Hello, world!"), ["hello", "world"]);
});

test("extractTokens: em-dash and quotes leave no empty fragments", () => {
  const tokens = extractTokens("she said — \"yes\"");
  assert.ok(tokens.every((t) => t.length > 0));
  assert.ok(!tokens.some((t) => t.includes('"')));
  assert.deepEqual(tokens, ["she", "said", "yes"]);
});

test("extractTokens: all-emoji input yields empty array", () => {
  assert.deepEqual(extractTokens("🎉🚀"), []);
});

test("extractTokens: empty / whitespace input yields empty array", () => {
  assert.deepEqual(extractTokens(""), []);
  assert.deepEqual(extractTokens("   "), []);
});

test("extractTokens: non-string input yields empty array", () => {
  assert.deepEqual(extractTokens(null), []);
  assert.deepEqual(extractTokens(42), []);
});

test("extractTokens: mixed scripts in one input", () => {
  assert.deepEqual(extractTokens("hello привет"), ["hello", "привет"]);
});
