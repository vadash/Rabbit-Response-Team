// TDD tests for src/engine/injector.js — pure compute shape.
// Per Task 1 of the setExtensionPrompt plan: buildInjections returns
// { random, synonyms } where each slot is { content, depth, role } | null.
// Engine layer is free of ST globals; deps are injected via __setDepsForTest.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { buildInjections, __setDepsForTest } from "../../src/engine/injector.js";
import {
  DEFAULT_RANDOM_PROMPT,
} from "../../src/settings.js";

// The injector test fixture uses a literal single-word template (matching the
// current renderer's {{originalWord}}/{{synonyms}} contract). DEFAULT_SYNONYM_PROMPT
// moved to a {{rows}} outer wrapper in the synonym-overhaul design; the multi-word
// rendering pipeline lands in a later task, at which point this fixture is rewritten.
const SYN_PROMPT_LEGACY = `[OOC WORD FRESHNESS: "{{originalWord}}" used frequently. Try: {{synonyms}}.]`;

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
      const map = { running: ["jogging", "sprinting", "dashing"] };
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
      customPrompt: SYN_PROMPT_LEGACY,
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
