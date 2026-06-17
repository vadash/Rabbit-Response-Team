// TDD tests for src/data/words.js
// Per design §4 (asset URL resolution), §5.1 (word bank shape),
// §8 (words.js exports), §9.2 (lazy loading).
//
// Asset loading is stubbed via configure({ fetcher, urlResolver }) — unit tests
// must never touch the real bundled assets.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ensureWordBankLoaded,
  getWordBank,
  sampleWords,
  getWordMeta,
  configure,
  _resetCache,
} from "../../src/data/words.js";

const enFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-en-words.json", import.meta.url)),
    "utf8"
  )
);
const ruFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-ru-words.json", import.meta.url)),
    "utf8"
  )
);

function setupLoader() {
  configure({
    urlResolver: (lang) => `mock://${lang}/words.json`,
    fetcher: async (url) => {
      if (url === "mock://en/words.json") return enFixture;
      if (url === "mock://ru/words.json") return ruFixture;
      throw new Error(`unexpected fetch ${url}`);
    },
  });
}

describe("words.js — lazy loading", () => {
  beforeEach(() => {
    _resetCache();
    setupLoader();
  });

  test("ensureWordBankLoaded populates the cache", async () => {
    await ensureWordBankLoaded("en");
    assert.equal(getWordBank("en").length, enFixture.length);
  });

  test("ensureWordBankLoaded is idempotent (second call does not refetch)", async () => {
    let fetchCount = 0;
    configure({
      urlResolver: (lang) => `mock://${lang}/words.json`,
      fetcher: async (url) => {
        fetchCount++;
        return url === "mock://en/words.json" ? enFixture : ruFixture;
      },
    });
    await ensureWordBankLoaded("en");
    await ensureWordBankLoaded("en");
    assert.equal(fetchCount, 1);
  });

  test("each language has an independent cache slot", async () => {
    await ensureWordBankLoaded("en");
    await ensureWordBankLoaded("ru");
    assert.equal(getWordBank("en").length, enFixture.length);
    assert.equal(getWordBank("ru").length, ruFixture.length);
    assert.notEqual(getWordBank("en"), getWordBank("ru"));
  });

  test("getWordBank returns [] before loading", () => {
    assert.deepEqual(getWordBank("en"), []);
  });
});

describe("words.js — sampleWords", () => {
  beforeEach(() => {
    _resetCache();
    setupLoader();
  });

  test("no filters returns exactly `count` unique items", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", { count: 5 });
    assert.equal(out.length, 5);
    assert.equal(new Set(out).size, 5);
  });

  test("count of zero returns empty array", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", { count: 0 });
    assert.deepEqual(out, []);
  });

  test("POS filter excludes non-matching entries", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", { count: 50, pos: ["n"] });
    assert.ok(out.length > 0);
    for (const word of out) {
      const meta = getWordMeta("en", word);
      assert.equal(meta.pos, "n");
    }
  });

  test("multi-value POS filter admits any of the listed POS", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", { count: 50, pos: ["v", "a"] });
    for (const word of out) {
      const meta = getWordMeta("en", word);
      assert.ok(meta.pos === "v" || meta.pos === "a");
    }
  });

  test("minRank filter excludes ranks below the floor", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", { count: 50, minRank: 8000 });
    for (const word of out) {
      const meta = getWordMeta("en", word);
      assert.ok(meta.rank >= 8000, `${word} rank ${meta.rank} < 8000`);
    }
  });

  test("maxRank filter excludes ranks above the ceiling", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", { count: 50, maxRank: 200 });
    for (const word of out) {
      const meta = getWordMeta("en", word);
      assert.ok(meta.rank <= 200, `${word} rank ${meta.rank} > 200`);
    }
  });

  test("combined min/max rank range", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", { count: 50, minRank: 100, maxRank: 300 });
    for (const word of out) {
      const meta = getWordMeta("en", word);
      assert.ok(meta.rank >= 100 && meta.rank <= 300);
    }
  });

  test("wordLength filter excludes wrong lengths", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", { count: 50, wordLength: 3 });
    for (const word of out) {
      assert.equal(word.length, 3);
    }
  });

  test("wordLength of 0 disables the length filter", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", { count: 50, wordLength: 0 });
    assert.ok(out.length > 1, "should return items of varying lengths");
    const lengths = new Set(out.map((w) => w.length));
    assert.ok(lengths.size > 1);
  });

  test("blacklist set excludes listed words", async () => {
    await ensureWordBankLoaded("en");
    const blacklist = new Set(["apple", "river", "mountain"]);
    const out = sampleWords("en", { count: 50, blacklist });
    for (const word of out) {
      assert.ok(!blacklist.has(word), `${word} should be blacklisted`);
    }
  });

  test("history set excludes listed words", async () => {
    await ensureWordBankLoaded("en");
    const history = new Set(["apple", "river", "mountain"]);
    const out = sampleWords("en", { count: 50, history });
    for (const word of out) {
      assert.ok(!history.has(word), `${word} is in history`);
    }
  });

  test("insufficient pool returns fewer items without throwing", async () => {
    await ensureWordBankLoaded("en");
    // Only POS=n with wordLength=3: dog, cat, car (3 entries)
    const out = sampleWords("en", { count: 100, pos: ["n"], wordLength: 3 });
    assert.ok(out.length <= 3);
    assert.ok(out.length > 0);
  });

  test("no eligible pool returns empty array without throwing", async () => {
    await ensureWordBankLoaded("en");
    // Blacklist everything.
    const allWords = enFixture.map((e) => e[0]);
    const blacklist = new Set(allWords);
    const out = sampleWords("en", { count: 10, blacklist });
    assert.deepEqual(out, []);
  });

  test("respects all filters combined", async () => {
    await ensureWordBankLoaded("en");
    const out = sampleWords("en", {
      count: 20,
      pos: ["a"],
      minRank: 100,
      maxRank: 500,
      wordLength: 0,
      blacklist: new Set(["happy"]),
      history: new Set(["quick"]),
    });
    for (const word of out) {
      assert.notEqual(word, "happy");
      assert.notEqual(word, "quick");
      const meta = getWordMeta("en", word);
      assert.equal(meta.pos, "a");
      assert.ok(meta.rank >= 100 && meta.rank <= 500);
    }
  });

  test("sampling from unloaded language returns empty without throwing", () => {
    const out = sampleWords("en", { count: 5 });
    assert.deepEqual(out, []);
  });

  test("works with Russian fixtures", async () => {
    await ensureWordBankLoaded("ru");
    const out = sampleWords("ru", { count: 5, pos: ["n"] });
    assert.equal(out.length, 5);
    for (const word of out) {
      const meta = getWordMeta("ru", word);
      assert.equal(meta.pos, "n");
    }
  });
});

describe("words.js — getWordMeta", () => {
  beforeEach(() => {
    _resetCache();
    setupLoader();
  });

  test("returns {pos, rank} for a known word", async () => {
    await ensureWordBankLoaded("en");
    const meta = getWordMeta("en", "apple");
    assert.deepEqual(meta, { pos: "n", rank: 100 });
  });

  test("returns null for an unknown word", async () => {
    await ensureWordBankLoaded("en");
    const meta = getWordMeta("en", "nonexistentword");
    assert.equal(meta, null);
  });

  test("returns null before the bank is loaded", () => {
    const meta = getWordMeta("en", "apple");
    assert.equal(meta, null);
  });
});
