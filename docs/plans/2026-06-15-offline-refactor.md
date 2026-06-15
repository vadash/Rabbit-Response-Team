# Offline Refactor Implementation Plan

**Goal:** Convert Rabbit Response Team from a hybrid online/offline extension into a fully offline, layered-module extension with bundled JSON word banks and synonym/association data for English and Russian, plus EN/RU/Auto language modes.

**Design document:** `docs/designs/2026-06-15-offline-refactor.md` — read it before starting any task.

**Testing conventions:** No test infrastructure exists today. This plan introduces `node:test` + `node:assert` (built into Node 18+). Tests live under `tests/` with fixtures under `tests/fixtures/`. Pure-function layers (`data/`, `engine/`, `settings.js`) are unit-tested. UI is manual-only. Each TDD task follows red-green: write failing test → implement → verify pass → commit.

**Execution agent context:** Each task is self-contained. Always read the design doc §4 (file structure), §5 (data formats), §8 (module interfaces) before implementing. Use explicit `.js` extensions in every import. No bundler. No TypeScript.

---

### Task 1: Build pipeline constants and verifier

**Objective:** Establish the `scripts/` directory, the `BUILD{}` constants block, and a verifier that will be used to validate all future asset output. The verifier is written first so subsequent build tasks have a green test to target.

**Files to modify/create:**
- Create: `package.json` (Purpose: declare `private: true`, `type: "module"`, scripts `build` → `node scripts/build_assets.js`, `verify` → `node scripts/verify_assets.js`, `test` → `node --test tests/`. devDependencies: `wordnet-db`. No runtime deps.)
- Create: `scripts/constants.js` (Purpose: export `BUILD{}` per design §5.4 — `WORDS_TOP_N`, `SYNONYMS_TOP_N`, `SYNONYMS_PER_WORD`, `ASSOCIATIONS_PER_WORD`, `ASSETS_MIN_SIZE_BYTES`, `ASSETS_MAX_SIZE_BYTES`, `DOUBLE_PASS_ANCHOR_RETRIES`.)
- Create: `scripts/verify_assets.js` (Purpose: postbuild checker per design §10.3. Reads `assets/{en,ru}/words.json` and `synonyms.json`, asserts all rules. Exits nonzero on failure.)
- Create: `.gitignore` additions (Purpose: ignore `scripts/raw/`, `node_modules/`. Do NOT ignore `assets/`, `scripts/SHA256SUMS`.)
- Create: `tests/fixtures/.gitkeep` (Purpose: establish fixtures directory.)

**Instructions for Execution Agent:**
1. **Context Setup:** Read design doc §5.4 (constants), §10.3 (verifier rules), §10.4 (regeneration). Create the directory structure.
2. **Write Failing Test:** Create `tests/scripts/verify_assets.test.js`. Test cases: (a) missing `assets/` dir → returns failure; (b) empty word bank → failure; (c) word count mismatch → failure with warning if source smaller, failure if zero; (d) synonym key missing from words → failure; (e) duplicate word in bank → failure; (f) total size below `ASSETS_MIN_SIZE_BYTES` → failure; (g) total size above `ASSETS_MAX_SIZE_BYTES` → failure; (h) clean synthetic assets under `tests/fixtures/` → passes. Run `npm test` to confirm failure (verifier doesn't exist yet).
3. **Implement Minimal Code:** Write `scripts/constants.js` and `scripts/verify_assets.js`. Export a `verify(assetsDir)` function returning `{ ok: boolean, errors: string[], warnings: string[], totalBytes: number }`. The CLI entry point calls `verify()` and exits with code 1 on `!ok`.
4. **Verify:** Run `npm test`. All verifier tests pass.
5. **Commit:** `feat(scripts): add build constants and asset verifier`

---

### Task 2: Build pipeline — compact and normalize utilities

**Objective:** Pure-function helpers for the build pipeline. These transform raw input streams into the tuple shape and enforce caps. TDD-friendly because they have no I/O.

**Files to modify/create:**
- Create: `scripts/lib/compact.js` (Purpose: exports `lowercaseWord(w)`, `rejectNonScript(w)` — Latin or Cyrillic only, no digits/punctuation; `rejectByLength(w, min=2, max=20)`; `dedupeKeepLowestRank(tuples)`; `capList(arr, n)`.)
- Create: `scripts/lib/normalize-en.js` (Purpose: exports `normalizeEn(rawRows)` → array of `[word, pos, rank]` tuples. POS codes mapped from source tags to `n|v|a|r`; unknown POS dropped. Returns filtered + deduped tuples.)
- Create: `scripts/lib/normalize-ru.js` (Purpose: exports `normalizeRu(rawRows)` → same shape. Badestrand POS strings map to `n|v|a|r`.)
- Test: `tests/scripts/compact.test.js`
- Test: `tests/scripts/normalize-en.test.js`
- Test: `tests/scripts/normalize-ru.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §5.1 (word bank tuple shape), §5.4 (caps), §10.2 steps 1–3.
2. **Write Failing Tests:** Cover: lowercase normalization; rejection of words with digits, mixed scripts, or out-of-range length; dedupe keeps the lowest rank; POS mapping for at least noun/verb/adjective/adverb in both languages; unknown POS dropped without throwing; `capList` truncates to N and returns empty if input empty.
3. **Implement Minimal Code:** Pure functions only. No `fs`, no `fetch`. Each function returns a new array; no in-place mutation of inputs.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(scripts): add compact and normalize utilities`

---

### Task 3: Build pipeline — WordNet and YARN extractors

**Objective:** Extract synonyms (synset members) and associations (hypernyms/hyponyms for EN; related entries for RU) from raw sources into the `{ s:[], a:[] }` shape.

**Files to modify/create:**
- Create: `scripts/lib/wordnet-extract.js` (Purpose: imports `wordnet-db` npm package; exports `extractEnSynonyms(word)` → `{ s: string[], a: string[] }`. Uses synset membership for synonyms, hypernyms + hyponyms for associations. Caps via `BUILD.SYNONYMS_PER_WORD` and `BUILD.ASSOCIATIONS_PER_WORD`.)
- Create: `scripts/lib/yarn-extract.js` (Purpose: parses YARN JSON from `scripts/raw/`; exports `extractRuSynonyms(word)` → same shape. YARN's "synsets" and "relations" map to synonyms and associations respectively.)
- Test: `tests/scripts/wordnet-extract.test.js`
- Test: `tests/scripts/yarn-extract.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §5.2 (synonyms shape), §10.1 (sources). Run `npm install` to fetch `wordnet-db`. For test fixtures, create miniature YARN-shaped JSON under `tests/fixtures/` rather than committing the full YARN dump.
2. **Write Failing Tests:** Cover: known word returns expected synonym/association arrays; unknown word returns `{ s: [], a: [] }`; caps enforced (input list longer than cap is truncated); lowercase output.
3. **Implement Minimal Code:** `wordnet-db` exposes a static dataset — access via require/import. YARN parsing reads JSON from a path passed as argument (testability).
4. **Verify:** `npm test` passes. Run a one-off manual check that `wordnet-db` loads correctly on this machine.
5. **Commit:** `feat(scripts): add WordNet and YARN extractors`

---

### Task 4: Build pipeline — orchestrator and first asset generation

**Objective:** Wire the helpers from Tasks 2–3 into `scripts/build_assets.js`, generate the first `assets/{en,ru}/{words,synonyms}.json`, and verify they pass the verifier from Task 1. This task requires the developer to download raw sources manually (documented in `scripts/raw/README.md`).

**Files to modify/create:**
- Create: `scripts/lib/write-json.js` (Purpose: exports `writeJsonAtomic(path, data)` — writes to a temp file then renames, so interrupted builds don't leave half-written JSON.)
- Create: `scripts/build_assets.js` (Purpose: orchestrator per design §10.2. Reads raw sources, runs normalize, writes `words.json`, runs extractors, writes `synonyms.json`.)
- Create: `scripts/raw/README.md` (Purpose: documents where to download each raw source, expected filename, and SHA256 to record in `scripts/SHA256SUMS`.)
- Create: `scripts/SHA256SUMS` (Purpose: empty placeholder; the developer fills it in after downloading raw sources.)
- Generated: `assets/en/words.json`, `assets/en/synonyms.json`, `assets/ru/words.json`, `assets/ru/synonyms.json` (Purpose: committed artifacts.)
- Modify: `package.json` — `build` script becomes `node scripts/build_assets.js && node scripts/verify_assets.js`.

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §10 in full. This task is the integration point of Tasks 1–3.
2. **No TDD Red Step Here:** The verifier from Task 1 IS the integration test. Run it against the empty `assets/` directory first to confirm it fails.
3. **Implement:** Write the orchestrator. Add an assertion that `SYNONYMS_TOP_N ≤ WORDS_TOP_N` at startup. Stream large JSON to disk rather than building in memory when possible.
4. **Generate Assets:** The developer (you, the human) must download raw sources per `scripts/raw/README.md`. Then run `npm run build`. Capture SHA256 of each source in `scripts/SHA256SUMS`.
5. **Verify:** `npm run build` completes; verifier passes; total `assets/` size is within `[5 MB, 100 MB]` and prints actual size.
6. **Commit:** `feat(scripts): add build orchestrator and generated assets` — commit both scripts and generated JSON.

---

### Task 5: Runtime — language detection module

**Objective:** First runtime module. Pure functions, fully TDD-friendly. Becomes the foundation for everything that needs language context.

**Files to modify/create:**
- Create: `src/data/language.js` (Purpose: exports `detectLanguage(text)`, `resolveLanguage(setting, userMessage)`, `STOPWORDS_EN`, `STOPWORDS_RU` per design §6 and §5.3.)
- Test: `tests/data/language.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §6 (full algorithm + decisions), §5.3 (stopwords location).
2. **Write Failing Tests:** Cover: pure English → `'en'`; pure Russian → `'ru'`; mixed script with more Cyrillic → `'ru'`; mixed with more Latin → `'en'`; tie → `'en'`; empty string → `null`; all-emoji/numeric → `null`; single stray Cyrillic word in English message → `'en'` (count-based, not test-based). For `resolveLanguage`: forced `'en'`/`'ru'` ignores message; `'auto'` with `null` detection → `'en'`. Stopword sets: assert `'the'` ∈ EN, `'и'` ∈ RU, and that RU set has no duplicates (the original review caught a duplicate `мне` — do not regress).
3. **Implement Minimal Code:** Use the regex `/[Ѐ-ӿ]/g` for Cyrillic, `/[a-zÀ-ɏ]/gi` for Latin. Count matches, compare, return. Stopwords are plain `Set<string>` literals.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(data): add language detection and stopwords`

---

### Task 6: Runtime — random utilities

**Objective:** Pure-function sampling and history helpers used by `engine/random-words.js`.

**Files to modify/create:**
- Create: `src/util/random.js` (Purpose: exports `shuffleInPlace(arr)`, `sampleWithoutReplacement(pool, n, exclude)`, `pushUniqueHistory(history, word, maxSize)` per design §8.)
- Test: `tests/util/random.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §8 entry for `src/util/random.js`.
2. **Write Failing Tests:** Cover: `shuffleInPlace` returns the same array reference, same elements, possibly different order; for a deterministic seed or stubbed `Math.random`, returns expected order. `sampleWithoutReplacement` returns `n` unique elements when pool is large enough; returns fewer (or zero) when pool is small; respects `exclude` set; never returns duplicates. `pushUniqueHistory` adds new word to front, caps at `maxSize`, drops oldest past cap; ignores words already in history (no-op, no duplicate).
3. **Implement Minimal Code:** Fisher-Yates for shuffle. Pure functions; no I/O. Tests may stub `Math.random` for determinism.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(util): add random sampling and history helpers`

---

### Task 7: Runtime — word bank data module

**Objective:** First module that touches bundled assets. Provides filtering and sampling over the word bank.

**Files to modify/create:**
- Create: `src/data/words.js` (Purpose: exports `ensureWordBankLoaded(lang)`, `getWordBank(lang)`, `sampleWords(lang, opts)`, `getWordMeta(lang, word)` per design §8. Uses `import.meta.url` to resolve asset URLs per design §4 (Asset URL resolution). Lazy fetch + cache per design §9.2.)
- Create: `tests/fixtures/mini-en-words.json` (Purpose: 50-word toy bank for deterministic tests.)
- Create: `tests/fixtures/mini-ru-words.json`
- Test: `tests/data/words.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §4 (asset URL resolution via `import.meta.url`), §5.1 (word bank shape), §8 (`words.js` exports), §9.2 (lazy loading).
2. **Write Failing Tests:** Cover: `sampleWords` with no filters returns `count` items; POS filter excludes non-matching; rank filter excludes out-of-range; `wordLength` filter excludes wrong lengths; `blacklist` set excludes listed words; `history` set excludes listed words; insufficient pool returns fewer items without throwing; `getWordMeta` returns `{pos, rank}` for known word, `null` for unknown. Inject the fixture path via dependency injection or stubbed `import.meta.url` — do NOT fetch real assets in unit tests.
3. **Implement Minimal Code:** Module-scope cache `{ en: null, ru: null }`. `ensureWordBankLoaded` fetches via `fetch(new URL(...))`, parses, caches. `sampleWords` filters in memory; uses `shuffleInPlace` from `util/random.js` to pick. Accept an injectable fetcher for tests.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(data): add word bank loading and sampling`

---

### Task 8: Runtime — synonyms data module

**Objective:** Direct-lookup accessor for synonyms/associations. Trivial logic, but tested for the miss-case behavior the engine relies on.

**Files to modify/create:**
- Create: `src/data/synonyms.js` (Purpose: exports `ensureSynonymsLoaded(lang)`, `getSynonyms(lang, word)`, `getAssociations(lang, word)`, `hasEntry(lang, word)` per design §8.)
- Create: `tests/fixtures/mini-en-synonyms.json`
- Create: `tests/fixtures/mini-ru-synonyms.json`
- Test: `tests/data/synonyms.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §5.2, §8 (`synonyms.js` exports), §9.2 (lazy loading).
2. **Write Failing Tests:** Cover: known word with both fields → returns expected arrays; known word with only `s` → `getAssociations` returns `[]`; unknown word → all accessors return `[]` / `false`; `hasEntry` returns `true`/`false` correctly; cap enforcement from build is assumed (not re-tested here).
3. **Implement Minimal Code:** Same lazy-fetch + cache pattern as Task 7. Direct property access: `data[word]?.s ?? []`.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(data): add synonym and association lookups`

---

### Task 9: Runtime — settings module with migration

**Objective:** Replace the current `loadSettings()` (in old `index.js:128`) and `saveSettings()` (`index.js:262`) with a clean, tested module. Migration logic is the riskiest part — every legacy shape needs a test.

**Files to modify/create:**
- Create: `src/settings.js` (Purpose: exports `defaultSettings`, `loadSettings()`, `saveSettings(patch)`, `migrate(raw)` per design §7. Includes `DEFAULT_RANDOM_PROMPT` and `DEFAULT_SYNONYM_PROMPT` constants, copied verbatim from current `index.js:45-47`.)
- Test: `tests/settings.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §7 in full. Read current `index.js:45-127` for the prompt templates and the legacy default settings to migrate from.
2. **Write Failing Tests:** Cover migration: (a) fresh install (no legacy keys) → returns `defaultSettings` unchanged; (b) old `randomWords.apiProvider='datamuse'` + `datamuseMode='contextual'` → `mode: 'contextual'`; (c) old `randomWords.doublePass=true` → `mode: 'double-pass'`; (d) both `doublePass` and `contextualMode` true → `mode: 'contextual'` and `console.warn` called; (e) old `partOfSpeechNoun=false` → `partsOfSpeech.noun: false`; (f) legacy `language: 'en'` → top-level `language: 'en'`; (g) no legacy language → top-level `language: 'auto'`; (h) unparseable JSON in storage → falls back to defaults, stashes raw under `__corruptedBackup`, warns. Also: `saveSettings` deep-merges patches without overwriting siblings; resulting `schemaVersion` is `1`; legacy `extension_settings.randomWords` and `.synonyms` are deleted by `migrate`.
3. **Implement Minimal Code:** Migration runs inside `loadSettings` if `schemaVersion` is missing or `< 1`. Uses ST globals `extension_settings` and `saveSettingsDebounced` — abstract these as injectable deps for tests.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(settings): add schema, defaults, and legacy migration`

---

### Task 10: Runtime — random-words engine

**Objective:** Implement the three modes (random / double-pass / contextual) with their offline fallback paths. This is the most logic-heavy engine module.

**Files to modify/create:**
- Create: `src/engine/random-words.js` (Purpose: exports `generateWords(lang, settings, userMessage)` per design §8. Implements mode dispatch and all fallback rules from design §8 Mode semantics.)
- Test: `tests/engine/random-words.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §8 in full — especially the Mode semantics block. Depends on Tasks 5, 6, 7, 8 (language, random, words, synonyms).
2. **Write Failing Tests:** Cover: **random** — returns `wordCount` items respecting all filters; **double-pass** — anchor has `hasEntry()===true`; result includes anchor and ≥1 association; with `DOUBLE_PASS_ANCHOR_RETRIES` exceeded (all words lack entries, simulated via fixture where no word has synonyms) → falls back to plain random for all slots; **contextual** — extracts keywords from user message, picks highest-rank keyword with `hasEntry()===true`, returns its associations; no keyword has an entry → falls back to plain random and `console.warn` once. All modes: respects `blacklist` and `history` exclusions; never throws on missing data.
3. **Implement Minimal Code:** Dispatch on `settings.mode`. Inject `words.js` and `synonyms.js` accessors via module imports but allow stubbing through an options argument for tests.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(engine): add random-words generator with three modes`

---

### Task 11: Runtime — synonym scanner engine

**Objective:** Detect overused words in recent chat history and surface synonym suggestions.

**Files to modify/create:**
- Create: `src/engine/synonym-scanner.js` (Purpose: exports `findOverusedWords(chatHistory, lang, settings)` per design §8. Returns `Array<{word, count, suggestions}>`.)
- Test: `tests/engine/synonym-scanner.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §8 (`synonym-scanner.js`), current `index.js:879` (`injectSynonyms`) and `index.js:1008` (`fetchSynonyms`) for the current online behavior being replaced.
2. **Write Failing Tests:** Cover: tokenizes last `scanDepth` messages; excludes stopwords from both EN and RU sets; builds correct frequency counts; only words with `count ≥ minOccurrences` AND `hasEntry()===true` are returned; `suggestions` array is non-empty and contains only words present in `getSynonyms()`; empty history returns `[]`; messages with no script characters (all emoji) are skipped gracefully.
3. **Implement Minimal Code:** Tokenize via regex split on whitespace + punctuation. Lowercase. Use `STOPWORDS_EN`/`STOPWORDS_RU` from `data/language.js`. Look up synonyms via `data/synonyms.js`. Limit suggestions to top 2 per overused word.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(engine): add synonym overuse scanner`

---

### Task 12: Runtime — injector orchestrator

**Objective:** Top-level engine module that ties data + sub-engines together and mutates the SillyTavern prompt data. Integration-heavy; the test exercises prompt-template rendering and depth placement.

**Files to modify/create:**
- Create: `src/engine/injector.js` (Purpose: exports `onPromptReady(promptData)` per design §8. Resolves language, dispatches to engines, applies `injectionDepth` / `injectionEndRole`, renders template, splices into prompt. All failure modes from design §9.3 are caught here.)
- Test: `tests/engine/injector.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §8 (`injector.js`), §9.3 (failure modes), current `index.js:820` (`injectRandomWords`) and `index.js:879` (`injectSynonyms`) for current injection behavior. Depends on Tasks 5, 9, 10, 11.
2. **Write Failing Tests:** Cover: random words disabled → prompt unchanged; both disabled → prompt unchanged; template renders `{{words}}` placeholder with the generated words; synonym template renders `{{originalWord}}` and `{{synonyms}}`; `injectionDepth: 0` splices at index 0; `injectionDepth: 3` splices at index 3 (or end if shorter); broken `{{` in custom prompt → caught, logged, prompt unchanged, no throw; generated words array is empty → skips injection that turn.
3. **Implement Minimal Code:** Wrap each step in try/catch. Use the chat context from `SillyTavern.getContext()` for the latest user message and chat history; abstract for tests. Template rendering uses simple string `.replace()`.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(engine): add prompt injector orchestrator`

---

### Task 13: Runtime — settings UI panel

**Objective:** Rebuild the settings UI for the new schema. No unit tests per design §11.1 — verified by manual release checklist (design §11.2). This task ports the relevant subset of current `index.js:1059` (`createSettingsUI`) and discards the API-mode-specific fragments.

**Files to modify/create:**
- Create: `src/ui/templates.js` (Purpose: exports `randomWordsSection(settings)`, `synonymsSection(settings)`, `languageRadio(settings)` per design §8. Pure functions returning HTML strings.)
- Create: `src/ui/panel.js` (Purpose: exports `renderSettings(container)`, `bindEvents(container, onChange)` per design §8. Builds the collapsible panel, wires inputs to `saveSettings` via debounce.)
- Modify: `styles.css` (Purpose: drop selectors for removed controls — `#rabbit_api_provider`, `#rabbit_datamuse_mode`, `#rabbit_relationship_type`, `#rabbit_word_commonness`, etc. Add selectors for new controls — language radio, mode selector. Don't rewrite the file; surgically update.)

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §4 (UI module locations), §7 (new schema fields). Read current `index.js:1059-1660` for the panel structure and event bindings to preserve (collapsible header, test button, reset-prompt button). Read current `styles.css` in full.
2. **No TDD Red Step:** UI is manual-only. Build directly.
3. **Implement:** New controls: 3-way language radio (English / Russian / Auto-detect); mode dropdown (random / double-pass / contextual); parts-of-speech checkboxes consolidated under one fieldset; word-count, word-length, history-size, blacklist inputs as today; scan-depth and min-occurrences for synonyms; custom-prompt textareas for both features with reset buttons. Preserve the "Test Random Words" button — wire it to `generateWords()` instead of the old API path.
4. **Verify:** Run the manual smoke test from design §11.2 items 1, 8 (fresh install, blacklist). Visual inspection: panel collapses/expands, all inputs persist on save.
5. **Commit:** `feat(ui): add settings panel and templates for new schema`

---

### Task 14: Runtime — entry point and manifest wiring

**Objective:** Replace the 1683-line `index.js` with a thin entry that wires ST events to the new modules. This task retires the old code.

**Files to modify/create:**
- Create: `src/index.js` (Purpose: ST entry point per design §8. Registers `CHAT_COMPLETION_PROMPT_READY` listener → `engine/injector.onPromptReady`. Calls `settings.loadSettings()` and `ui/panel.renderSettings()` on extension activation. Calls `data/words.ensureWordBankLoaded()` / `data/synonyms.ensureSynonymsLoaded()` lazily — only on first chat turn with feature enabled, per design §9.2.)
- Modify: `index.js` (root, currently the 1683-line monolith) — replace contents with a single line re-exporting `src/index.js`. Per design §4: "manifest.json → js: 'index.js' (root re-export from src/index.js)".
- Modify: `manifest.json` — update `display_name`, bump `version` to `2.0.0` (breaking change: removes APIs). No `jsMode` field (it stays client-side browser ESM).
- Modify: `AGENTS.md` — update the Architecture section to reflect the new module structure. Remove the "Single-file architecture" sentence. Add a brief module map pointing to `src/`. Update the API Integrations section to "Bundled offline assets".
- Modify: `README.md` — rewrite the install + features sections for the offline world. Document the language modes (EN / RU / Auto). Add a "Regenerating assets" section pointing at `scripts/raw/README.md`. Drop any mention of the three APIs.

**Instructions for Execution Agent:**
1. **Context Setup:** Read design §4 (file structure + dependency rule), §8 (`src/index.js` interface), §9.1 (init sequence). Read current `index.js:1-10` (ST global imports) — these imports must be replicated in `src/index.js`.
2. **No TDD Red Step Here:** This is integration wiring. The unit tests from Tasks 5–12 already cover the logic.
3. **Implement:** `src/index.js` imports ST globals (`saveSettingsDebounced` from `../../../../script.js`, `extension_settings` from `../../../extensions.js`, `SillyTavern.getContext()`). Register listeners. Implement `init()` per design §9.1 with the failure-mode handling from §9.3 (catch load errors, `toastr.error` once, mark degraded). Root `index.js` becomes: `export * from './src/index.js';` plus any required side-effect imports.
4. **Verify:** Run the full manual release checklist from design §11.2 (all 10 items). Run `npm test` — all unit tests still pass. Run `npm run build` — verifier still passes.
5. **Commit:** `feat: wire offline entry point, retire monolithic index.js`

---

### Task 15: Documentation update — AGENTS.md and README.md

**Objective:** Ensure the repo documentation matches the new architecture. Done as a discrete task so it isn't lost in the wiring churn of Task 14. If Task 14 already updated these files, this task becomes a focused review and polish pass.

**Files to modify/create:**
- Modify: `AGENTS.md` (Purpose: update Project Overview, Architecture, API Integrations, Core Functions, Settings Structure, and Key Design Decisions sections to describe the offline layered architecture. Replace the "Single-file architecture in `index.js` (~1670 lines)" line. Update the build/dev section to mention `npm run build` and `npm test`.)
- Modify: `README.md` (Purpose: user-facing rewrite. New sections: Features (offline, EN/RU/Auto, three modes, synonym scanner), Installation (unchanged ST install flow), Usage (language modes, mode dropdown, blacklist), Developer Setup (clone, `npm install`, `npm run build`, `npm test`), Regenerating Assets (link to `scripts/raw/README.md`).)
- Create: `scripts/raw/README.md` (Purpose: per Task 4 spec — if not already created there, create here. Documents where to download each raw source, expected filename, SHA256.)
- Modify: `docs/offline.md` (Purpose: add a banner at the top: "Superseded by `docs/designs/2026-06-15-offline-refactor.md`. Kept for historical context." Do not delete — the design doc references it.)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the new `src/` tree (use `ls` or Glob), the design doc, the current `AGENTS.md`, and the current `README.md`. Compare what they say vs. what the code now does.
2. **No Tests:** Documentation-only task.
3. **Implement:** Rewrite per the file-by-file purposes above. Keep AGENTS.md factual and developer-facing; keep README.md user-facing. Match the existing tone of each file.
4. **Verify:** Read both updated files end-to-end. Confirm every code path / module / setting mentioned in the docs exists in the code. Confirm every public module is mentioned in AGENTS.md. Confirm the install instructions in README.md still match how ST third-party extensions install (git URL).
5. **Commit:** `docs: update AGENTS.md and README.md for offline layered architecture`

---

## Task Dependency Summary

| Task | Depends On | Notes |
|---|---|---|
| 1 — Constants + verifier | — | Foundation |
| 2 — Compact + normalize | 1 | Uses constants |
| 3 — WordNet + YARN extractors | 1, 2 | Uses constants + compact |
| 4 — Build orchestrator + assets | 1, 2, 3 | Generates committed JSON |
| 5 — Language detection | — | Pure runtime, independent |
| 6 — Random utilities | — | Pure runtime, independent |
| 7 — Word bank data | 5, 6 | Uses language + random |
| 8 — Synonyms data | — | Independent of 7 |
| 9 — Settings + migration | — | Pure, independent |
| 10 — Random-words engine | 5, 6, 7, 8 | Composition |
| 11 — Synonym scanner engine | 5, 8 | Composition |
| 12 — Injector orchestrator | 5, 9, 10, 11 | Top of engine layer |
| 13 — UI panel + templates | 9 | Reads settings shape |
| 14 — Entry point + manifest | 5–13 | Integration; retires old index.js |
| 15 — Documentation | 14 | Polish pass after wiring |

Tasks 5, 6, 8, 9 can run in parallel if multiple agents are available — they don't depend on each other.
