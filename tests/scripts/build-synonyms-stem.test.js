import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { stemAndMergeSynonyms } from "../../scripts/lib/stemmer.js";

describe("stemAndMergeSynonyms (build-side)", () => {
  test("EN: applies Porter stem to keys; plural and singular collapse", () => {
    const src = {
      apple: { s: ["fruit"], a: ["orchard"] },
      apples: { s: ["crop"], a: ["tree"] },
      running: { s: ["sprint"], a: ["jog"] },
    };
    const out = stemAndMergeSynonyms(src, "en");

    // Keys must be stems, not headwords.
    assert.ok(!("apple" in out), "raw headword 'apple' must not survive as a key");
    assert.ok(!("apples" in out), "raw headword 'apples' must not survive as a key");
    assert.ok(!("running" in out), "raw headword 'running' must not survive as a key");

    // apple + apples both stem to "appl" — they merge into one entry.
    assert.ok("appl" in out, "expected merged 'appl' stem key");
    assert.ok("run" in out, "expected 'run' stem key for 'running'");
  });

  test("EN: colliding headwords union their s and a arrays with first-seen dedupe", () => {
    const src = {
      apple: { s: ["fruit", "pome"], a: ["orchard"] },
      apples: { s: ["pome", "crop"], a: ["orchard", "tree"] },
    };
    const out = stemAndMergeSynonyms(src, "en");

    const merged = out.appl;
    assert.ok(merged, "expected merged 'appl' entry");
    // union deduped, first-seen order
    assert.deepEqual(merged.s, ["fruit", "pome", "crop"]);
    assert.deepEqual(merged.a, ["orchard", "tree"]);
  });

  test("RU: applies Snowball stem + ё→е to keys", () => {
    const src = {
      госпожа: { s: ["дама"], a: ["леди"] },
      госпожой: { s: ["дамой"], a: [] },
      ещё: { s: ["пока"], a: ["опять"] },
    };
    const out = stemAndMergeSynonyms(src, "ru");

    // No key may contain ё — invariant preserved by the normalize pipeline.
    for (const key of Object.keys(out)) {
      assert.ok(!key.includes("ё"), `key "${key}" must not contain ё`);
    }

    // госпожа + госпожой collapse to one stem.
    assert.ok("госпож" in out, "expected merged 'госпож' stem key");
    // ещё→ещ (with ё normalized to е before stemming).
    assert.ok("ещ" in out, "expected 'ещ' stem key from 'ещё'");

    const merged = out["госпож"];
    assert.deepEqual(merged.s, ["дама", "дамой"]);
    assert.deepEqual(merged.a, ["леди"]);
  });

  test("values are NOT stemmed — only keys", () => {
    const src = {
      running: { s: ["jogging", "sprinting"], a: ["marathons"] },
    };
    const out = stemAndMergeSynonyms(src, "en");

    const entry = out.run;
    assert.ok(entry, "expected 'run' stem key");
    // Original headword-form suggestions survive intact.
    assert.deepEqual(entry.s, ["jogging", "sprinting"]);
    assert.deepEqual(entry.a, ["marathons"]);
  });

  test("empty input yields empty output", () => {
    assert.deepEqual(stemAndMergeSynonyms({}, "en"), {});
  });

  test("non-string or empty-stem keys are dropped", () => {
    const src = {
      "": { s: ["x"], a: [] },
      "   ": { s: ["y"], a: [] },
    };
    const out = stemAndMergeSynonyms(src, "en");
    assert.deepEqual(out, {});
  });
});
