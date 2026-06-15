// Settings module — defaults, migration from legacy schema, load/save.
// Per design §7. ST globals are injectable for tests via __setDepsForTest.

const NAMESPACE = "rabbitResponseTeam";

export const DEFAULT_RANDOM_PROMPT = `[OOC NARRATIVE OVERDRIVE: You must naturally incorporate the following words into your response: {{words}}. Use each word at least once, weaving them seamlessly into the narrative flow. DO NOT bold, italicize, or add any visual indicators around these words - they must appear as normal text, indistinguishable from the rest of your writing.]`;

export const DEFAULT_SYNONYM_PROMPT = `[OOC WORD FRESHNESS: The word "{{originalWord}}" has been used frequently. For variety and freshness, try using these synonyms instead: {{synonyms}}. Weave them naturally into your response.]`;

export const defaultSettings = {
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
  },
  synonyms: {
    enabled: false,
    scanDepth: 6,
    minOccurrences: 3,
    customPrompt: DEFAULT_SYNONYM_PROMPT,
  },
  language: "auto",
};

// Injectable ST globals. Default to no-op stubs; src/index.js wires the real ones
// at boot, tests override via __setDepsForTest.
let deps = {
  extension_settings: {},
  saveSettingsDebounced: () => {},
  warn: (msg) => console.warn(msg),
};

export function __setDepsForTest(next) {
  deps = {
    extension_settings: next.extension_settings ?? deps.extension_settings,
    saveSettingsDebounced: next.saveSettingsDebounced ?? deps.saveSettingsDebounced,
    warn: next.warn ?? deps.warn,
  };
}

function mapOldMode(rw) {
  if (rw.apiProvider === "datamuse" && rw.datamuseMode === "contextual") return "contextual";
  if (rw.doublePass && rw.contextualMode) {
    deps.warn("Both doublePass and contextualMode set in legacy settings; defaulting to contextual.");
    return "contextual";
  }
  if (rw.doublePass) return "double-pass";
  if (rw.contextualMode) return "contextual";
  return "random";
}

function migratePartsOfSpeech(rw) {
  return {
    noun: rw.partOfSpeechNoun ?? true,
    verb: rw.partOfSpeechVerb ?? true,
    adjective: rw.partOfSpeechAdj ?? true,
    adverb: rw.partOfSpeechAdv ?? false,
  };
}

// Read legacy extension_settings.randomWords / .synonyms, produce new shape.
// Mutates the input by deleting the legacy keys.
export function migrate(raw) {
  const result = structuredClone(defaultSettings);

  const rw = raw.randomWords;
  const syn = raw.synonyms;

  if (rw && typeof rw === "object") {
    if (typeof rw.enabled === "boolean") result.randomWords.enabled = rw.enabled;
    if (typeof rw.wordCount === "number") result.randomWords.wordCount = rw.wordCount;
    if (typeof rw.customPrompt === "string") result.randomWords.customPrompt = rw.customPrompt;
    if (typeof rw.injectionDepth === "number") result.randomWords.injectionDepth = rw.injectionDepth;
    if (typeof rw.injectionEndRole === "string") result.randomWords.injectionEndRole = rw.injectionEndRole;
    if (typeof rw.wordLength === "number") result.randomWords.wordLength = rw.wordLength;
    if (typeof rw.wordHistorySize === "number") result.randomWords.wordHistorySize = rw.wordHistorySize;
    if (typeof rw.historySize === "number") result.randomWords.wordHistorySize = rw.historySize;
    if (Array.isArray(rw.blacklist)) result.randomWords.blacklist = rw.blacklist;
    if (typeof rw.wordBlacklist === "string" && rw.wordBlacklist.trim()) {
      result.randomWords.blacklist = rw.wordBlacklist
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);
    }
    if (typeof rw.themeWords === "string") result.randomWords.themeWords = rw.themeWords;

    result.randomWords.mode = mapOldMode(rw);
    result.randomWords.partsOfSpeech = migratePartsOfSpeech(rw);

    if (typeof rw.language === "string" && (rw.language === "en" || rw.language === "ru")) {
      result.language = rw.language;
    }
  }

  if (syn && typeof syn === "object") {
    if (typeof syn.enabled === "boolean") result.synonyms.enabled = syn.enabled;
    if (typeof syn.scanDepth === "number") result.synonyms.scanDepth = syn.scanDepth;
    if (typeof syn.minOccurrences === "number") result.synonyms.minOccurrences = syn.minOccurrences;
    if (typeof syn.customPrompt === "string") result.synonyms.customPrompt = syn.customPrompt;
  }

  delete raw.randomWords;
  delete raw.synonyms;

  return result;
}

export function loadSettings() {
  const slot = deps.extension_settings[NAMESPACE];

  // Slot never initialized → fresh install; seed defaults.
  if (slot === undefined) {
    const migrated = migrate(deps.extension_settings);
    deps.extension_settings[NAMESPACE] = migrated;
    return migrated;
  }

  // Slot corrupted (not a plain object) → fall back to defaults, preserve raw.
  if (slot === null || typeof slot !== "object" || Array.isArray(slot)) {
    deps.warn("Rabbit Response Team settings were corrupted; resetting to defaults.");
    const fallback = { ...structuredClone(defaultSettings), __corruptedBackup: slot };
    deps.extension_settings[NAMESPACE] = fallback;
    return fallback;
  }

  // Already on new schema with no surviving legacy keys → return as-is.
  if (
    (slot.schemaVersion === undefined || slot.schemaVersion >= 1) &&
    deps.extension_settings.randomWords === undefined &&
    deps.extension_settings.synonyms === undefined
  ) {
    return slot;
  }

  // Legacy keys still present → migrate and merge.
  const migrated = migrate(deps.extension_settings);
  // Preserve any new-schema state already present (e.g. user-edited customPrompt).
  deps.extension_settings[NAMESPACE] = mergeDeep(migrated, slot);
  return deps.extension_settings[NAMESPACE];
}

function mergeDeep(base, patch) {
  if (Array.isArray(base)) return Array.isArray(patch) ? patch : base;
  if (base && typeof base === "object") {
    const out = { ...base };
    for (const k of Object.keys(patch ?? {})) {
      if (patch[k] && typeof patch[k] === "object" && !Array.isArray(patch[k])) {
        out[k] = mergeDeep(base[k] ?? {}, patch[k]);
      } else if (patch[k] !== undefined) {
        out[k] = patch[k];
      }
    }
    return out;
  }
  return patch;
}

export function saveSettings(patch) {
  const current = loadSettings();
  const merged = mergeDeep(current, patch);
  merged.schemaVersion = 1;
  deps.extension_settings[NAMESPACE] = merged;
  deps.saveSettingsDebounced();
}
