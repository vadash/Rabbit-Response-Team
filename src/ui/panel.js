// Settings panel — render + event binding.
// Per design §8 (ui/panel.js). UI never imports engine (design §4 dependency rule),
// with one exception: the "Test Random Words" button calls the random-words engine
// directly to surface a sample. ST globals (jQuery, toastr, saveSettingsDebounced)
// are injected via __setDepsForTest so tests can run in Node without a DOM.

import { panelShell } from "./templates.js";
import {
  defaultSettings,
  DEFAULT_RANDOM_PROMPT,
  DEFAULT_SYNONYM_PROMPT,
  DEFAULT_SYNONYM_PROMPT_ROW,
  loadSettings,
  saveSettings,
} from "../settings.js";
import { resolveLanguage } from "../data/language.js";

let deps = {
  $: null,
  toastr: null,
  // Per design §4 dependency rule, UI must not import engine. The Test buttons
  // need engine helpers, so they are injected from src/index.js at boot.
  generateWords: null,
  buildSynonymsPreview: null,
  getContext: () => ({ chat: [], lastMessageText: () => "" }),
  warn: (...args) => {
    if (typeof console !== "undefined" && console.warn) console.warn(...args);
  },
};

export function __setDepsForTest(next) {
  deps = { ...deps, ...next };
}

function ensureDefaults() {
  if (!deps.$ && typeof globalThis !== "undefined" && globalThis.jQuery) {
    deps.$ = globalThis.jQuery;
  }
  if (!deps.toastr && typeof globalThis !== "undefined" && globalThis.toastr) {
    deps.toastr = globalThis.toastr;
  }
}

function parseBlacklist(text) {
  return String(text ?? "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

function readRandomWordsPatch($) {
  const pos = {
    noun: $("#rabbit_pos_noun").is(":checked"),
    verb: $("#rabbit_pos_verb").is(":checked"),
    adjective: $("#rabbit_pos_adj").is(":checked"),
    adverb: $("#rabbit_pos_adv").is(":checked"),
  };
  return {
    enabled: $("#rabbit_random_enabled").is(":checked"),
    wordCount: parseInt($("#rabbit_word_count").val(), 10),
    mode: $("#rabbit_mode").val(),
    wordLength: parseInt($("#rabbit_word_length").val(), 10),
    partsOfSpeech: pos,
    themeWords: $("#rabbit_theme_words").val(),
    customPrompt: $("#rabbit_custom_prompt").val(),
    injectionDepth: parseInt($("#rabbit_injection_depth").val(), 10),
    injectionEndRole: $("#rabbit_injection_end_role").val(),
    blacklist: parseBlacklist($("#rabbit_word_blacklist").val()),
    wordHistorySize: parseInt($("#rabbit_history_size").val(), 10),
  };
}

function readSynonymsPatch($) {
  return {
    enabled: $("#rabbit_synonym_enabled").is(":checked"),
    scanDepth: parseInt($("#rabbit_scan_depth").val(), 10),
    minOccurrences: parseInt($("#rabbit_min_occurrences").val(), 10),
    topN: parseInt($("#rabbit_top_n").val(), 10),
    outputMode: $('input[name="rabbit_synonym_output_mode"]:checked').val() || "with-suggestions",
    customPrompt: $("#rabbit_synonym_prompt").val(),
    customPromptRow: $("#rabbit_synonym_prompt_row").val(),
    injectionDepth: parseInt($("#rabbit_synonym_injection_depth").val(), 10),
    injectionEndRole: $("#rabbit_synonym_injection_end_role").val(),
  };
}

function readLanguagePatch($) {
  return $('input[name="rabbit_language"]:checked').val() || "auto";
}

export function renderSettings(container) {
  const settings = loadSettings();
  const merged = {
    ...defaultSettings,
    ...settings,
    randomWords: { ...defaultSettings.randomWords, ...(settings?.randomWords ?? {}) },
    synonyms: { ...defaultSettings.synonyms, ...(settings?.synonyms ?? {}) },
  };
  const html = panelShell(merged);
  if (deps.$) {
    deps.$(container).append(html);
  } else if (container && typeof container.insertAdjacentHTML === "function") {
    container.insertAdjacentHTML("beforeend", html);
  }
  return html;
}

export async function bindEvents(container, onChange) {
  ensureDefaults();
  const $ = deps.$;
  if (!$) {
    deps.warn("Rabbit Response Team: jQuery not available; settings UI not bound.");
    return;
  }

  const root = $(container).find(".rabbit-numeral-container").last();

  const persist = (patch) => {
    try {
      saveSettings(patch);
      if (typeof onChange === "function") onChange(patch);
    } catch (err) {
      deps.warn("Rabbit Response Team: failed to save settings:", err);
    }
  };

  // Main header collapse.
  root.on("click", ".rabbit-header", function () {
    const $h = $(this);
    const expanded = $h.attr("aria-expanded") === "true";
    $h.attr("aria-expanded", String(!expanded));
    $("#rabbit-settings-body").slideToggle(300);
  });

  // Advanced section toggles.
  root.on("click", ".rabbit-advanced-header", function () {
    const $h = $(this);
    const expanded = $h.attr("aria-expanded") === "true";
    $h.attr("aria-expanded", String(!expanded));
    $($h.data("target")).slideToggle(300);
  });

  // Tab switcher.
  root.on("click", ".rabbit-tab-button", function () {
    const tab = $(this).data("tab");
    root.find(".rabbit-tab-button").removeClass("active");
    $(this).addClass("active");
    root.find(".rabbit-tab-content").hide();
    root.find(`#rabbit-tab-${tab}`).show();
  });

  // Live value displays.
  root.on("input", "#rabbit_word_count", function () {
    $("#rabbit_word_count_value").text($(this).val());
  });
  root.on("input", "#rabbit_word_length", function () {
    const v = parseInt($(this).val(), 10);
    $("#rabbit_word_length_value").text(v === 0 ? "Any" : v);
  });

  // Random Words inputs.
  const rwInputs = [
    "#rabbit_random_enabled",
    "#rabbit_word_count",
    "#rabbit_mode",
    "#rabbit_word_length",
    "#rabbit_pos_noun",
    "#rabbit_pos_verb",
    "#rabbit_pos_adj",
    "#rabbit_pos_adv",
    "#rabbit_theme_words",
    "#rabbit_custom_prompt",
    "#rabbit_injection_depth",
    "#rabbit_injection_end_role",
    "#rabbit_word_blacklist",
    "#rabbit_history_size",
  ];
  rwInputs.forEach((sel) => {
    root.on("input change", sel, () => persist({ randomWords: readRandomWordsPatch($) }));
  });

  // Synonyms inputs.
  const synInputs = [
    "#rabbit_synonym_enabled",
    "#rabbit_scan_depth",
    "#rabbit_min_occurrences",
    "#rabbit_top_n",
    'input[name="rabbit_synonym_output_mode"]',
    "#rabbit_synonym_prompt",
    "#rabbit_synonym_prompt_row",
    "#rabbit_synonym_injection_depth",
    "#rabbit_synonym_injection_end_role",
  ];
  synInputs.forEach((sel) => {
    root.on("input change", sel, () => persist({ synonyms: readSynonymsPatch($) }));
  });

  // Language radio.
  root.on("change", 'input[name="rabbit_language"]', () =>
    persist({ language: readLanguagePatch($) }),
  );

  // Reset prompt buttons.
  root.on("click", "#rabbit_reset_prompt", () => {
    $("#rabbit_custom_prompt").val(DEFAULT_RANDOM_PROMPT);
    persist({ randomWords: { ...readRandomWordsPatch($), customPrompt: DEFAULT_RANDOM_PROMPT } });
    if (deps.toastr) deps.toastr.success("Prompt template reset to default", "Rabbit Response Team");
  });

  root.on("click", "#rabbit_synonym_reset_prompt", () => {
    $("#rabbit_synonym_prompt").val(DEFAULT_SYNONYM_PROMPT);
    persist({ synonyms: { ...readSynonymsPatch($), customPrompt: DEFAULT_SYNONYM_PROMPT } });
    if (deps.toastr) deps.toastr.success("Prompt template reset to default", "Rabbit Response Team");
  });

  root.on("click", "#rabbit_synonym_reset_prompt_row", () => {
    $("#rabbit_synonym_prompt_row").val(DEFAULT_SYNONYM_PROMPT_ROW);
    persist({ synonyms: { ...readSynonymsPatch($), customPromptRow: DEFAULT_SYNONYM_PROMPT_ROW } });
    if (deps.toastr) deps.toastr.success("Row template reset to default", "Rabbit Response Team");
  });

  // Test Synonyms button — scans recent assistant messages and surfaces the
  // rendered synonym prompt (or a "no overused words" notice).
  root.on("click", "#rabbit_test_synonyms", async () => {
    try {
      const settings = loadSettings();
      const ctx = deps.getContext?.() ?? { chat: [] };
      const lastUser =
        typeof ctx.lastMessageText === "function"
          ? ctx.lastMessageText()
          : (ctx.chat?.slice().reverse().find((m) => m?.is_user)?.mes ?? "");
      const lang = resolveLanguage(settings.language ?? "auto", lastUser ?? "");
      const chatTexts = (ctx.chat ?? [])
        .filter((m) => m && m.is_user === false)
        .map((m) => m?.mes ?? m?.content ?? "");
      if (deps.toastr) {
        deps.toastr.info(
          `Scanning last ${settings.synonyms.scanDepth} assistant messages…`,
          "Rabbit Response Team",
        );
      }
      if (typeof deps.buildSynonymsPreview !== "function") {
        if (deps.toastr) {
          deps.toastr.error("Engine not wired yet — see src/index.js.", "Rabbit Response Team");
        }
        return;
      }
      const result = await deps.buildSynonymsPreview(settings, lang, chatTexts);
      if (result && result.length > 0) {
        if (deps.toastr) {
          deps.toastr.success(result, "Rabbit Response Team", {
            timeOut: 10000,
            extendedTimeOut: 5000,
          });
        }
      } else if (deps.toastr) {
        deps.toastr.info(
          `No overused words found in the last ${settings.synonyms.scanDepth} assistant messages.`,
          "Rabbit Response Team",
        );
      }
    } catch (err) {
      deps.warn("Rabbit Response Team: test synonyms button failed:", err);
      if (deps.toastr) {
        deps.toastr.error("Test failed — check console.", "Rabbit Response Team");
      }
    }
  });

  // Test Random Words button — wired to the offline engine.
  root.on("click", "#rabbit_test", async () => {
    try {
      const settings = loadSettings();
      const ctx = deps.getContext?.() ?? { chat: [] };
      const lastUser =
        typeof ctx.lastMessageText === "function"
          ? ctx.lastMessageText()
          : (ctx.chat?.slice().reverse().find((m) => m?.is_user)?.mes ?? "");
      const lang = resolveLanguage(settings.language ?? "auto", lastUser ?? "");
      if (deps.toastr) {
        deps.toastr.info(`Sampling ${settings.randomWords.wordCount} words…`, "Rabbit Response Team");
      }
      if (typeof deps.generateWords !== "function") {
        if (deps.toastr) {
          deps.toastr.error("Engine not wired yet — see src/index.js.", "Rabbit Response Team");
        }
        return;
      }
      const words = await deps.generateWords(lang, settings.randomWords, lastUser ?? "");
      if (words && words.length > 0) {
        if (deps.toastr) {
          deps.toastr.success(
            `Random words: ${words.join(", ")}`,
            "Rabbit Response Team",
            { timeOut: 10000 },
          );
        }
      } else if (deps.toastr) {
        deps.toastr.error("Failed to get random words!", "Rabbit Response Team");
      }
    } catch (err) {
      deps.warn("Rabbit Response Team: test button failed:", err);
      if (deps.toastr) {
        deps.toastr.error("Test failed — check console.", "Rabbit Response Team");
      }
    }
  });
}
