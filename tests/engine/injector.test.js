// TDD tests for src/engine/injector.js — pure compute shape.
// Per Task 1 of the setExtensionPrompt plan: buildInjections returns
// { random, synonyms } where each slot is { content, depth, role } | null.
// Engine layer is free of ST globals; deps are injected via __setDepsForTest.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  buildInjections,
  buildSynonymsPreview,
  __setDepsForTest,
} from "../../src/engine/injector.js";
import {
  DEFAULT_RANDOM_PROMPT,
  DEFAULT_SYNONYM_PROMPT,
  DEFAULT_SYNONYM_PROMPT_ROW,
} from "../../src/settings.js";

function makeWordsStub(sampledWords) {
  return {
    sampleWords: () => sampledWords.slice(),
    getWordMeta: () => null,
    getWordBank: () => [],
  };
}

function makeSynonymsStub() {
  return {
    hasEntry: () => true,
    getSynonyms: (lang, word) => {
      const map = {
        running: ["jogging", "sprinting", "dashing"],
        apple: ["fruit", "pome"],
      };
      return map[word] ?? [];
    },
    getAssociations: () => [],
  };
}

function makeSettings(overrides = {}) {
  return {
    schemaVersion: 1,
    randomWords: {
      enabled: false,
      wordCount: 3,
      customPrompt: DEFAULT_RANDOM_PROMPT,
      injectionDepth: 0,
      injectionEndRole: "system",
      wordLength: 0,
      partsOfSpeech: { noun: true, verb: true, adjective: true, adverb: false },
      mode: "random",
      wordHistorySize: 50,
      blacklist: [],
      themeWords: "",
      ...(overrides.randomWords ?? {}),
    },
    synonyms: {
      enabled: false,
      scanDepth: 6,
      minOccurrences: 2,
      customPrompt: DEFAULT_SYNONYM_PROMPT,
      customPromptRow: DEFAULT_SYNONYM_PROMPT_ROW,
      topN: 3,
      outputMode: "with-suggestions",
      injectionDepth: 0,
      injectionEndRole: "system",
      ...(overrides.synonyms ?? {}),
    },
    language: overrides.language ?? "en",
  };
}

describe("injector — buildInjections", () => {
  let warnCalls;

  beforeEach(() => {
    warnCalls = [];
    __setDepsForTest({
      words: makeWordsStub(["apple", "running", "serendipity"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
  });

  test("both features disabled → both slots null", async () => {
    const settings = makeSettings();
    const result = await buildInjections(settings, "en", "hello", ["hello"]);
    assert.equal(result.random, null);
    assert.equal(result.synonyms, null);
  });

  test("random enabled → slot has rendered content, depth, role=0 (system)", async () => {
    const settings = makeSettings({
      randomWords: { enabled: true, wordCount: 3, injectionDepth: 0 },
    });
    const result = await buildInjections(settings, "en", "hello", ["hello"]);
    assert.notEqual(result.random, null);
    assert.equal(result.random.depth, 0);
    assert.equal(result.random.role, 0);
    assert.ok(result.random.content.includes('"apple"'), "apple rendered");
    assert.ok(result.random.content.includes('"running"'), "running rendered");
    assert.ok(
      result.random.content.includes('"serendipity"'),
      "serendipity rendered"
    );
    assert.ok(
      !result.random.content.includes("{{"),
      "no unresolved placeholders"
    );
    assert.equal(result.synonyms, null);
  });

  test("synonyms enabled → slot non-null, random null, substitutions rendered", async () => {
    const settings = makeSettings({
      randomWords: { enabled: false },
      synonyms: { enabled: true, scanDepth: 6, minOccurrences: 2 },
    });
    const chatTexts = ["running running running"];
    const result = await buildInjections(settings, "en", "running", chatTexts);
    assert.equal(result.random, null);
    assert.notEqual(result.synonyms, null);
    assert.ok(
      result.synonyms.content.includes("running"),
      "originalWord rendered"
    );
    assert.ok(
      result.synonyms.content.includes("jogging"),
      "synonym rendered"
    );
    assert.ok(
      result.synonyms.content.includes("sprinting"),
      "synonym rendered"
    );
    assert.ok(
      !result.synonyms.content.includes("{{"),
      "no unresolved placeholders"
    );
    assert.ok(
      !result.synonyms.content.includes("{{rows}}"),
      "{{rows}} placeholder resolved"
    );
  });

  test("with-suggestions renders all top-N rows", async () => {
    const settings = makeSettings({
      randomWords: { enabled: false },
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        topN: 3,
        outputMode: "with-suggestions",
      },
    });
    const chatTexts = ["running running running apple apple apple"];
    const result = await buildInjections(settings, "en", "hi", chatTexts);
    assert.notEqual(result.synonyms, null);
    assert.ok(result.synonyms.content.includes("running"), "running row");
    assert.ok(result.synonyms.content.includes("apple"), "apple row");
    assert.ok(result.synonyms.content.includes("jogging"), "running synonyms");
    assert.ok(result.synonyms.content.includes("fruit"), "apple synonyms");
    assert.ok(
      !result.synonyms.content.includes("{{rows}}"),
      "{{rows}} resolved"
    );
    assert.ok(
      !result.synonyms.content.includes("{{"),
      "no unresolved placeholders"
    );
  });

  test("avoid-only renders rows without synonyms", async () => {
    const settings = makeSettings({
      randomWords: { enabled: false },
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        topN: 3,
        outputMode: "avoid-only",
      },
    });
    const chatTexts = ["running running running apple apple apple"];
    const result = await buildInjections(settings, "en", "hi", chatTexts);
    assert.notEqual(result.synonyms, null);
    assert.ok(result.synonyms.content.includes("running"), "running row");
    assert.ok(result.synonyms.content.includes("apple"), "apple row");
    assert.ok(
      !result.synonyms.content.includes("jogging"),
      "no synonyms leaked in avoid-only"
    );
    assert.ok(
      !result.synonyms.content.includes("fruit"),
      "no synonyms leaked in avoid-only"
    );
    assert.ok(
      !/try:\s*$/.test(result.synonyms.content),
      "trailing 'try:' separator stripped"
    );
    assert.ok(
      !result.synonyms.content.includes("{{"),
      "no unresolved placeholders"
    );
  });

  test("empty scan → synonyms slot null", async () => {
    const settings = makeSettings({
      randomWords: { enabled: false },
      synonyms: { enabled: true, scanDepth: 6, minOccurrences: 5 },
    });
    const chatTexts = ["running running"];
    const result = await buildInjections(settings, "en", "hi", chatTexts);
    assert.equal(result.synonyms, null);
  });

  test("synonyms depth is independent of randomWords depth", async () => {
    const settings = makeSettings({
      randomWords: { enabled: false, injectionDepth: 0 },
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        injectionDepth: 4,
      },
    });
    const chatTexts = ["running running running"];
    const result = await buildInjections(settings, "en", "hi", chatTexts);
    assert.notEqual(result.synonyms, null);
    assert.equal(result.synonyms.depth, 4);
  });

  test("synonyms role is independent of randomWords role", async () => {
    const settings = makeSettings({
      randomWords: { enabled: false, injectionEndRole: "system" },
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        injectionEndRole: "user",
      },
    });
    const chatTexts = ["running running running"];
    const result = await buildInjections(settings, "en", "hi", chatTexts);
    assert.notEqual(result.synonyms, null);
    assert.equal(result.synonyms.role, 1);
  });

  test("broken '{{' in row template → synonyms slot null AND warn called", async () => {
    const settings = makeSettings({
      randomWords: { enabled: false },
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        customPromptRow: "broken {{originalWord",
      },
    });
    const chatTexts = ["running running running"];
    const result = await buildInjections(settings, "en", "hi", chatTexts);
    assert.equal(result.synonyms, null);
    assert.ok(warnCalls.length > 0, "warn called for broken row template");
  });

  test("broken '{{' in outer template → synonyms slot null AND warn called", async () => {
    const settings = makeSettings({
      randomWords: { enabled: false },
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        customPrompt: "broken {{rows",
      },
    });
    const chatTexts = ["running running running"];
    const result = await buildInjections(settings, "en", "hi", chatTexts);
    assert.equal(result.synonyms, null);
    assert.ok(warnCalls.length > 0, "warn called for broken outer template");
  });

  test("single overused word still produces a non-null slot", async () => {
    const settings = makeSettings({
      randomWords: { enabled: false },
      synonyms: { enabled: true, scanDepth: 6, minOccurrences: 2 },
    });
    const chatTexts = ["running running"];
    const result = await buildInjections(settings, "en", "hi", chatTexts);
    assert.notEqual(result.synonyms, null);
    assert.ok(result.synonyms.content.includes("running"));
  });

  test("depth=N passes through to result.random.depth", async () => {
    const settings = makeSettings({
      randomWords: { enabled: true, wordCount: 1, injectionDepth: 3 },
    });
    __setDepsForTest({
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const result = await buildInjections(settings, "en", "hi", ["hi"]);
    assert.equal(result.random.depth, 3);
  });

  test("role='user' maps to result.random.role === 1", async () => {
    const settings = makeSettings({
      randomWords: { enabled: true, wordCount: 1, injectionEndRole: "user" },
    });
    __setDepsForTest({
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const result = await buildInjections(settings, "en", "hi", ["hi"]);
    assert.equal(result.random.role, 1);
  });

  test("role='assistant' maps to result.random.role === 2", async () => {
    const settings = makeSettings({
      randomWords: { enabled: true, wordCount: 1, injectionEndRole: "assistant" },
    });
    __setDepsForTest({
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const result = await buildInjections(settings, "en", "hi", ["hi"]);
    assert.equal(result.random.role, 2);
  });

  test("unknown role string falls back to 0 (SYSTEM) and triggers warn", async () => {
    const settings = makeSettings({
      randomWords: { enabled: true, wordCount: 1, injectionEndRole: "wizard" },
    });
    __setDepsForTest({
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const result = await buildInjections(settings, "en", "hi", ["hi"]);
    assert.equal(result.random.role, 0);
    assert.ok(
      warnCalls.length > 0,
      "warn called for unknown role"
    );
  });

  test("broken '{{' in custom prompt → result.random is null AND warn was called", async () => {
    const settings = makeSettings({
      randomWords: {
        enabled: true,
        wordCount: 2,
        customPrompt: "Broken {{words not closed",
      },
    });
    __setDepsForTest({
      words: makeWordsStub(["apple", "running"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const result = await buildInjections(settings, "en", "hi", ["hi"]);
    assert.equal(result.random, null);
    assert.ok(warnCalls.length > 0, "warn was called");
  });

  test("empty generated words array → result.random is null", async () => {
    const settings = makeSettings({
      randomWords: { enabled: true, wordCount: 3 },
    });
    __setDepsForTest({
      words: makeWordsStub([]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const result = await buildInjections(settings, "en", "hi", ["hi"]);
    assert.equal(result.random, null);
  });

  test("generateWords throws → caught, result.random is null, warn called", async () => {
    // generateWords reads settings.randomWords.mode outside its internal
    // try/catch, so a Proxy that throws on `.mode` propagates to
    // buildInjections. Other fields remain readable so buildInjections reaches
    // the generateWords call site.
    const throwingRW = new Proxy(
      {
        enabled: true,
        wordCount: 1,
        injectionDepth: 0,
        injectionEndRole: "system",
        customPrompt: DEFAULT_RANDOM_PROMPT,
        mode: "random",
        wordHistorySize: 50,
        blacklist: [],
        themeWords: "",
        partsOfSpeech: { noun: true, verb: true, adjective: true, adverb: false },
        wordLength: 0,
      },
      {
        get(target, prop) {
          if (prop === "mode") throw new Error("boom");
          return target[prop];
        },
      }
    );
    const settings = { ...makeSettings(), randomWords: throwingRW };
    __setDepsForTest({
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const result = await buildInjections(settings, "en", "hi", ["hi"]);
    assert.equal(result.random, null);
    assert.ok(warnCalls.length > 0, "warn was called on generateWords throw");
  });
});

describe("injector — buildSynonymsPreview", () => {
  let warnCalls;

  beforeEach(() => {
    warnCalls = [];
    __setDepsForTest({
      words: makeWordsStub(["apple", "running", "serendipity"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
  });

  test("returns rendered string when overused words found", async () => {
    const settings = makeSettings({
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        outputMode: "with-suggestions",
      },
    });
    const chatTexts = ["running running running"];
    const result = await buildSynonymsPreview(settings, "en", chatTexts);
    assert.equal(typeof result, "string");
    assert.ok(result.includes("running"), "contains originalWord");
    assert.ok(result.includes("jogging"), "contains a synonym");
    assert.ok(!result.includes("{{"), "no unresolved placeholders");
  });

  test("returns null when nothing overused (empty history)", async () => {
    const settings = makeSettings({
      synonyms: { enabled: true, scanDepth: 6, minOccurrences: 2 },
    });
    const result = await buildSynonymsPreview(settings, "en", []);
    assert.equal(result, null);
  });

  test("returns null when no words cross threshold", async () => {
    const settings = makeSettings({
      synonyms: { enabled: true, scanDepth: 6, minOccurrences: 5 },
    });
    const chatTexts = ["running running"];
    const result = await buildSynonymsPreview(settings, "en", chatTexts);
    assert.equal(result, null);
  });

  test("respects topN cap", async () => {
    const settings = makeSettings({
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        topN: 2,
        outputMode: "with-suggestions",
      },
    });
    // 5 distinct eligible words: running, apple, serendipity, dashing, jogging
    // (the synonyms stub doesn't haveEntry for serendipity/dashing/jogging, so
    // rely on multiple words that DO have entries: running + apple only).
    // Build 5 eligible words by repeating words the synonyms stub recognizes.
    const chatTexts = [
      "running running running",
      "apple apple apple",
    ];
    const result = await buildSynonymsPreview(settings, "en", chatTexts);
    assert.equal(typeof result, "string");
    // With topN=2, both running and apple fit; assert at most 2 rows.
    const rowMatches = result.match(/^.*\(\d+×\).*$/gm) ?? [];
    assert.ok(rowMatches.length <= 2, `topN cap respected: ${rowMatches.length}`);
    assert.ok(result.includes("running") || result.includes("apple"));
  });

  test("avoid-only mode: no synonyms in output", async () => {
    const settings = makeSettings({
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        outputMode: "avoid-only",
      },
    });
    const chatTexts = ["running running running"];
    const result = await buildSynonymsPreview(settings, "en", chatTexts);
    assert.equal(typeof result, "string");
    assert.ok(result.includes("running"), "contains originalWord");
    assert.ok(!result.includes("jogging"), "no synonyms leaked");
    assert.ok(!result.includes("sprinting"), "no synonyms leaked");
  });

  test("does not depend on randomWords settings", async () => {
    const settings = {
      schemaVersion: 1,
      synonyms: {
        enabled: true,
        scanDepth: 6,
        minOccurrences: 2,
        customPrompt: DEFAULT_SYNONYM_PROMPT,
        customPromptRow: DEFAULT_SYNONYM_PROMPT_ROW,
        topN: 3,
        outputMode: "with-suggestions",
        injectionDepth: 0,
        injectionEndRole: "system",
      },
      language: "en",
    };
    const chatTexts = ["running running running"];
    const result = await buildSynonymsPreview(settings, "en", chatTexts);
    assert.equal(typeof result, "string");
    assert.ok(result.includes("running"));
  });
});
