// Prompt injector orchestrator.
// Per design §8 (injector.js), §9.3 (failure modes). Sits at the top of the
// engine layer: resolves language, dispatches to random-words and synonym
// engines, renders templates, and splices rendered prompts into promptData.chat.
//
// All collaborators (settings provider, context, data modules, warn sink) are
// injected via __setDepsForTest so unit tests never touch real assets or ST
// globals. src/index.js wires the real deps at boot.

import { resolveLanguage } from "../data/language.js";
import { generateWords } from "./random-words.js";
import { findOverusedWords } from "./synonym-scanner.js";

let deps = {
  getSettings: () => null,
  getContext: () => ({ chat: [] }),
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

function computeInsertIndex(depth, chatLength) {
  const d = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
  return Math.min(d, chatLength);
}

function messageText(msg) {
  if (!msg) return "";
  return msg.mes ?? msg.content ?? "";
}

function lastUserText(chat) {
  for (let i = chat.length - 1; i >= 0; i--) {
    const m = chat[i];
    if (!m) continue;
    const role = m.role ?? (m.is_user ? "user" : "assistant");
    if (role === "user") return messageText(m);
  }
  return "";
}

// Build all rendered injection messages BEFORE mutating promptData. If any
// rendering fails, no splice happens — satisfies design §9.3 "broken '{{' →
// prompt unchanged".
async function buildInjections(settings, lang, userMessage, chatHistoryTexts) {
  const rw = settings.randomWords ?? {};
  const syn = settings.synonyms ?? {};
  const out = [];

  if (rw.enabled) {
    const words = await generateWords(lang, settings, userMessage, {
      words: deps.words,
      synonyms: deps.synonyms,
      history: new Set(),
    });
    if (Array.isArray(words) && words.length > 0) {
      const formatted = words.map((w) => `"${w}"`).join(", ");
      const rendered = renderTemplate(rw.customPrompt, { words: formatted });
      out.push({
        depth: rw.injectionDepth ?? 0,
        role: rw.injectionEndRole ?? "system",
        content: rendered,
      });
    }
  }

  if (syn.enabled) {
    const overused = findOverusedWords(chatHistoryTexts, lang, settings, {
      synonyms: deps.synonyms,
    });
    if (Array.isArray(overused) && overused.length > 0) {
      const target = overused[0];
      const formatted = target.suggestions.map((w) => `"${w}"`).join(", ");
      const rendered = renderTemplate(syn.customPrompt, {
        originalWord: target.word,
        synonyms: formatted,
      });
      out.push({
        depth: rw.injectionDepth ?? 0,
        role: rw.injectionEndRole ?? "system",
        content: rendered,
      });
    }
  }

  return out;
}

/**
 * SillyTavern CHAT_COMPLETION_PROMPT_READY handler.
 * Resolves language for the current turn, dispatches to the random-words and
 * synonym engines, renders templates, and splices rendered prompts into
 * promptData.chat. Any error is caught and logged so a broken custom prompt
 * or asset miss never breaks the user's chat turn.
 *
 * @param {{ chat?: Array<{role: string, content: string}> }} promptData
 * @returns {Promise<typeof promptData>}
 */
export async function onPromptReady(promptData) {
  if (!promptData || !Array.isArray(promptData.chat)) return promptData;

  const settings = deps.getSettings();
  if (!settings) return promptData;

  const rw = settings.randomWords ?? {};
  const syn = settings.synonyms ?? {};
  if (!rw.enabled && !syn.enabled) return promptData;

  try {
    const ctx = deps.getContext() ?? {};
    const ctxChat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const userMessage = lastUserText(ctxChat);
    const chatTexts = ctxChat.map(messageText);
    const lang = resolveLanguage(settings.language ?? "auto", userMessage);

    const injections = await buildInjections(
      settings,
      lang,
      userMessage,
      chatTexts
    );

    // Apply highest-depth first so earlier indices remain stable as later
    // splices grow the array.
    injections.sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
    for (const inj of injections) {
      const idx = computeInsertIndex(inj.depth, promptData.chat.length);
      promptData.chat.splice(idx, 0, { role: inj.role, content: inj.content });
    }
  } catch (err) {
    deps.warn("Rabbit Response Team: onPromptReady failed:", err);
  }

  return promptData;
}
