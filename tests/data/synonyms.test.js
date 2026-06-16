// TDD tests for src/data/synonyms.js
// Per design §5.2 (synonyms + associations shape), §8 (synonyms.js exports),
// §9.2 (lazy loading).
//
// Asset loading is stubbed via configure({ fetcher, urlResolver }) — unit tests
// must never touch the real bundled assets.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ensureSynonymsLoaded,
  getSynonyms,
  getAssociations,
  hasEntry,
  configure,
  _resetCache,
} from "../../src/data/synonyms.js";

const enFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-en-synonyms.json", import.meta.url)),
    "utf8"
  )
);
const ruFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-ru-synonyms.json", import.meta.url)),
    "utf8"
  )
);

function setupLoader() {
  configure({
    urlResolver: (lang) => `mock://${lang}/synonyms.json`,
    fetcher: async (url) => {
      if (url === "mock://en/synonyms.json") return enFixture;
      if (url === "mock://ru/synonyms.json") return ruFixture;
      throw new Error(`unexpected fetch ${url}`);
    },
  });
}

describe("synonyms.js — lazy loading", () => {
  beforeEach(() => {
    _resetCache();
    setupLoader();
  });

  test("ensureSynonymsLoaded populates the cache", async () => {
    await ensureSynonymsLoaded("en");
    assert.equal(hasEntry("en", "appl"), true);
  });

  test("ensureSynonymsLoaded is idempotent (second call does not refetch)", async () => {
    let fetchCount = 0;
    configure({
      urlResolver: (lang) => `mock://${lang}/synonyms.json`,
      fetcher: async (url) => {
        fetchCount++;
        return url === "mock://en/synonyms.json" ? enFixture : ruFixture;
      },
    });
    await ensureSynonymsLoaded("en");
    await ensureSynonymsLoaded("en");
    assert.equal(fetchCount, 1);
  });

  test("each language has an independent cache slot", async () => {
    await ensureSynonymsLoaded("en");
    await ensureSynonymsLoaded("ru");
    assert.equal(hasEntry("en", "appl"), true);
    assert.equal(hasEntry("ru", "яблок"), true);
  });

  test("hasEntry returns false before loading", () => {
    assert.equal(hasEntry("en", "appl"), false);
  });
});

describe("synonyms.js — lookups", () => {
  beforeEach(() => {
    _resetCache();
    setupLoader();
  });

  test("known word with both fields returns expected arrays", async () => {
    await ensureSynonymsLoaded("en");
    assert.deepEqual(getSynonyms("en", "appl"), ["fruit", "pome"]);
    assert.deepEqual(getAssociations("en", "appl"), ["orchard", "tree", "harvest"]);
  });

  test("known word with only s returns [] from getAssociations", async () => {
    await ensureSynonymsLoaded("en");
    assert.deepEqual(getSynonyms("en", "gentl"), ["soft", "tender"]);
    assert.deepEqual(getAssociations("en", "gentl"), []);
  });

  test("known word with only a returns [] from getSynonyms", async () => {
    await ensureSynonymsLoaded("en");
    assert.deepEqual(getSynonyms("en", "whisper"), []);
    assert.deepEqual(getAssociations("en", "whisper"), ["murmur", "hush"]);
  });

  test("unknown word returns [] from getSynonyms", async () => {
    await ensureSynonymsLoaded("en");
    assert.deepEqual(getSynonyms("en", "nonexistent"), []);
  });

  test("unknown word returns [] from getAssociations", async () => {
    await ensureSynonymsLoaded("en");
    assert.deepEqual(getAssociations("en", "nonexistent"), []);
  });

  test("hasEntry returns true for a known word", async () => {
    await ensureSynonymsLoaded("en");
    assert.equal(hasEntry("en", "appl"), true);
  });

  test("hasEntry returns false for an unknown word", async () => {
    await ensureSynonymsLoaded("en");
    assert.equal(hasEntry("en", "nonexistent"), false);
  });

  test("lookups return [] before loading", () => {
    assert.deepEqual(getSynonyms("en", "appl"), []);
    assert.deepEqual(getAssociations("en", "appl"), []);
  });

  test("works with Russian fixtures", async () => {
    await ensureSynonymsLoaded("ru");
    assert.deepEqual(getSynonyms("ru", "яблок"), ["фрукт", "плод"]);
    assert.deepEqual(getAssociations("ru", "яблок"), ["сад", "дерево"]);
  });
});
