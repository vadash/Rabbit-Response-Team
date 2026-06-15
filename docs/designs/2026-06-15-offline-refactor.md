# Design: Offline Refactor & Module Split

**Date:** 2026-06-15
**Status:** Approved (pending review)
**Supersedes:** `docs/offline.md` (which assumed a Node-only `better-sqlite3` runtime that does not apply to browser-loaded SillyTavern extensions)

---

## 1. Goal

Convert Rabbit Response Team from a hybrid online/offline SillyTavern extension into a fully offline extension, and split the current 1683-line `index.js` into a layered module structure. Scope:

- Remove the three external APIs (Heroku, Vercel, Datamuse) and all their configuration.
- Ship bundled JSON assets for random words, synonyms, and associations in English and Russian.
- Support three language modes: **English**, **Russian**, **Auto-detect**.
- Preserve all user-facing features at parity: random word injection (random / double-pass / contextual modes), synonym-overuse scanner, configurable injection depth, custom prompt templates, word history, blacklist.

## 2. Non-Goals

- No definitions in the dataset (current extension does not use them).
- No stemming or lemmatization in synonym lookups.
- No first-letter filter (the Vercel API's `letter` parameter is dropped without replacement).
- No CI pipeline (none exists today; can be added later).
- No bundler for runtime code. No TypeScript.

## 3. Constraints

- **Runtime:** browser-loaded ES module inside SillyTavern's client-side extension host. No Node-only APIs (`fs`, `path`, `__dirname`, native modules). The original `docs/offline.md` plan is invalid for this runtime.
- **Asset size budget:** between 5 MB and 100 MB total. Verified at build time.
- **Single GitHub file limit:** 100 MB. No file in `assets/` may exceed this.
- **Zero runtime npm dependencies.** `package.json` carries only `devDependencies` for the build pipeline.
- **Fail safe.** The extension runs inside SillyTavern's prompt pipeline; no code path may throw an unhandled exception that breaks a user's chat turn.

## 4. Architecture — Approach A: Layered

```
src/
  index.js                  # ST entry, event wiring, init()
  settings.js               # defaults, load/save, migration
  data/
    language.js             # EN/RU/Auto detection + stopwords
    words.js                # word-bank loading, filtering, sampling
    synonyms.js             # synonym + association lookups
  engine/
    random-words.js         # getRandomWords, double-pass, contextual
    synonym-scanner.js      # overuse detector + frequency map
    injector.js             # prompt template rendering, depth placement
  ui/
    panel.js                # settings UI build + event binding
    templates.js            # HTML string templates
  util/
    random.js               # Fisher-Yates, sampling, history bookkeeping
assets/
  en/words.json             # [[word, pos, rank], ...]
  en/synonyms.json          # { word: { s:[...], a:[...] } }
  ru/words.json
  ru/synonyms.json
scripts/
  build_assets.js           # entry — orchestrates pipeline
  verify_assets.js          # postbuild checker
  constants.js              # BUILD{} block
  lib/
    normalize-en.js
    normalize-ru.js
    wordnet-extract.js
    yarn-extract.js
    compact.js
    write-json.js
  raw/                      # gitignored — downloaded datasets
  SHA256SUMS                # pins source versions for reproducibility
manifest.json               # js: "index.js" (root re-export from src/index.js)
index.js                    # root shim: re-exports src/index.js
package.json                # devDependencies only
```

### Dependency rule

**Engine never imports UI. Data never imports engine. UI never imports engine.** Only `src/index.js` and `engine/injector.js` sit at the top of the import graph.

### Import specification

Every inter-file import uses an explicit `.js` extension. Browsers do not resolve extensionless or folder-index imports.

```js
import { resolveLanguage } from './data/language.js';
import { sampleWords }    from './data/words.js';
```

### Asset URL resolution

Asset paths are resolved relative to the running module, not the document base, using `import.meta.url`:

```js
// src/data/words.js
const assetUrl = (lang, file) => new URL(`../../assets/${lang}/${file}`, import.meta.url).href;
```

This makes the extension robust to folder renames and SillyTavern routing changes.

## 5. Data Formats

### 5.1 Word banks — `assets/{lang}/words.json`

Compact nested arrays. Lowercased words. POS codes are single characters: `n | v | a | r` (noun, verb, adjective, adverb). Frequency rank: `1` = most common.

```json
[
  ["apple", "n", 1420],
  ["running", "v", 5120],
  ["serendipity", "n", 38412]
]
```

Loaded once per language, filtered/sampled in memory.

### 5.2 Synonyms + associations — `assets/{lang}/synonyms.json`

Object keyed by word. Each entry has up to N synonyms (`s`) and N associations (`a`). Only the top `SYNONYMS_TOP_N` most-frequent words per language appear as keys.

```json
{
  "apple":   { "s": ["fruit", "pome"],          "a": ["orchard", "tree", "harvest"] },
  "running": { "s": ["jogging", "sprinting"],   "a": ["race", "marathon", "track"] }
}
```

Lookups are direct property access: `data[word]?.s ?? []`.

### 5.3 Stopwords

EN and RU stopwords live in `src/data/language.js` as `Set<string>` constants. Not JSON — small, code-local, owned by the only consumer (the synonym scanner).

### 5.4 Build-time constants

```js
// scripts/constants.js
export const BUILD = {
  WORDS_TOP_N:              30_000,
  SYNONYMS_TOP_N:           20_000,   // must be ≤ WORDS_TOP_N
  SYNONYMS_PER_WORD:        8,
  ASSOCIATIONS_PER_WORD:    12,

  ASSETS_MIN_SIZE_BYTES:    5  * 1024 * 1024,   // 5 MB floor
  ASSETS_MAX_SIZE_BYTES:    100 * 1024 * 1024,  // 100 MB ceiling (GitHub single-file headroom)

  DOUBLE_PASS_ANCHOR_RETRIES: 10,   // bounds sampling when looking for an anchor with associations
};
```

Estimated total at these values: ~31 MB for both languages combined.

## 6. Language Detection

Three modes, configured via `settings.language`: `'en'`, `'ru'`, `'auto'`.

### Algorithm

Plain regex test on the most recent user message. No libraries, no n-gram statistical detection.

```js
const CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN    = /[a-zÀ-ɏ]/gi;

export function detectLanguage(text) {
  const lower = text.toLowerCase();
  const cyrillic = (lower.match(CYRILLIC) || []).length;
  const latin    = (lower.match(LATIN) || []).length;
  if (cyrillic === 0 && latin === 0) return null;
  return cyrillic > latin ? 'ru' : 'en';
}

export function resolveLanguage(setting, userMessage) {
  if (setting === 'auto') {
    return detectLanguage(userMessage) ?? 'en';
  }
  return setting;
}
```

### Decisions

- **Counting, not `.test()`.** Mixed-script messages are common ("ugh, same here — да блин опять"). Counting both scripts picks the dominant one rather than flipping on a single stray word.
- **Tie or empty → English.** Matches the current extension's implicit default.
- **Latest message only.** No chat-history scan, no sticky lookback. Simpler behavior, occasional wrong-language injection on emoji-only / sticker / short replies is accepted as a known trade-off.

## 7. Settings Schema & Migration

### 7.1 New schema

Single namespace `extension_settings.rabbitResponseTeam` with `schemaVersion: 1`.

```js
const defaultSettings = {
  schemaVersion: 1,
  randomWords: {
    enabled: false,
    wordCount: 3,
    customPrompt: DEFAULT_RANDOM_PROMPT,
    injectionDepth: 0,
    injectionEndRole: 'system',
    wordLength: 0,
    partsOfSpeech: { noun: true, verb: true, adjective: true, adverb: false },
    mode: 'random',           // 'random' | 'double-pass' | 'contextual'
    wordHistorySize: 50,
    blacklist: [],
    themeWords: '',
  },
  synonyms: {
    enabled: false,
    scanDepth: 6,
    minOccurrences: 3,
    customPrompt: DEFAULT_SYNONYM_PROMPT,
  },
  language: 'auto',
};
```

### 7.2 Removed fields

| Removed | Reason |
|---|---|
| `randomWords.useAPI` | APIs removed |
| `randomWords.apiProvider` | APIs removed |
| `randomWords.fallbackToGenerated` | Always offline |
| `randomWords.language` (Heroku 2-letter) | Replaced by top-level `language` |
| `randomWords.vercelFirstLetter`, `alphabetize` | Vercel API removed |
| `randomWords.partOfSpeechNoun/Verb/Adj/Adv` | Folded into `partsOfSpeech` object |
| `randomWords.datamuseMode`, `relationshipType`, `datamuseFirstLetter` | Datamuse removed; `mode` covers it |

### 7.3 Migration

`settings.js → migrate()` reads legacy `extension_settings.randomWords` and `extension_settings.synonyms`, maps surviving fields, deletes the legacy keys, writes the new shape under `extension_settings.rabbitResponseTeam`.

Mode mapping:

```js
function mapOldMode(rw) {
  if (rw.apiProvider === 'datamuse' && rw.datamuseMode === 'contextual') return 'contextual';
  if (rw.doublePass)  return 'double-pass';
  if (rw.contextualMode) return 'contextual';
  return 'random';
}
```

Edge cases:

- Both `doublePass` and `contextualMode` true → `contextual` wins, `console.warn`.
- Fresh install (no legacy keys) → returns `defaultSettings` unchanged.
- Unparseable stored settings → fall back to `defaultSettings`, preserve raw under `extension_settings.rabbitResponseTeam.__corruptedBackup`, warn.

## 8. Module Interfaces

### `src/index.js`
```
imports: settings.js, engine/injector.js, ui/panel.js, ST globals
exports: none
- registers CHAT_COMPLETION_PROMPT_READY → engine/injector.onPromptReady
- renders settings UI via ST Extensions API
- init(): loads required asset bundles (lazy, see §9.2)
```

### `src/settings.js`
```
exports:
  - defaultSettings
  - loadSettings(): Settings
  - saveSettings(patch): void
  - migrate(raw): Settings
```

### `src/data/language.js`
```
exports:
  - detectLanguage(text): 'en' | 'ru' | null
  - resolveLanguage(setting, userMessage): 'en' | 'ru'
  - STOPWORDS_EN: Set<string>
  - STOPWORDS_RU: Set<string>
```

### `src/data/words.js`
```
imports: assets/en/words.json, assets/ru/words.json (lazy)
exports:
  - ensureWordBankLoaded(lang): Promise<void>
  - getWordBank(lang): Array<[word, pos, rank]>
  - sampleWords(lang, opts): string[]
      opts = { count, pos?: string[], minRank, maxRank,
               wordLength?, blacklist: Set<string>, history: Set<string> }
  - getWordMeta(lang, word): { pos, rank } | null
```

### `src/data/synonyms.js`
```
imports: assets/en/synonyms.json, assets/ru/synonyms.json (lazy)
exports:
  - ensureSynonymsLoaded(lang): Promise<void>
  - getSynonyms(lang, word): string[]
  - getAssociations(lang, word): string[]
  - hasEntry(lang, word): boolean
```

### `src/util/random.js`
```
exports:
  - shuffleInPlace(arr): arr
  - sampleWithoutReplacement(pool, n, exclude: Set): string[]
  - pushUniqueHistory(history: string[], word, maxSize): string[]
```

### `src/engine/injector.js`
```
imports: settings.js, data/language.js,
         engine/random-words.js, engine/synonym-scanner.js
exports:
  - onPromptReady(promptData): promptData
- resolves language for current chat
- dispatches to random-words engine if enabled
- dispatches to synonym-scanner if enabled
- applies injectionDepth / injectionEndRole
- renders template, splices into prompt
```

### `src/engine/random-words.js`
```
imports: data/words.js, data/synonyms.js, util/random.js
exports:
  - generateWords(lang, settings, userMessage): string[]
- modes: 'random' | 'double-pass' | 'contextual'
```

Mode semantics:

- **random:** `sampleWords()` with filters (POS, length, rank, blacklist, history).
- **double-pass:** sample anchors until one satisfies `hasEntry(lang, anchor) === true` (capped at `DOUBLE_PASS_ANCHOR_RETRIES` attempts). Pull `associations` for the anchor. Fill remaining slots from associations, fall back to `sampleWords()` if associations are insufficient.
- **contextual:** tokenize last user message, drop stopwords, sort by frequency rank descending. Walk candidate keywords until one satisfies `hasEntry(lang, word) === true`. Pull associations. If no candidate has an entry, fall back to `random` mode and `console.warn` once.

### `src/engine/synonym-scanner.js`
```
imports: data/language.js, data/synonyms.js
exports:
  - findOverusedWords(chatHistory, lang, settings): Array<{word, count, suggestions}>
- tokenize last scanDepth messages
- drop stopwords
- build frequency map
- return entries where count ≥ minOccurrences AND hasEntry(lang, word) === true
```

### `src/ui/panel.js`
```
imports: settings.js, ui/templates.js, ST globals (toastr)
exports:
  - renderSettings(container): void
  - bindEvents(container, onChange): void
```

### `src/ui/templates.js`
```
exports: HTML-string functions
  - randomWordsSection(settings): string
  - synonymsSection(settings): string
  - languageRadio(settings): string
```

## 9. Runtime Behavior

### 9.1 Initialization

`src/index.js → init()` runs on extension activation:

1. Load + migrate settings via `settings.js`.
2. Render the settings UI panel.
3. Register `CHAT_COMPLETION_PROMPT_READY` listener → `engine/injector.onPromptReady`.
4. Asset loading is **lazy** — do nothing at boot.

### 9.2 Lazy + per-language asset loading

Asset bundles are fetched on first use, not at boot:

- Forced `en` or `ru`: load that language's `words.json` and `synonyms.json` on the first chat turn that has the corresponding feature enabled.
- `auto`: load both languages on the first chat turn (one-time latency, cache hits afterward).
- Feature disabled: never load that feature's data.
- Cached at module scope after first load.

### 9.3 Failure modes

| Failure | Behavior |
|---|---|
| Asset fetch fails (404, network) | `init()` catches, `toastr.error` once, marks extension degraded. Injection no-ops. UI shows a "Data not loaded" banner. |
| Word bank parses but empty | Same as above. |
| `sampleWords()` can't satisfy `count` after filters | Returns what it could (including 0). Injector skips injection that turn. No toastr. |
| `getSynonyms()` / `getAssociations()` miss | Returns `[]`. Engine skips word silently. Normal path. |
| `migrate()` sees unparseable settings | Falls back to defaults, preserves raw under `__corruptedBackup`, warns. |
| Template rendering throws (broken `{{` in custom prompt) | Caught in `injector.js`, logged, turn skips injection. UI shows red border on broken field on save. |

## 10. Build Pipeline

### 10.1 Inputs

| Source | Used for | License |
|---|---|---|
| Datamuse wordfreq or Google Ngram top-N | EN word frequency ranks | MIT / public |
| `wordnet-db` (npm) | EN synonyms (synsets) + associations (hypernyms / hyponyms) | WordNet license |
| [Badestrand Russian Dictionary](https://github.com/Badestrand/russian-dictionary) | RU word list with POS + frequency | MIT |
| [YARN](https://github.com/napolnaya/YARN) | RU synonyms + associations | MIT |

Raw files live in `scripts/raw/` (gitignored). `scripts/SHA256SUMS` pins source versions.

### 10.2 Pipeline (per language)

1. Load raw frequency list → normalize to `[word, pos, rank]` tuples.
2. Filter: lowercase only; reject non-script characters; reject words shorter than 2 or longer than 20; dedupe (keep lowest rank).
3. Sort by rank, take `WORDS_TOP_N`.
4. Write `assets/{lang}/words.json`.
5. Load synonym source (`wordnet-db` for EN; YARN JSON for RU).
6. For each word in the trimmed word bank (up to `SYNONYMS_TOP_N`):
   - collect synonyms (cap `SYNONYMS_PER_WORD`)
   - collect associations (cap `ASSOCIATIONS_PER_WORD`)
   - skip words with neither
7. Write `assets/{lang}/synonyms.json`.

### 10.3 Verification — `scripts/verify_assets.js`

Runs as a postbuild hook (`npm run build` chains build → verify). Exits nonzero on any failure:

- Both languages have `words.json` and `synonyms.json`.
- `words.json` has `WORDS_TOP_N` entries (or fewer with a warning if source was smaller).
- Every key in `synonyms.json` also exists in `words.json`.
- No duplicates within a word bank.
- Total `assets/` size is within `[ASSETS_MIN_SIZE_BYTES, ASSETS_MAX_SIZE_BYTES]`.
- No single file exceeds 100 MB.
- Smoke check: 10 random words, assert each has the expected tuple shape.

### 10.4 Regeneration cadence

WordNet / YARN update infrequently. Rebuild once per major source-data update. README documents the procedure.

## 11. Testing Strategy

### 11.1 Unit tests — `node:test` + `node:assert` (Node 18+)

```
tests/
  data/
    language.test.js       # mixed script, empty, all-emoji, ties
    words.test.js          # filter combinations, history exclusion, blacklist
    synonyms.test.js       # missing-word returns [], cap enforcement
  engine/
    random-words.test.js   # three modes; double-pass anchor has entry; contextual fallback
    synonym-scanner.test.js# frequency map, stopword exclusion, minOccurrences threshold
    injector.test.js       # depth/end-role placement, template rendering, prompt mutation
  settings.test.js         # migrate() — every removed/renamed field, every edge case
  fixtures/
    mini-en-words.json
    mini-en-synonyms.json
    mini-ru-words.json
    mini-ru-synonyms.json
```

`npm test` runs the suite. No pre-commit hook today; optional to add later.

Coverage targets: `data/` and `settings.js` near 100% (pure functions). `engine/` covers each mode's main paths and fallbacks. `ui/` is not unit-tested.

### 11.2 Manual release checklist

1. Fresh install in a clean ST profile → defaults load.
2. Migrate an old profile with API settings → no orphan keys, no errors.
3. EN chat → random words appear at depth 0 and depth 3.
4. RU chat → Russian words only.
5. Mixed-script chat with `language: 'auto'` → correct pick.
6. Each mode (random / double-pass / contextual) → expected output shape.
7. Synonym scanner: repeat a word 4× → suggestion appears.
8. Blacklist a word → never appears.
9. Break the assets → reload → degraded banner, no console crash.
10. `npm run build` end-to-end → size bounds pass, verifier passes.

### 11.3 Not covered

- Word bank quality (rank accuracy depends on source data).
- Browser DOM behavior — manual testing only.
- Performance under large chat histories — relies on O(message length) scanning being fast enough at browser scale, verified by feel during release testing.

## 12. References

- `docs/offline.md` — original research; superseded by this design due to incorrect runtime assumptions.
- `AGENTS.md` — current architecture summary.
- `index.js` — current 1683-line implementation; will be split per §4.
