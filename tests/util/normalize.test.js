// TDD tests for src/util/normalize.js
// Covers the canonical match-key pipeline: lower → trim → ё→е (RU) → stem.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../../src/util/normalize.js";

describe("normalize — EN inflection collapse", () => {
  test("apples ≡ apple", () => {
    assert.equal(normalize("apples", "en"), normalize("apple", "en"));
  });

  test("running ≡ run", () => {
    assert.equal(normalize("running", "en"), normalize("run", "en"));
  });

  test("houses ≡ house", () => {
    assert.equal(normalize("houses", "en"), normalize("house", "en"));
  });
});

describe("normalize — RU case collapse (design motivating example)", () => {
  test("госпожа ≡ госпожой ≡ госпожи", () => {
    const a = normalize("госпожа", "ru");
    const b = normalize("госпожой", "ru");
    const c = normalize("госпожи", "ru");
    assert.equal(a, b);
    assert.equal(b, c);
  });
});

describe("normalize — ё→е (RU only)", () => {
  test("ещё ≡ еще", () => {
    assert.equal(normalize("ещё", "ru"), normalize("еще", "ru"));
  });

  test("ё→е does NOT fire for EN: 'ё' stays lowercased, orthography unchanged", () => {
    // Porter stemmer leaves 'ё' alone; we just confirm it's lowercased,
    // not converted to 'е'.
    assert.equal(normalize("ё", "en"), "ё");
    assert.notEqual(normalize("ё", "en"), "е");
  });
});

describe("normalize — unknown lang", () => {
  test("returns lowercased trimmed word with no stemming", () => {
    assert.equal(normalize("Foo", "xx"), "foo");
  });
});

describe("normalize — non-string input returns ''", () => {
  test("null", () => {
    assert.equal(normalize(null, "en"), "");
  });

  test("undefined", () => {
    assert.equal(normalize(undefined, "ru"), "");
  });

  test("number", () => {
    assert.equal(normalize(42, "en"), "");
  });
});

describe("normalize — empty / whitespace input returns ''", () => {
  test("empty string", () => {
    assert.equal(normalize("", "en"), "");
  });

  test("whitespace only", () => {
    assert.equal(normalize("   ", "ru"), "");
  });
});

describe("normalize — case-insensitivity", () => {
  test("Apple ≡ APPLE ≡ apple", () => {
    assert.equal(normalize("Apple", "en"), normalize("APPLE", "en"));
    assert.equal(normalize("APPLE", "en"), normalize("apple", "en"));
  });
});
