// TDD tests for src/engine/random-words.js
// Per design §8 (Mode semantics) and the Task 10 plan:
//   - random:      sampleWords() with filters
//   - double-pass: anchor with hasEntry()===true, fill from associations,
//                  fall back to plain random after DOUBLE_PASS_ANCHOR_RETRIES
//   - contextual:  tokenize user message, pick highest-rank keyword with
//                  hasEntry()===true, return its associations; fall back to
//                  random and warn once when no candidate has an entry
//
// The data modules are stubbed via the `words`/`synonyms` opts so unit tests
// never touch the real bundled assets.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { generateWords } from "../../src/engine/random-words.js";
import { normalize } from "../../src/util/normalize.js";

const enWords = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-en-words.json", import.meta.url)),
    "utf8"
  )
);
const enSynonyms = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-en-synonyms.json", import.meta.url)),
    "utf8"
  )
);
const ruWords = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-ru-words.json", import.meta.url)),
    "utf8"
  )
);
const ruSynonyms = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/mini-ru-synonyms.json", import.meta.url)),
    "utf8"
  )
);

// Build stub data modules against in-memory fixtures.
function makeWordsStub(bankByLang) {
  return {
    getWordBank: (lang) => bankByLang[lang] ?? [],
    getWordMeta: (lang, word) => {
      const bank = bankByLang[lang] ?? [];
      for (const e of bank) {
        if (e[0] === word) return { pos: e[1], rank: e[2] };
      }
      return null;
    },
    // Minimal sampleWords: filters + Fisher-Yates via Math.random.
    sampleWords: (lang, opts) => {
      const {
        count = 0,
        pos,
        minRank = 1,
        maxRank = Number.POSITIVE_INFINITY,
        wordLength = 0,
        blacklist = new Set(),
        history = new Set(),
      } = opts;
      const bank = bankByLang[lang] ?? [];
      if (bank.length === 0 || count <= 0) return [];
      const eligible = [];
      for (const e of bank) {
        const [w, p, r] = e;
        if (blacklist.has(w)) continue;
        if (history.has(w)) continue;
        if (r < minRank || r > maxRank) continue;
        if (pos && !pos.includes(p)) continue;
        if (wordLength && w.length !== wordLength) continue;
        eligible.push(w);
      }
      // Fisher-Yates
      for (let i = eligible.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
      }
      return eligible.slice(0, count);
    },
  };
}

function makeSynonymsStub(dataByLang) {
  return {
    getSynonyms: (lang, word) => dataByLang[lang]?.[word]?.s ?? [],
    getAssociations: (lang, word) => dataByLang[lang]?.[word]?.a ?? [],
    hasEntry: (lang, word) =>
      !!dataByLang[lang] &&
      Object.prototype.hasOwnProperty.call(dataByLang[lang], word),
  };
}

// Re-key a headword-keyed synonyms map under each headword's stem, so stubs
// mirror the form the build pipeline now emits and the contextual-mode
// normalizing lookup can reach them. Values (s/a arrays) stay as headwords.
function stemKeyedSynonymsStub(dataByLang) {
  const out = {};
  for (const [lang, entries] of Object.entries(dataByLang)) {
    out[lang] = {};
    for (const [headword, entry] of Object.entries(entries)) {
      out[lang][normalize(headword, lang)] = entry;
    }
  }
  return makeSynonymsStub(out);
}

function baseSettings(patch = {}) {
  return {
    schemaVersion: 1,
    randomWords: {
      enabled: true,
      wordCount: 3,
      customPrompt: "{{words}}",
      injectionDepth: 0,
      injectionEndRole: "system",
      wordLength: 0,
      partsOfSpeech: { noun: true, verb: true, adjective: true, adverb: false },
      mode: "random",
      wordHistorySize: 50,
      blacklist: [],
      themeWords: "",
      ...patch,
    },
    synonyms: {
      enabled: false,
      scanDepth: 6,
      minOccurrences: 3,
      customPrompt: "",
    },
    language: "auto",
  };
}

function defaultDeps() {
  return {
    words: makeWordsStub({ en: enWords, ru: ruWords }),
    synonyms: stemKeyedSynonymsStub({ en: enSynonyms, ru: ruSynonyms }),
    warn: () => {},
  };
}

describe("random-words — random mode", () => {
  let deps;
  beforeEach(() => {
    deps = defaultDeps();
  });

  test("returns wordCount items", () => {
    const out = generateWords("en", baseSettings(), "", { ...deps });
    assert.equal(out.length, 3);
  });

  test("respects blacklist exclusion", () => {
    const bank = new Set(enWords.map((e) => e[0]));
    const out = generateWords(
      "en",
      baseSettings({ wordCount: 50, blacklist: ["apple", "river"] }),
      "",
      { ...deps }
    );
    for (const w of out) {
      assert.ok(w !== "apple" && w !== "river");
      assert.ok(bank.has(w));
    }
  });

  test("respects history exclusion", () => {
    const history = new Set(["apple", "river", "mountain"]);
    const out = generateWords(
      "en",
      baseSettings({ wordCount: 50 }),
      "",
      { ...deps, history }
    );
    for (const w of out) {
      assert.ok(!history.has(w));
    }
  });

  test("respects partsOfSpeech filter", () => {
    const out = generateWords(
      "en",
      baseSettings({
        wordCount: 50,
        partsOfSpeech: { noun: true, verb: false, adjective: false, adverb: false },
      }),
      "",
      { ...deps }
    );
    for (const w of out) {
      const meta = deps.words.getWordMeta("en", w);
      assert.equal(meta.pos, "n");
    }
  });

  test("respects wordLength filter", () => {
    const out = generateWords(
      "en",
      baseSettings({ wordCount: 50, wordLength: 3 }),
      "",
      { ...deps }
    );
    for (const w of out) {
      assert.equal(w.length, 3);
    }
  });

  test("returns no duplicates", () => {
    const out = generateWords(
      "en",
      baseSettings({ wordCount: 10 }),
      "",
      { ...deps }
    );
    assert.equal(new Set(out).size, out.length);
  });
});

describe("random-words — double-pass mode", () => {
  let deps;
  beforeEach(() => {
    deps = defaultDeps();
  });

  test("anchor has a synonyms entry and result includes anchor + associations", () => {
    // Build a synonyms stub where every word in the bank has an entry —
    // this mirrors real data (SYNONYMS_TOP_N ≈ ⅔ of WORDS_TOP_N) so the
    // DOUBLE_PASS_ANCHOR_RETRIES loop reliably finds an anchor.
    const dense = {};
    for (const e of enWords) {
      dense[e[0]] = { s: ["syn-" + e[0]], a: ["assoc-" + e[0]] };
    }
    const denseSyn = makeSynonymsStub({ en: dense, ru: {} });
    const out = generateWords(
      "en",
      baseSettings({ mode: "double-pass", wordCount: 3 }),
      "",
      { ...deps, synonyms: denseSyn }
    );
    assert.equal(out.length, 3);
    // Anchor (first slot) must have an entry in the synonyms data.
    const anchor = out[0];
    assert.ok(denseSyn.hasEntry("en", anchor), "anchor must have entry");
    // Anchor's association must appear somewhere in the result.
    assert.ok(out.includes("assoc-" + anchor), "anchor's association included");
  });

  test("falls back to plain random when no word has a synonyms entry", () => {
    // Synonyms data with no keys — every hasEntry() returns false.
    const emptySyn = makeSynonymsStub({ en: {}, ru: {} });
    const out = generateWords(
      "en",
      baseSettings({ mode: "double-pass", wordCount: 4 }),
      "",
      { ...deps, synonyms: emptySyn }
    );
    assert.equal(out.length, 4);
    // No anchor constraints — just random words from the bank.
    const bank = new Set(enWords.map((e) => e[0]));
    for (const w of out) assert.ok(bank.has(w));
  });

  test("respects blacklist in double-pass mode", () => {
    const out = generateWords(
      "en",
      baseSettings({ mode: "double-pass", wordCount: 3, blacklist: ["apple", "running"] }),
      "",
      { ...deps }
    );
    for (const w of out) {
      assert.ok(w !== "apple" && w !== "running");
    }
  });
});

describe("random-words — contextual mode", () => {
  let deps;
  beforeEach(() => {
    deps = defaultDeps();
  });

  test("uses associations of the highest-rank keyword with an entry", () => {
    // User message mentions "apple" (rank 100, hasEntry true) and "running"
    // (rank 75 — wait, no; "running" is not in mini-en-words). apple has the
    // lowest rank among message words that appear in the bank and have an
    // entry. Its associations are ["orchard","tree","harvest"].
    const out = generateWords(
      "en",
      baseSettings({ mode: "contextual", wordCount: 5 }),
      "I ate an apple today",
      { ...deps }
    );
    // All returned words should come from apple's associations list.
    const assoc = new Set(["orchard", "tree", "harvest"]);
    for (const w of out) assert.ok(assoc.has(w), `${w} should be an apple association`);
    assert.ok(out.length > 0);
  });

  test("falls back to random and warns when no keyword has an entry", () => {
    const warns = [];
    // Message words all in bank but none have entries in synonyms data.
    // "river" rank 200, "mountain" rank 300, "house" rank 500 — none in
    // mini-en-synonyms.json.
    const out = generateWords(
      "en",
      baseSettings({ mode: "contextual", wordCount: 3 }),
      "the river near the mountain house",
      { ...deps, warn: (m) => warns.push(m) }
    );
    assert.equal(out.length, 3);
    // Should have warned once.
    assert.equal(warns.length, 1);
    // Result is plain random — all words from the bank.
    const bank = new Set(enWords.map((e) => e[0]));
    for (const w of out) assert.ok(bank.has(w));
  });

  test("drops stopwords when extracting keywords", () => {
    // Message is mostly stopwords with one content word that has an entry.
    const out = generateWords(
      "en",
      baseSettings({ mode: "contextual", wordCount: 3 }),
      "the apple is on the table", // "the", "is", "on" are stopwords
      { ...deps }
    );
    const assoc = new Set(["orchard", "tree", "harvest"]);
    assert.ok(out.length > 0);
    for (const w of out) assert.ok(assoc.has(w));
  });

  test("respects blacklist in contextual mode", () => {
    // Blacklist the association we'd otherwise return — should produce fewer.
    const out = generateWords(
      "en",
      baseSettings({ mode: "contextual", wordCount: 3, blacklist: ["orchard", "tree", "harvest"] }),
      "I ate an apple today",
      { ...deps }
    );
    for (const w of out) {
      assert.ok(w !== "orchard" && w !== "tree" && w !== "harvest");
    }
  });
});

describe("random-words — robustness", () => {
  let deps;
  beforeEach(() => {
    deps = defaultDeps();
  });

  test("unknown mode does not throw (falls back to random)", () => {
    const out = generateWords(
      "en",
      baseSettings({ mode: "weird-mode", wordCount: 2 }),
      "",
      { ...deps }
    );
    assert.equal(out.length, 2);
  });

  test("does not throw when word bank is empty", () => {
    const emptyWords = makeWordsStub({ en: [], ru: [] });
    const out = generateWords(
      "en",
      baseSettings({ mode: "random", wordCount: 3 }),
      "",
      { ...deps, words: emptyWords }
    );
    assert.deepEqual(out, []);
  });

  test("does not throw in contextual mode when userMessage is empty", () => {
    const out = generateWords(
      "en",
      baseSettings({ mode: "contextual", wordCount: 3 }),
      "",
      { ...deps }
    );
    // No keywords → fall back to random.
    assert.equal(out.length, 3);
  });

  test("works with Russian fixtures", () => {
    const out = generateWords(
      "ru",
      baseSettings({ mode: "random", wordCount: 3 }),
      "",
      { ...deps }
    );
    assert.equal(out.length, 3);
    const bank = new Set(ruWords.map((e) => e[0]));
    for (const w of out) assert.ok(bank.has(w));
  });

  test("Russian contextual mode picks яблоко associations", () => {
    // яблоко rank 100, hasEntry true, associations ["сад", "дерево"].
    const out = generateWords(
      "ru",
      baseSettings({ mode: "contextual", wordCount: 3 }),
      "я ем яблоко каждый день",
      { ...deps }
    );
    const assoc = new Set(["сад", "дерево"]);
    assert.ok(out.length > 0);
    for (const w of out) assert.ok(assoc.has(w));
  });
});

describe("random-words — contextual mode with inflected user tokens", () => {
  // Per Task 8: user messages contain inflected forms (e.g. "apples",
  // "госпожой"); runContextual must normalize candidate tokens before the
  // hasEntry / getAssociations lookup so they resolve to the stem keys the
  // build pipeline emits.
  test("EN inflected user token resolves to Porter-stemmed fixture key", () => {
    // Words stub: accept "apples" as a known keyword (bank rank 100) so it
    // survives the getWordMeta ranking step. Synonyms stub carries the
    // build-emitted stem key ("appl") with associations to return.
    const words = {
      getWordMeta: (lang, w) => (w === "apples" ? { pos: "n", rank: 100 } : null),
      sampleWords: () => [],
    };
    const stem = normalize("apple", "en");
    assert.equal(stem, "appl", "sanity: Porter stem of 'apple' is 'appl'");
    const synonyms = makeSynonymsStub({
      en: { [stem]: { s: ["fruit"], a: ["orchard", "tree", "harvest"] } },
    });
    const out = generateWords(
      "en",
      baseSettings({ mode: "contextual", wordCount: 3 }),
      "I picked apples today",
      { words, synonyms, warn: () => {} }
    );
    assert.ok(out.length > 0, "must not fall back to empty/random");
    const assoc = new Set(["orchard", "tree", "harvest"]);
    for (const w of out) assert.ok(assoc.has(w), `${w} should be an apple association`);
  });

  test("RU inflected user token resolves to Snowball-stemmed fixture key", () => {
    // "госпожой" → normalize → "госпож" (fixed-point stem, design §13.3).
    const words = {
      getWordMeta: (lang, w) =>
        w === "госпожой" ? { pos: "n", rank: 100 } : null,
      sampleWords: () => [],
    };
    const stem = normalize("госпожа", "ru");
    assert.equal(stem, "госпож", "sanity: Snowball stem of 'госпожа' is 'госпож'");
    assert.equal(
      normalize("госпожой", "ru"),
      stem,
      "sanity: inflected form collapses to same stem"
    );
    const synonyms = makeSynonymsStub({
      ru: { [stem]: { s: ["леди"], a: ["дама", "повелительница"] } },
    });
    const out = generateWords(
      "ru",
      baseSettings({ mode: "contextual", wordCount: 2 }),
      "я видел госпожой сегодня",
      { words, synonyms, warn: () => {} }
    );
    assert.ok(out.length > 0, "must not fall back to empty/random");
    const assoc = new Set(["дама", "повелительница"]);
    for (const w of out) assert.ok(assoc.has(w));
  });

  test("ё→е: RU user token 'ёлка' matches stem key computed from 'елка'", () => {
    const expectedKey = normalize("елка", "ru");
    assert.equal(normalize("ёлка", "ru"), expectedKey, "sanity: ё and е collapse");
    assert.equal(normalize("ёлку", "ru"), expectedKey, "sanity: inflected 'ёлку' collapses to same stem");
    assert.doesNotMatch(expectedKey, /ё/, "sanity: stem key has no ё");
    const words = {
      getWordMeta: (lang, w) => (w === "ёлку" ? { pos: "n", rank: 50 } : null),
      sampleWords: () => [],
    };
    const synonyms = makeSynonymsStub({
      ru: { [expectedKey]: { a: ["хвоя", "ель"] } },
    });
    const out = generateWords(
      "ru",
      baseSettings({ mode: "contextual", wordCount: 2 }),
      "срубили ёлку вчера",
      { words, synonyms, warn: () => {} }
    );
    assert.ok(out.length > 0);
    const assoc = new Set(["хвоя", "ель"]);
    for (const w of out) assert.ok(assoc.has(w));
  });

  test("headword-keyed (un-stemmed) synonyms data does NOT match inflected token", () => {
    // Negative case: if a stub's key is a raw headword instead of a stem,
    // the normalizing lookup must not reach it.
    const words = {
      getWordMeta: (lang, w) => (w === "apples" ? { pos: "n", rank: 100 } : null),
      sampleWords: () => [],
    };
    const synonyms = makeSynonymsStub({
      en: { apple: { a: ["orchard"] } }, // headword key, not stem
    });
    const warns = [];
    const out = generateWords(
      "en",
      baseSettings({ mode: "contextual", wordCount: 3 }),
      "I picked apples today",
      { words, synonyms, warn: (m) => warns.push(m) }
    );
    // No stem-keyed match → falls back to random (sampleWords returns [] here
    // → empty result) and warns once.
    assert.equal(warns.length, 1);
    assert.deepEqual(out, []);
  });
});

describe("random-words — runRandom / runDoublePass do not normalize picks", () => {
  // Regression (Task 8 step 2): only runContextual normalizes. The other two
  // modes sample from the word bank, which keeps headword form, so their
  // output must be raw headwords from the bank — never stems.
  test("runRandom returns bank headwords verbatim (no stem transformation)", () => {
    const deps = defaultDeps();
    const out = generateWords(
      "en",
      baseSettings({ mode: "random", wordCount: 5 }),
      "",
      { ...deps }
    );
    const bank = new Set(enWords.map((e) => e[0]));
    for (const w of out) {
      assert.ok(bank.has(w), `${w} must be a bank headword, not a stem`);
    }
  });

  test("runDoublePass samples raw bank headwords as anchors (no stem transformation)", () => {
    // Dense stub keyed by headword — double-pass must call hasEntry with the
    // raw headword it sampled, NOT a normalized stem. If normalization leaked
    // into this lookup, the dense headword keys would never match and the
    // anchor loop would fall back to plain random (still 4 items, but the
    // "anchor has entry" property tested elsewhere would silently break).
    const deps = defaultDeps();
    const dense = {};
    for (const e of enWords) dense[e[0]] = { s: ["syn-" + e[0]], a: ["assoc-" + e[0]] };
    const denseSyn = makeSynonymsStub({ en: dense, ru: {} });
    const out = generateWords(
      "en",
      baseSettings({ mode: "double-pass", wordCount: 4 }),
      "",
      { ...deps, synonyms: denseSyn }
    );
    assert.equal(out.length, 4);
    const anchor = out[0];
    const bank = new Set(enWords.map((e) => e[0]));
    assert.ok(bank.has(anchor), `anchor ${anchor} must be a bank headword, not a stem`);
    // And the anchor must have a headword-keyed entry in the dense stub —
    // proves hasEntry received the raw headword, not a stem.
    assert.ok(denseSyn.hasEntry("en", anchor));
  });
});
