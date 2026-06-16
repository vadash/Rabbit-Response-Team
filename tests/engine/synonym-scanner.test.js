// TDD tests for src/engine/synonym-scanner.js
// Per design §8 (synonym-scanner.js) and the Task 11 plan:
//   - tokenize last `scanDepth` messages
//   - exclude stopwords (EN and RU sets)
//   - build frequency counts
//   - only words with count >= minOccurrences AND hasEntry()===true are returned
//   - suggestions come from getSynonyms() and are non-empty, capped at 2
//   - empty history → []
//   - messages with no script characters (all emoji) are skipped gracefully
//
// The data/synonyms module is injected via opts so unit tests never touch the
// real bundled assets.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { findOverusedWords } from "../../src/engine/synonym-scanner.js";
import { normalize } from "../../src/util/normalize.js";

const enSynonyms = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-en-synonyms.json", import.meta.url)),
    "utf8"
  )
);
const ruSynonyms = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-ru-synonyms.json", import.meta.url)),
    "utf8"
  )
);

function makeSynonymsStub(dataByLang) {
  return {
    hasEntry: (lang, word) =>
      Object.prototype.hasOwnProperty.call(dataByLang[lang] ?? {}, word),
    getSynonyms: (lang, word) => (dataByLang[lang]?.[word]?.s) ?? [],
  };
}

// Build a stub whose keys are stems (the form the build pipeline now emits),
// computed from a headword-keyed source via normalize(). Used by scanner
// tests that need to exercise the normalize-then-lookup path against
// entries expressed in readable headword form.
function stemKeyedStub(lang, headwordEntries) {
  const data = {};
  for (const [headword, entry] of Object.entries(headwordEntries)) {
    data[normalize(headword, lang)] = entry;
  }
  return makeSynonymsStub({ [lang]: data });
}

function baseSettings(scanDepth = 6, minOccurrences = 2) {
  return {
    synonyms: { scanDepth, minOccurrences },
  };
}

describe("synonym-scanner — findOverusedWords", () => {
  beforeEach(() => {
    // Sanity: reset Math.random stubs if a previous test set them.
    // No global state inside the module today, but keep the hook for future tests.
  });

  test("empty history returns []", () => {
    const synonyms = makeSynonymsStub({ en: enSynonyms, ru: ruSynonyms });
    const result = findOverusedWords([], "en", baseSettings(), { synonyms });
    assert.deepEqual(result, []);
  });

  test("tokenizes only last scanDepth messages", () => {
    // 6 messages, but scanDepth=2 → only the last two count.
    // "apple" appears 3× in older messages, but only 1× in the last two.
    // "running" appears 3× in the last two → should be detected.
    const history = [
      "apple apple apple",
      "nothing of interest here",
      "nothing of interest here",
      "nothing of interest here",
      "running running running",
      "apple once",
    ];
    const synonyms = stemKeyedStub("en", { running: enSynonyms.running });
    const result = findOverusedWords(history, "en", baseSettings(2, 2), { synonyms });
    const words = result.map((r) => r.word).sort();
    assert.deepEqual(words, ["running"]);
  });

  test("excludes English stopwords from frequency counts", () => {
    // "the" appears 5× but is a stopword. "running" appears 3× and is not.
    const history = [
      "the the the the the running running running",
    ];
    const synonyms = stemKeyedStub("en", { running: enSynonyms.running });
    const result = findOverusedWords(history, "en", baseSettings(6, 2), { synonyms });
    const words = result.map((r) => r.word);
    assert.deepEqual(words, ["running"]);
  });

  test("excludes Russian stopwords from frequency counts", () => {
    // "и" is a RU stopword, appears many times. "бег" — a word that exists
    // in mini-ru-synonyms and is its own stem.
    const history = [
      "и и и и и бег бег бег",
    ];
    const synonyms = stemKeyedStub("ru", { бег: ruSynonyms.бег });
    const result = findOverusedWords(history, "ru", baseSettings(6, 2), { synonyms });
    // Verify "и" was excluded — only "бег" should appear (if it has an entry).
    const words = result.map((r) => r.word);
    assert.ok(!words.includes("и"), "stopword 'и' must be excluded");
    assert.ok(words.includes("бег"));
  });

  test("only returns words with count >= minOccurrences AND hasEntry===true", () => {
    // "running" has entry and appears 3×. "ghost" has no entry and appears 3×.
    // minOccurrences = 2.
    const history = [
      "running running running ghost ghost ghost",
    ];
    const synonyms = stemKeyedStub("en", { running: enSynonyms.running });
    const result = findOverusedWords(history, "en", baseSettings(6, 2), { synonyms });
    const words = result.map((r) => r.word);
    assert.deepEqual(words, ["running"]);
  });

  test("words below minOccurrences are not returned", () => {
    // "running" appears 2×, minOccurrences=3 → excluded.
    const history = [
      "running running",
    ];
    const synonyms = stemKeyedStub("en", { running: enSynonyms.running });
    const result = findOverusedWords(history, "en", baseSettings(6, 3), { synonyms });
    assert.deepEqual(result, []);
  });

  test("suggestions are non-empty and come from getSynonyms()", () => {
    const history = [
      "running running running",
    ];
    const synonyms = stemKeyedStub("en", { running: enSynonyms.running });
    const result = findOverusedWords(history, "en", baseSettings(6, 2), { synonyms });
    assert.equal(result.length, 1);
    assert.equal(result[0].word, "running");
    assert.equal(result[0].count, 3);
    assert.ok(result[0].suggestions.length > 0, "suggestions must be non-empty");
    for (const s of result[0].suggestions) {
      assert.ok(enSynonyms.running.s.includes(s), `suggestion ${s} must come from getSynonyms`);
    }
  });

  test("suggestions are capped at top 2", () => {
    // Build a stub where the synonym list for a word has 5 entries.
    // "bigword" is its own Porter stem, so the key is unchanged.
    const synonyms = makeSynonymsStub({
      en: { bigword: { s: ["a", "b", "c", "d", "e"] } },
    });
    const history = [
      "bigword bigword bigword",
    ];
    const result = findOverusedWords(history, "en", baseSettings(6, 2), { synonyms });
    assert.equal(result.length, 1);
    assert.ok(result[0].suggestions.length <= 2);
    assert.equal(result[0].suggestions.length, 2);
  });

  test("messages with no script characters (all emoji) are skipped gracefully", () => {
    const history = [
      "😀 😂 🤔 🙃",
      "😀 😂 🤔 🙃",
    ];
    const synonyms = makeSynonymsStub({ en: enSynonyms, ru: ruSynonyms });
    const result = findOverusedWords(history, "en", baseSettings(6, 2), { synonyms });
    assert.deepEqual(result, []);
  });

  test("count is accurate across all retained messages", () => {
    const history = [
      "apple apple",
      "apple apple",
      "apple apple",
    ];
    const synonyms = stemKeyedStub("en", { apple: enSynonyms.apple });
    const result = findOverusedWords(history, "en", baseSettings(6, 2), { synonyms });
    const entry = result.find((r) => r.word === "apple");
    assert.ok(entry);
    assert.equal(entry.count, 6);
  });

  test("uses default synonyms module when opts not provided (still safe on empty cache)", () => {
    // Real module with unloaded cache → hasEntry returns false → empty result.
    // No throw.
    const result = findOverusedWords(
      ["running running running"],
      "en",
      baseSettings(6, 2)
    );
    assert.deepEqual(result, []);
  });
});

describe("synonym-scanner — inflected-input matching via normalize", () => {
  // Per Task 7: stub keys are STEMS (the form the build pipeline now emits).
  // Compute them via normalize() rather than hand-guessing — see design §13.3.
  test("EN inflected chat token matches Porter-stemmed fixture key", () => {
    const enStub = {
      [normalize("apple", "en")]: { s: ["fruit", "pome"] },
      [normalize("run", "en")]: { s: ["jogging", "sprinting"] },
    };
    const synonyms = makeSynonymsStub({ en: enStub });
    // Chat uses inflected forms; scanner must normalize before lookup.
    const history = ["apples apples running running"];
    const result = findOverusedWords(history, "en", baseSettings(6, 2), { synonyms });
    const words = result.map((r) => r.word).sort();
    // Returned word is the RAW chat token (display fidelity), not the stem.
    assert.deepEqual(words, ["apples", "running"]);
    const applesEntry = result.find((r) => r.word === "apples");
    assert.ok(applesEntry, "apples entry must be surfaced");
    assert.deepEqual(applesEntry.suggestions, ["fruit", "pome"]);
  });

  test("RU inflected chat token matches Snowball-stemmed fixture key", () => {
    const ruStub = {
      [normalize("госпожа", "ru")]: { s: ["леди", "дама"] },
      [normalize("ёлка", "ru")]: { s: ["хвоя", "ель"] },
    };
    const synonyms = makeSynonymsStub({ ru: ruStub });
    // Chat uses case-forms; both should resolve to the same stem key.
    const history = ["госпожой госпожой ёлка ёлка"];
    const result = findOverusedWords(history, "ru", baseSettings(6, 2), { synonyms });
    const words = result.map((r) => r.word).sort();
    assert.deepEqual(words, ["госпожой", "ёлка"]);
    const gospEntry = result.find((r) => r.word === "госпожой");
    assert.ok(gospEntry);
    assert.deepEqual(gospEntry.suggestions, ["леди", "дама"]);
  });

  test("ё→е: chat token 'ёлка' matches fixture key computed from 'елка' (stem)", () => {
    // The build applies ё→е before stemming, so the key is the stem of "елка".
    // The chat token contains ё; scanner must apply the same ё→е + stem.
    const expectedKey = normalize("елка", "ru");
    assert.equal(normalize("ёлка", "ru"), expectedKey, "sanity: ё and е forms collapse");
    assert.doesNotMatch(expectedKey, /ё/, "sanity: stem key must not contain ё");
    const ruStub = { [expectedKey]: { s: ["хвоя"] } };
    const synonyms = makeSynonymsStub({ ru: ruStub });
    const result = findOverusedWords(["ёлка ёлка"], "ru", baseSettings(6, 2), { synonyms });
    assert.equal(result.length, 1);
    assert.equal(result[0].word, "ёлка");
    assert.deepEqual(result[0].suggestions, ["хвоя"]);
  });

  test("EN stem-key mismatch (un-stemmed fixture key) does NOT match", () => {
    // Negative case: a fixture whose key is a raw headword (not a stem) should
    // not be reached by an inflected chat token under the new pipeline.
    const synonyms = makeSynonymsStub({
      en: { apple: { s: ["fruit"] } }, // headword key, not stem
    });
    const result = findOverusedWords(["apples apples"], "en", baseSettings(6, 2), { synonyms });
    assert.deepEqual(result, []);
  });
});

describe("sorting and topN", () => {
  // Inline stub with arbitrary words so we can craft exact frequency scenarios
  // without touching the shared fixture. Keys are stored under each word's
  // stem so the normalizing scanner can reach them.
  function stub(words) {
    const data = {};
    for (const w of words) data[normalize(w, "en")] = { s: ["syn-" + w, "syn2-" + w] };
    return makeSynonymsStub({ en: data });
  }

  test("sorts by count descending", () => {
    // A=5, B=3, C=4 → expect [A, C, B]
    const history = [
      "alpha alpha alpha alpha alpha",
      "bravo bravo bravo",
      "charlie charlie charlie charlie",
    ];
    const synonyms = stub(["alpha", "bravo", "charlie"]);
    const result = findOverusedWords(
      history,
      "en",
      { synonyms: { scanDepth: 6, minOccurrences: 2, topN: 10 } },
      { synonyms }
    );
    const words = result.map((r) => r.word);
    assert.deepEqual(words, ["alpha", "charlie", "bravo"]);
  });

  test("alphabetical tiebreaker for equal counts", () => {
    // zebra=3, apple=3 → expect ["apple", "zebra"]
    const history = [
      "zebra zebra zebra",
      "apple apple apple",
    ];
    const synonyms = stub(["zebra", "apple"]);
    const result = findOverusedWords(
      history,
      "en",
      { synonyms: { scanDepth: 6, minOccurrences: 2, topN: 10 } },
      { synonyms }
    );
    const words = result.map((r) => r.word);
    assert.deepEqual(words, ["apple", "zebra"]);
  });

  test("topN cap respected — keeps highest frequency", () => {
    // 3 eligible words with counts 5, 4, 3. topN=2 → keep the two highest.
    const history = [
      "alpha alpha alpha alpha alpha",
      "bravo bravo bravo bravo",
      "charlie charlie charlie",
    ];
    const synonyms = stub(["alpha", "bravo", "charlie"]);
    const result = findOverusedWords(
      history,
      "en",
      { synonyms: { scanDepth: 6, minOccurrences: 2, topN: 2 } },
      { synonyms }
    );
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((r) => r.word),
      ["alpha", "bravo"]
    );
  });

  test("topN larger than pool — no padding", () => {
    const history = [
      "alpha alpha alpha alpha alpha",
      "bravo bravo bravo",
    ];
    const synonyms = stub(["alpha", "bravo"]);
    const result = findOverusedWords(
      history,
      "en",
      { synonyms: { scanDepth: 6, minOccurrences: 2, topN: 10 } },
      { synonyms }
    );
    assert.equal(result.length, 2);
  });

  test("topN missing from settings — falls back to default of 3", () => {
    // 4 eligible words; without topN, expect at most 3 returned.
    const history = [
      "alpha alpha alpha alpha",
      "bravo bravo bravo",
      "charlie charlie charlie",
      "delta delta delta",
    ];
    const synonyms = stub(["alpha", "bravo", "charlie", "delta"]);
    const result = findOverusedWords(
      history,
      "en",
      { synonyms: { scanDepth: 6, minOccurrences: 2 } },
      { synonyms }
    );
    assert.ok(result.length <= 3, "result must be capped at default 3");
    assert.equal(result.length, 3);
    // Highest three by count: alpha(4), and bravo/charlie/delta all tie at 3.
    // Tiebreaker is alphabetical — expect bravo, charlie kept (delta dropped).
    assert.deepEqual(
      result.map((r) => r.word),
      ["alpha", "bravo", "charlie"]
    );
  });
});
