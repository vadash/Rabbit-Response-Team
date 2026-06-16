import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  defaultSettings,
  migrate,
  loadSettings,
  saveSettings,
  DEFAULT_RANDOM_PROMPT,
  DEFAULT_SYNONYM_PROMPT,
  DEFAULT_SYNONYM_PROMPT_ROW,
  __setDepsForTest,
} from "../../src/settings.js";

// Build a fresh fake ST environment for each test.
function makeDeps() {
  const store = {};
  return {
    store,
    extension_settings: store,
    saveSettingsDebounced: () => {},
    consoleWarn: [],
  };
}

function resetDeps(deps) {
  __setDepsForTest({
    extension_settings: deps.extension_settings,
    saveSettingsDebounced: deps.saveSettingsDebounced,
    warn: (msg) => deps.consoleWarn.push(msg),
  });
}

describe("settings — defaults", () => {
  test("defaultSettings has schemaVersion 1 and expected shape", () => {
    assert.equal(defaultSettings.schemaVersion, 1);
    assert.equal(defaultSettings.language, "auto");
    assert.equal(defaultSettings.randomWords.enabled, false);
    assert.equal(defaultSettings.randomWords.wordCount, 3);
    assert.equal(defaultSettings.randomWords.mode, "random");
    assert.equal(defaultSettings.randomWords.customPrompt, DEFAULT_RANDOM_PROMPT);
    assert.equal(defaultSettings.synonyms.enabled, false);
    assert.equal(defaultSettings.synonyms.scanDepth, 10);
    assert.equal(defaultSettings.synonyms.minOccurrences, 5);
    assert.equal(defaultSettings.synonyms.topN, 3);
    assert.equal(defaultSettings.synonyms.outputMode, "with-suggestions");
    assert.equal(defaultSettings.synonyms.injectionDepth, 0);
    assert.equal(defaultSettings.synonyms.injectionEndRole, "system");
    assert.equal(defaultSettings.synonyms.customPrompt, DEFAULT_SYNONYM_PROMPT);
    assert.equal(defaultSettings.synonyms.customPromptRow, DEFAULT_SYNONYM_PROMPT_ROW);
  });

  test("DEFAULT_RANDOM_PROMPT contains {{words}} placeholder", () => {
    assert.ok(DEFAULT_RANDOM_PROMPT.includes("{{words}}"));
  });

  test("DEFAULT_SYNONYM_PROMPT contains {{rows}} placeholder", () => {
    assert.ok(DEFAULT_SYNONYM_PROMPT.includes("{{rows}}"));
  });

  test("DEFAULT_SYNONYM_PROMPT_ROW contains {{originalWord}}, {{count}}, {{synonyms}} placeholders", () => {
    assert.ok(DEFAULT_SYNONYM_PROMPT_ROW.includes("{{originalWord}}"));
    assert.ok(DEFAULT_SYNONYM_PROMPT_ROW.includes("{{count}}"));
    assert.ok(DEFAULT_SYNONYM_PROMPT_ROW.includes("{{synonyms}}"));
  });
});

describe("settings — migrate", () => {
  test("(a) fresh install (no legacy keys) → defaultSettings unchanged", () => {
    const deps = makeDeps();
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.deepEqual(result, defaultSettings);
    // legacy keys are not created
    assert.equal(deps.extension_settings.randomWords, undefined);
    assert.equal(deps.extension_settings.synonyms, undefined);
  });

  test("(b) old datamuse + contextual → mode: 'contextual'", () => {
    const deps = makeDeps();
    deps.extension_settings.randomWords = {
      apiProvider: "datamuse",
      datamuseMode: "contextual",
    };
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.equal(result.randomWords.mode, "contextual");
  });

  test("(c) old doublePass=true → mode: 'double-pass'", () => {
    const deps = makeDeps();
    deps.extension_settings.randomWords = { doublePass: true };
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.equal(result.randomWords.mode, "double-pass");
  });

  test("(d) both doublePass and contextualMode true → mode: 'contextual' and console.warn", () => {
    const deps = makeDeps();
    deps.extension_settings.randomWords = { doublePass: true, contextualMode: true };
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.equal(result.randomWords.mode, "contextual");
    assert.ok(
      deps.consoleWarn.length > 0,
      "expected a warning when both doublePass and contextualMode are set",
    );
  });

  test("(e) old partOfSpeechNoun=false → partsOfSpeech.noun: false", () => {
    const deps = makeDeps();
    deps.extension_settings.randomWords = {
      partOfSpeechNoun: false,
      partOfSpeechVerb: true,
      partOfSpeechAdj: false,
      partOfSpeechAdv: true,
    };
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.equal(result.randomWords.partsOfSpeech.noun, false);
    assert.equal(result.randomWords.partsOfSpeech.verb, true);
    assert.equal(result.randomWords.partsOfSpeech.adjective, false);
    assert.equal(result.randomWords.partsOfSpeech.adverb, true);
  });

  test("(f) legacy randomWords.language='en' → top-level language: 'en'", () => {
    const deps = makeDeps();
    deps.extension_settings.randomWords = { language: "en" };
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.equal(result.language, "en");
  });

  test("(g) no legacy language → top-level language: 'auto'", () => {
    const deps = makeDeps();
    deps.extension_settings.randomWords = { wordCount: 5 };
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.equal(result.language, "auto");
  });

  test("legacy extension_settings.randomWords is deleted by migrate", () => {
    const deps = makeDeps();
    deps.extension_settings.randomWords = { doublePass: true };
    resetDeps(deps);
    migrate(deps.extension_settings);
    assert.equal(deps.extension_settings.randomWords, undefined);
  });

  test("legacy extension_settings.synonyms is deleted by migrate", () => {
    const deps = makeDeps();
    deps.extension_settings.synonyms = { scanDepth: 4 };
    resetDeps(deps);
    migrate(deps.extension_settings);
    assert.equal(deps.extension_settings.synonyms, undefined);
  });

  test("resulting schemaVersion is 1", () => {
    const deps = makeDeps();
    deps.extension_settings.randomWords = { doublePass: true };
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.equal(result.schemaVersion, 1);
  });

  test("synonyms scanDepth / minOccurrences are migrated", () => {
    const deps = makeDeps();
    deps.extension_settings.synonyms = { scanDepth: 9, minOccurrences: 4 };
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.equal(result.synonyms.scanDepth, 9);
    assert.equal(result.synonyms.minOccurrences, 4);
  });

  test("synonyms migration preserves legacy scanDepth and fills new fields with defaults", () => {
    const deps = makeDeps();
    deps.extension_settings.synonyms = {
      enabled: true,
      scanDepth: 4,
      minOccurrences: 2,
      customPrompt: "x",
    };
    resetDeps(deps);
    const result = migrate(deps.extension_settings);
    assert.equal(result.synonyms.scanDepth, 4);
    assert.equal(result.synonyms.minOccurrences, 2);
    assert.equal(result.synonyms.customPrompt, "x");
    assert.equal(result.synonyms.topN, 3);
    assert.equal(result.synonyms.outputMode, "with-suggestions");
    assert.equal(result.synonyms.injectionDepth, 0);
    assert.equal(result.synonyms.injectionEndRole, "system");
    assert.equal(result.synonyms.customPromptRow, DEFAULT_SYNONYM_PROMPT_ROW);
  });
});

describe("settings — loadSettings", () => {
  test("(h) unparseable JSON in storage → falls back to defaults, stashes raw under __corruptedBackup, warns", () => {
    // We simulate corrupted stored settings by hand-feeding a non-JSON string
    // in the slot where loadSettings expects to read serialized state.
    const deps = {
      store: {},
      extension_settings: {},
      saveSettingsDebounced: () => {},
      consoleWarn: [],
    };
    // Place a corrupted serialized blob under the new namespace.
    deps.extension_settings.rabbitResponseTeam = "not-an-object-corrupted";
    resetDeps(deps);
    const result = loadSettings();
    assert.deepEqual(result, {
      ...defaultSettings,
      __corruptedBackup: "not-an-object-corrupted",
    });
    assert.ok(
      deps.consoleWarn.length > 0,
      "expected a warning when stored settings are corrupted",
    );
  });

  test("loadSettings runs migration when schemaVersion is missing", () => {
    const deps = makeDeps();
    deps.extension_settings.randomWords = { doublePass: true };
    resetDeps(deps);
    const result = loadSettings();
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.randomWords.mode, "double-pass");
    // legacy keys deleted
    assert.equal(deps.extension_settings.randomWords, undefined);
  });

  test("loadSettings returns cached when schemaVersion matches and no legacy keys", () => {
    const deps = makeDeps();
    deps.extension_settings.rabbitResponseTeam = JSON.parse(JSON.stringify(defaultSettings));
    resetDeps(deps);
    const result = loadSettings();
    assert.deepEqual(result, defaultSettings);
  });

  test("loadSettings fresh-slot round-trip returns all new synonyms fields at defaults", () => {
    const deps = makeDeps();
    resetDeps(deps);
    const result = loadSettings();
    assert.equal(result.synonyms.topN, 3);
    assert.equal(result.synonyms.outputMode, "with-suggestions");
    assert.equal(result.synonyms.injectionDepth, 0);
    assert.equal(result.synonyms.injectionEndRole, "system");
    assert.equal(result.synonyms.customPromptRow, DEFAULT_SYNONYM_PROMPT_ROW);
  });
});

describe("settings — saveSettings", () => {
  test("deep-merges patches without overwriting siblings", () => {
    const deps = makeDeps();
    resetDeps(deps);
    // Prime with full defaults
    loadSettings();
    saveSettings({ randomWords: { wordCount: 7 } });
    const stored = deps.extension_settings.rabbitResponseTeam;
    assert.equal(stored.randomWords.wordCount, 7);
    // sibling field preserved
    assert.equal(stored.randomWords.enabled, defaultSettings.randomWords.enabled);
    // other top-level branch untouched
    assert.equal(stored.synonyms.enabled, defaultSettings.synonyms.enabled);
  });

  test("saveSettings writes to extension_settings.rabbitResponseTeam", () => {
    const deps = makeDeps();
    resetDeps(deps);
    loadSettings();
    saveSettings({ language: "ru" });
    assert.equal(deps.extension_settings.rabbitResponseTeam.language, "ru");
  });

  test("saveSettings calls saveSettingsDebounced", () => {
    let saved = 0;
    const deps = makeDeps();
    __setDepsForTest({
      extension_settings: deps.extension_settings,
      saveSettingsDebounced: () => { saved += 1; },
      warn: (msg) => deps.consoleWarn.push(msg),
    });
    loadSettings();
    saveSettings({ language: "ru" });
    assert.equal(saved, 1);
  });
});
