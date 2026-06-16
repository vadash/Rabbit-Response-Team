// Prompt injector — pure compute layer.
// Per design §8 (injector.js), §9.3 (failure modes). Sits at the top of the
// engine layer: resolves no language itself (lang is a parameter), dispatches
// to random-words and synonym engines, renders templates, and returns
// { random, synonyms } slot descriptors for the caller to apply via
// setExtensionPrompt. Engine layer is free of ST globals.
//
// Collaborators (data modules + warn sink) are injected via __setDepsForTest
// so unit tests never touch real assets or ST globals. src/index.js wires
// the real deps at boot.

import { generateWords } from "./random-words.js";
import { findOverusedWords } from "./synonym-scanner.js";

let deps = {
  words: null,
  synonyms: null,
  warn: (...args) => {
    if (typeof console !== "undefined" && console.warn) console.warn(...args);
  },
};

export function __setDepsForTest(next) {
  deps = { ...deps, ...next };
}

// Replace every {{key}} occurrence with the matching value. Throws if any
// '{{' remains unresolved afterwards — caught upstream so a broken custom
// prompt never silently injects a half-rendered string.
function renderTemplate(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const token = `{{${k}}}`;
    out = out.split(token).join(v);
  }
  if (out.includes("{{")) {
    throw new Error("Unresolved '{{' in prompt template");
  }
  return out;
}

// Map a role string from settings to a setExtensionPrompt role index.
// Unknown values fall back to SYSTEM (0) and emit a warn so misconfigs are
// traceable rather than silent.
export function mapRole(roleStr) {
  switch (roleStr) {
    case "system":
      return 0;
    case "user":
      return 1;
    case "assistant":
      return 2;
    default:
      deps.warn(
        `Rabbit Response Team: unknown injectionEndRole '${roleStr}', falling back to system (0).`
      );
      return 0;
  }
}

// Pure synonym-prompt renderer shared by the production injector and the
// preview/Test button. Runs the scan, builds the rows, applies the outer
// template, and returns the rendered string. Returns null when no overused
// words qualify or when template rendering fails (broken '{{'); the caller
// decides how to surface that — production slot stays null, preview returns
// null so the UI can show a "no overused words" toast. The syn.depth/role
// are NOT applied here; this layer only computes the content string.
function renderSynonymPrompt(syn, lang, chatTexts, settings) {
  const overused = findOverusedWords(chatTexts, lang, settings, {
    synonyms: deps.synonyms,
  });
  if (!Array.isArray(overused) || overused.length === 0) return null;

  const mode = syn.outputMode ?? "with-suggestions";
  const rowTemplate = syn.customPromptRow ?? "";
  const rows = overused.map((entry) => {
    const synonyms =
      mode === "avoid-only"
        ? ""
        : entry.suggestions.map((w) => `"${w}"`).join(", ");
    let rendered = renderTemplate(rowTemplate, {
      originalWord: entry.word,
      count: String(entry.count),
      synonyms,
    });
    if (mode === "avoid-only") {
      rendered = rendered.replace(/\s*[—–-]\s*try:\s*$/i, "");
    }
    return rendered;
  });
  const joinedRows = rows.join("\n");
  return renderTemplate(syn.customPrompt, { rows: joinedRows });
}

/**
 * Pure preview of what the synonyms slot would render for the given chat
 * history. Used by the Test button in the settings panel. Returns the
 * rendered string, or null when no words qualify (the UI surfaces this as a
 * "no overused words" toast). Reuses the same scan + render pipeline as the
 * production slot, so what you see in the preview is what would be injected.
 *
 * Does not read settings.randomWords, so callers may pass a settings object
 * without it. Never throws — broken templates surface as null.
 *
 * @param {object} settings
 * @param {"en"|"ru"} lang
 * @param {string[]} chatTexts
 * @returns {Promise<string|null>}
 */
export async function buildSynonymsPreview(settings, lang, chatTexts) {
  const syn = settings?.synonyms ?? {};
  if (!syn.enabled) return null;
  try {
    return renderSynonymPrompt(syn, lang, chatTexts, settings);
  } catch (err) {
    deps.warn("Rabbit Response Team: synonyms preview failed:", err);
    return null;
  }
}

/**
 * Build rendered injection descriptors for the current turn, without touching
 * ST globals or promptData. Each slot is computed independently; a disabled
 * feature, an empty result, or a rendering failure yields `null` for that
 * slot so the caller can skip it cleanly.
 *
 * @param {object} settings           Full settings object.
 * @param {"en"|"ru"} lang            Resolved language for this turn.
 * @param {string} userMessage        Latest user message text (contextual mode).
 * @param {string[]} chatTexts        Recent chat message texts for synonym scan.
 * @returns {Promise<{ random: {content:string,depth:number,role:number}|null, synonyms: {content:string,depth:number,role:number}|null }>}
 */
export async function buildInjections(settings, lang, userMessage, chatTexts) {
  const rw = settings?.randomWords ?? {};
  const syn = settings?.synonyms ?? {};
  const depth = rw.injectionDepth ?? 0;
  const role = mapRole(rw.injectionEndRole ?? "system");

  let randomSlot = null;
  let synonymsSlot = null;

  if (rw.enabled) {
    try {
      const words = await generateWords(lang, settings, userMessage, {
        words: deps.words,
        synonyms: deps.synonyms,
        history: new Set(),
      });
      if (Array.isArray(words) && words.length > 0) {
        const formatted = words.map((w) => `"${w}"`).join(", ");
        const rendered = renderTemplate(rw.customPrompt, { words: formatted });
        randomSlot = { content: rendered, depth, role };
      }
    } catch (err) {
      deps.warn("Rabbit Response Team: random slot failed:", err);
    }
  }

  if (syn.enabled) {
    try {
      const rendered = renderSynonymPrompt(syn, lang, chatTexts, settings);
      if (rendered !== null) {
        const synDepth = syn.injectionDepth ?? 0;
        const synRole = mapRole(syn.injectionEndRole ?? "system");
        synonymsSlot = { content: rendered, depth: synDepth, role: synRole };
      }
    } catch (err) {
      deps.warn("Rabbit Response Team: synonyms slot failed:", err);
    }
  }

  return { random: randomSlot, synonyms: synonymsSlot };
}
