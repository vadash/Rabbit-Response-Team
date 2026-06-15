// Random-words engine — three modes (random / double-pass / contextual).
// Per design §8 Mode semantics. Depends on data/words.js, data/synonyms.js,
// util/random.js. The data modules are injected via opts so tests can stub
// them without touching real assets.

import { BUILD } from "../../scripts/constants.js";
import { STOPWORDS_EN, STOPWORDS_RU } from "../data/language.js";
import {
  sampleWithoutReplacement,
  shuffleInPlace,
} from "../util/random.js";

// Default to the real data modules. Tests pass stubs via opts.
let defaultWordsModule = null;
let defaultSynonymsModule = null;

async function loadDefaults() {
  if (!defaultWordsModule) {
    const w = await import("../data/words.js");
    defaultWordsModule = w;
  }
  if (!defaultSynonymsModule) {
    const s = await import("../data/synonyms.js");
    defaultSynonymsModule = s;
  }
  return { words: defaultWordsModule, synonyms: defaultSynonymsModule };
}

function posList(partsOfSpeech) {
  if (!partsOfSpeech) return undefined;
  const out = [];
  if (partsOfSpeech.noun) out.push("n");
  if (partsOfSpeech.verb) out.push("v");
  if (partsOfSpeech.adjective) out.push("a");
  if (partsOfSpeech.adverb) out.push("r");
  return out;
}

function baseSampleOpts(settings, history) {
  const rw = settings.randomWords ?? settings;
  const blacklist = new Set(Array.isArray(rw.blacklist) ? rw.blacklist : []);
  return {
    count: rw.wordCount ?? 0,
    pos: posList(rw.partsOfSpeech),
    wordLength: rw.wordLength ?? 0,
    blacklist,
    history: history ?? new Set(),
  };
}

function tokenize(text, lang) {
  if (typeof text !== "string" || text.length === 0) return [];
  const lower = text.toLowerCase();
  // Split on anything that isn't a letter (Latin or Cyrillic).
  const tokens = lower.split(/[^a-zа-яё]+/i).filter(Boolean);
  const stop = lang === "ru" ? STOPWORDS_RU : STOPWORDS_EN;
  return tokens.filter((t) => !stop.has(t));
}

function runRandom(words, lang, settings, history) {
  const opts = baseSampleOpts(settings, history);
  return words.sampleWords(lang, opts);
}

function runDoublePass(words, synonyms, lang, settings, history) {
  const rw = settings.randomWords ?? settings;
  const wordCount = rw.wordCount ?? 0;
  if (wordCount <= 0) return [];

  const baseOpts = baseSampleOpts(settings, history);

  let anchor = null;
  for (let i = 0; i < BUILD.DOUBLE_PASS_ANCHOR_RETRIES; i++) {
    const candidate = words.sampleWords(lang, { ...baseOpts, count: 1 });
    if (candidate.length === 0) break;
    if (synonyms.hasEntry(lang, candidate[0])) {
      anchor = candidate[0];
      break;
    }
  }

  // No anchor with an entry found — fall back to plain random for all slots.
  if (!anchor) {
    return words.sampleWords(lang, baseOpts);
  }

  // Build result: anchor first, then associations (filtered), then fill
  // remainder with plain random sampling.
  const result = [anchor];
  const used = new Set([anchor]);
  const blacklist = baseOpts.blacklist;
  const assocAll = synonyms.getAssociations(lang, anchor);
  const assocEligible = assocAll.filter(
    (w) => !used.has(w) && !blacklist.has(w) && !(history ?? new Set()).has(w)
  );

  const remaining = wordCount - 1;
  if (remaining > 0 && assocEligible.length > 0) {
    shuffleInPlace(assocEligible);
    const picks = assocEligible.slice(0, remaining);
    for (const w of picks) {
      result.push(w);
      used.add(w);
    }
  }

  // Still need more — fill from sampleWords excluding what we already used.
  const stillNeed = wordCount - result.length;
  if (stillNeed > 0) {
    const fill = words.sampleWords(lang, {
      ...baseOpts,
      count: stillNeed,
      history: new Set([...(history ?? []), ...used]),
    });
    for (const w of fill) result.push(w);
  }

  return result;
}

function runContextual(words, synonyms, lang, settings, userMessage, history, warn) {
  const rw = settings.randomWords ?? settings;
  const wordCount = rw.wordCount ?? 0;
  if (wordCount <= 0) return [];

  const tokens = tokenize(userMessage, lang);

  // Rank each candidate by its bank rank (lower rank = more frequent).
  // Words not in the bank are dropped.
  const ranked = [];
  const seen = new Set();
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    const meta = words.getWordMeta(lang, t);
    if (!meta) continue;
    ranked.push({ word: t, rank: meta.rank });
  }
  ranked.sort((a, b) => a.rank - b.rank);

  // Walk by ascending rank (most frequent first); pick the first with an entry.
  let chosen = null;
  for (const c of ranked) {
    if (synonyms.hasEntry(lang, c.word)) {
      chosen = c.word;
      break;
    }
  }

  if (!chosen) {
    warn(
      "Rabbit Response Team: no keyword with synonym data found; falling back to random mode."
    );
    return runRandom(words, lang, settings, history);
  }

  const blacklist = new Set(Array.isArray(rw.blacklist) ? rw.blacklist : []);
  const historySet = history ?? new Set();
  const assocAll = synonyms.getAssociations(lang, chosen);
  const eligible = assocAll.filter(
    (w) => !blacklist.has(w) && !historySet.has(w)
  );

  // Use sampleWithoutReplacement so we get unbiased picks when we have more
  // associations than slots.
  const picks = sampleWithoutReplacement(eligible, wordCount, new Set());
  return picks;
}

/**
 * Generate a list of random words for injection.
 *
 * @param {"en"|"ru"} lang
 * @param {object} settings  Full settings object (uses .randomWords subtree).
 * @param {string} userMessage  Latest user message (contextual mode only).
 * @param {object} [opts]  Optional overrides: { words, synonyms, history, warn }
 * @returns {Promise<string[]> | string[]}  Word list. Empty array on miss/failure.
 */
export function generateWords(lang, settings, userMessage, opts = {}) {
  const handler = (words, synonyms) => {
    const mode = (settings.randomWords ?? settings).mode ?? "random";
    const history = opts.history ?? new Set();
    const warn = opts.warn ?? console.warn?.bind(console) ?? (() => {});

    try {
      switch (mode) {
        case "double-pass":
          return runDoublePass(words, synonyms, lang, settings, history);
        case "contextual":
          return runContextual(
            words,
            synonyms,
            lang,
            settings,
            userMessage,
            history,
            warn
          );
        case "random":
        default:
          return runRandom(words, lang, settings, history);
      }
    } catch (err) {
      console.warn("Rabbit Response Team: generateWords failed:", err);
      return [];
    }
  };

  if (opts.words && opts.synonyms) {
    return handler(opts.words, opts.synonyms);
  }

  // No stubs supplied — use real data modules. The caller is expected to have
  // already invoked ensureWordBankLoaded/ensureSynonymsLoaded; we don't await
  // here to keep the function synchronous for the stubbed path.
  // Return a promise for the unstumped path.
  return loadDefaults().then(({ words, synonyms }) =>
    handler(words, synonyms)
  );
}
