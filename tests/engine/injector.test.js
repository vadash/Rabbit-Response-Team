// TDD tests for src/engine/injector.js
// Per design §8 (injector.js), §9.3 (failure modes), and the Task 12 plan:
//   - random words disabled → prompt unchanged
//   - both disabled → prompt unchanged
//   - template renders {{words}} placeholder with generated words
//   - synonym template renders {{originalWord}} and {{synonyms}}
//   - injectionDepth: 0 splices at index 0; :3 splices at index 3 (or end)
//   - broken '{{' in custom prompt → caught, logged, prompt unchanged, no throw
//   - generated words array is empty → skips injection that turn
//
// All collaborators (settings, context, data/words, data/synonyms) are injected
// via __setDepsForTest so unit tests never touch real assets or ST globals.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onPromptReady, __setDepsForTest } from "../../src/engine/injector.js";
import {
  DEFAULT_RANDOM_PROMPT,
  DEFAULT_SYNONYM_PROMPT,
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
      customPrompt: DEFAULT_SYNONYM_PROMPT,
      ...(overrides.synonyms ?? {}),
    },
    language: overrides.language ?? "en",
  };
}

function makeChat(n) {
  const roles = ["system", "user", "user", "assistant", "user", "assistant"];
  const chat = [];
  for (let i = 0; i < n; i++) {
    chat.push({ role: roles[i % roles.length], content: `msg-${i}` });
  }
  return chat;
}

describe("injector — onPromptReady", () => {
  let warnCalls;
  let settingsRef;
  let contextRef;

  beforeEach(() => {
    warnCalls = [];
    settingsRef = makeSettings();
    contextRef = { chat: [{ role: "user", content: "hello" }] };
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub(["apple", "running", "serendipity"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
  });

  test("prompt unchanged when both features disabled", async () => {
    const promptData = { chat: makeChat(4) };
    const before = promptData.chat.length;
    const result = await onPromptReady(promptData);
    assert.equal(result.chat.length, before);
    assert.deepEqual(result.chat, makeChat(4));
  });

  test("prompt unchanged when only synonyms disabled and random disabled", async () => {
    settingsRef = makeSettings({ randomWords: { enabled: false }, synonyms: { enabled: false } });
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const promptData = { chat: makeChat(3) };
    await onPromptReady(promptData);
    assert.equal(promptData.chat.length, 3);
  });

  test("random words enabled renders {{words}} placeholder with generated words", async () => {
    settingsRef = makeSettings({ randomWords: { enabled: true, wordCount: 3 } });
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub(["apple", "running", "serendipity"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const promptData = { chat: makeChat(2) };
    await onPromptReady(promptData);
    assert.equal(promptData.chat.length, 3, "one message spliced in");
    const injected = promptData.chat[0];
    assert.equal(injected.role, "system");
    assert.ok(injected.content.includes('"apple"'), "apple rendered");
    assert.ok(injected.content.includes('"running"'), "running rendered");
    assert.ok(injected.content.includes('"serendipity"'), "serendipity rendered");
    assert.ok(!injected.content.includes("{{"), "no unresolved placeholders");
  });

  test("synonyms enabled renders {{originalWord}} and {{synonyms}}", async () => {
    // scanDepth 6, history where "running" appears 3× (≥ minOccurrences=2)
    contextRef = {
      chat: [
        { role: "user", content: "running running running" },
      ],
    };
    settingsRef = makeSettings({
      randomWords: { enabled: false },
      synonyms: { enabled: true, scanDepth: 6, minOccurrences: 2 },
    });
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub([]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const promptData = { chat: makeChat(2) };
    await onPromptReady(promptData);
    assert.equal(promptData.chat.length, 3, "synonym message spliced in");
    const injected = promptData.chat[0];
    assert.ok(injected.content.includes("running"), "originalWord rendered");
    assert.ok(injected.content.includes("jogging"), "synonym rendered");
    assert.ok(injected.content.includes("sprinting"), "synonym rendered");
    assert.ok(!injected.content.includes("{{"), "no unresolved placeholders");
  });

  test("injectionDepth: 0 splices at index 0", async () => {
    settingsRef = makeSettings({
      randomWords: { enabled: true, wordCount: 1, injectionDepth: 0 },
    });
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const promptData = { chat: makeChat(3) };
    await onPromptReady(promptData);
    assert.equal(promptData.chat.length, 4);
    assert.ok(promptData.chat[0].content.includes('"apple"'), "injected at index 0");
    assert.equal(promptData.chat[1].content, "msg-0", "original first msg shifted to index 1");
  });

  test("injectionDepth: 3 splices at index 3", async () => {
    settingsRef = makeSettings({
      randomWords: { enabled: true, wordCount: 1, injectionDepth: 3 },
    });
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const promptData = { chat: makeChat(5) };
    await onPromptReady(promptData);
    assert.equal(promptData.chat.length, 6);
    assert.ok(promptData.chat[3].content.includes('"apple"'), "injected at index 3");
    assert.equal(promptData.chat[0].content, "msg-0", "earlier indices unchanged");
  });

  test("injectionDepth beyond chat length clamps to end", async () => {
    settingsRef = makeSettings({
      randomWords: { enabled: true, wordCount: 1, injectionDepth: 99 },
    });
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const promptData = { chat: makeChat(2) };
    await onPromptReady(promptData);
    assert.equal(promptData.chat.length, 3);
    assert.ok(
      promptData.chat[2].content.includes('"apple"'),
      "injected at end (index 2)"
    );
  });

  test("broken '{{' in custom prompt: caught, logged, prompt unchanged, no throw", async () => {
    settingsRef = makeSettings({
      randomWords: {
        enabled: true,
        wordCount: 2,
        customPrompt: "Broken {{words not closed",
      },
    });
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub(["apple", "running"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const promptData = { chat: makeChat(3) };
    const before = promptData.chat.length;
    await assert.doesNotReject(onPromptReady(promptData));
    assert.equal(promptData.chat.length, before, "prompt unchanged on template error");
    assert.ok(warnCalls.length > 0, "warn was called");
  });

  test("empty generated words array skips injection that turn", async () => {
    settingsRef = makeSettings({ randomWords: { enabled: true, wordCount: 3 } });
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub([]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const promptData = { chat: makeChat(3) };
    await onPromptReady(promptData);
    assert.equal(promptData.chat.length, 3, "no splice when no words generated");
  });

  test("promptData without chat array returns unchanged (no throw)", async () => {
    settingsRef = makeSettings({ randomWords: { enabled: true } });
    __setDepsForTest({
      getSettings: () => settingsRef,
      getContext: () => contextRef,
      words: makeWordsStub(["apple"]),
      synonyms: makeSynonymsStub(),
      warn: (...args) => warnCalls.push(args),
    });
    const result = await onPromptReady({});
    assert.deepEqual(result, {});
  });
});
