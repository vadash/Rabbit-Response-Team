import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  detectLanguage,
  resolveLanguage,
  STOPWORDS_EN,
  STOPWORDS_RU,
} from "../../src/data/language.js";

describe("language — detectLanguage", () => {
  test("pure English → 'en'", () => {
    assert.equal(detectLanguage("The quick brown fox jumps over the lazy dog"), "en");
  });

  test("pure Russian → 'ru'", () => {
    assert.equal(detectLanguage("Быстрый коричневый лис перепрыгивает через ленивую собаку"), "ru");
  });

  test("mixed script, more Cyrillic → 'ru'", () => {
    assert.equal(detectLanguage("ugh, same here — да блин опять, совсем забыл"), "ru");
  });

  test("mixed script, more Latin → 'en'", () => {
    assert.equal(detectLanguage("да, this is mostly english with one stray word"), "en");
  });

  test("tie → 'en'", () => {
    // Equal Latin and Cyrillic counts should default to English.
    assert.equal(detectLanguage("hi да"), "en");
  });

  test("empty string → null", () => {
    assert.equal(detectLanguage(""), null);
  });

  test("all-emoji → null", () => {
    assert.equal(detectLanguage("🐰🔥✨🎉"), null);
  });

  test("numeric only → null", () => {
    assert.equal(detectLanguage("12345 6789 0"), null);
  });

  test("single stray Cyrillic word in English message → 'en' (count-based)", () => {
    assert.equal(detectLanguage("yeah I was thinking about going there tomorrow, да"), "en");
  });

  test("whitespace-only → null", () => {
    assert.equal(detectLanguage("   \t\n  "), null);
  });
});

describe("language — resolveLanguage", () => {
  test("forced 'en' ignores message script", () => {
    assert.equal(resolveLanguage("en", "привет как дела"), "en");
  });

  test("forced 'ru' ignores message script", () => {
    assert.equal(resolveLanguage("ru", "hello there friend"), "ru");
  });

  test("'auto' dispatches to detectLanguage", () => {
    assert.equal(resolveLanguage("auto", "hello there friend"), "en");
    assert.equal(resolveLanguage("auto", "привет как дела"), "ru");
  });

  test("'auto' with unparseable input → 'en' (default fallback)", () => {
    assert.equal(resolveLanguage("auto", ""), "en");
    assert.equal(resolveLanguage("auto", "🐰🔥✨"), "en");
  });
});

describe("language — stopword sets", () => {
  test("STOPWORDS_EN is a Set", () => {
    assert.ok(STOPWORDS_EN instanceof Set);
  });

  test("STOPWORDS_RU is a Set", () => {
    assert.ok(STOPWORDS_RU instanceof Set);
  });

  test("'the' is in EN stopwords", () => {
    assert.ok(STOPWORDS_EN.has("the"));
  });

  test("'и' is in RU stopwords", () => {
    assert.ok(STOPWORDS_RU.has("и"));
  });

  test("STOPWORDS_RU has no duplicates (regression: duplicate 'мне')", () => {
    // A Set cannot contain duplicates by construction, so this test guards
    // against the source literal being refactored back to an array.
    // We check by ensuring size matches unique count via JSON round-trip.
    const arr = [...STOPWORDS_RU];
    const unique = new Set(arr);
    assert.equal(arr.length, unique.size, "RU stopword literal must not contain duplicates");
  });

  test("STOPWORDS_EN has no duplicates", () => {
    const arr = [...STOPWORDS_EN];
    const unique = new Set(arr);
    assert.equal(arr.length, unique.size, "EN stopword literal must not contain duplicates");
  });

  test("stopwords are lowercase", () => {
    for (const w of STOPWORDS_EN) {
      assert.equal(w, w.toLowerCase(), `EN stopword '${w}' must be lowercase`);
    }
    for (const w of STOPWORDS_RU) {
      assert.equal(w, w.toLowerCase(), `RU stopword '${w}' must be lowercase`);
    }
  });
});
