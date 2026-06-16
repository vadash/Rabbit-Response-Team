# Synonym Feature Overhaul Implementation Plan

**Goal:** Implement the synonym redesign from `docs/designs/2026-06-16-synonym-overhaul.md` — scan assistant messages only, surface top-N overused words by frequency with two output modes, give the slot independent depth/role settings, and add a Test Synonyms button.

**Testing Conventions:** Pure-function layers (`data/`, `engine/`, `settings.js`, `scripts/lib/`) are unit-tested via `node:test` + `node:assert/strict` under `tests/`. UI is manual-only (no DOM tests). Engine/data modules use a `__setDepsForTest` injection seam — tests stub deps via that hook. Run with `npm test`. Engine never imports UI; data never imports engine.

---

### Task 1: Settings schema — new synonym fields

**Objective:** Extend `defaultSettings.synonyms` with `topN`, `outputMode`, `customPromptRow`, `injectionDepth`, `injectionEndRole`. Update calibrated defaults (`scanDepth: 10`, `minOccurrences: 5`). Add new `DEFAULT_SYNONYM_PROMPT_ROW` template constant. Migration is additive — `mergeDeep` already handles filling missing fields, so no `schemaVersion` bump.

**Files to modify/create:**
- Modify: `src/settings.js` (add fields to `defaultSettings.synonyms`; add `DEFAULT_SYNONYM_PROMPT_ROW` constant next to existing `DEFAULT_SYNONYM_PROMPT`; update `DEFAULT_SYNONYM_PROMPT` text to the new avoid-style outer wrapper from design §5.3)
- Modify: `tests/settings/settings.test.js` (add test cases — see step 2)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/settings.js` in full. Note how `DEFAULT_RANDOM_PROMPT` / `DEFAULT_SYNONYM_PROMPT` are exported and consumed (especially by `tests/engine/injector.test.js` and `src/ui/panel.js`). Read `tests/settings/settings.test.js` to match existing test style.
2. **Write Failing Tests:** In `tests/settings/settings.test.js`, add cases asserting:
   - `defaultSettings.synonyms.scanDepth === 10`
   - `defaultSettings.synonyms.minOccurrences === 5`
   - `defaultSettings.synonyms.topN === 3`
   - `defaultSettings.synonyms.outputMode === "with-suggestions"`
   - `defaultSettings.synonyms.injectionDepth === 0`
   - `defaultSettings.synonyms.injectionEndRole === "system"`
   - `defaultSettings.synonyms.customPromptRow === DEFAULT_SYNONYM_PROMPT_ROW`
   - `DEFAULT_SYNONYM_PROMPT_ROW` exported from `src/settings.js` and contains `{{originalWord}}`, `{{count}}`, `{{synonyms}}` placeholders
   - Round-trip: `loadSettings()` after a fresh slot fill returns all new fields at defaults
   - Migration: a legacy `{randomWords: {...}, synonyms: {enabled: true, scanDepth: 4, minOccurrences: 2, customPrompt: "x"}}` produces `synonyms.scanDepth === 4` (preserved), `synonyms.topN === 3` (default filled), `synonyms.outputMode === "with-suggestions"` (default filled)
   Run `npm test -- --test-name-pattern="synonyms"` (or just run all). Tests must fail.
3. **Implement Minimal Code:**
   - Add `DEFAULT_SYNONYM_PROMPT_ROW` constant: `"- \"{{originalWord}}\" ({{count}}×) — try: {{synonyms}}"` (literal multiplication sign `×`, not the letter `x`).
   - Update `DEFAULT_SYNONYM_PROMPT` to: `"[OOC WORD FRESHNESS: The following words have been used frequently. Avoid reusing them; vary your vocabulary.\n{{rows}}]"`
   - In `defaultSettings.synonyms`: change `scanDepth` to `10`, `minOccurrences` to `5`. Add `topN: 3`, `outputMode: "with-suggestions"`, `customPromptRow: DEFAULT_SYNONYM_PROMPT_ROW`, `injectionDepth: 0`, `injectionEndRole: "system"`.
   - Export `DEFAULT_SYNONYM_PROMPT_ROW` alongside `DEFAULT_SYNONYM_PROMPT`.
   - Migration: existing `migrate()` already preserves `scanDepth`/`minOccurrences`/`customPrompt` if present and fills the rest from `structuredClone(defaultSettings)`. Verify no new migration code is needed — the existing tests should cover it.
4. **Verify:** `npm test` — all tests pass, no regressions in existing injector/scanner tests (they hardcode `scanDepth: 6, minOccurrences: 2` so they're independent of defaults).
5. **Commit:** `feat(settings): add topN, outputMode, row template, independent depth/role to synonyms`

---

### Task 2: Scanner — frequency sorting + topN cap

**Objective:** Modify `findOverusedWords` to (a) sort results by `count` descending, (b) apply alphabetical tiebreaker for stable ordering, (c) cap results at `settings.synonyms.topN`. Signature unchanged — `chatHistory: string[]` still comes in pre-filtered by the caller.

**Files to modify/create:**
- Modify: `src/engine/synonym-scanner.js` (sort + slice logic)
- Modify: `tests/engine/synonym-scanner.test.js` (new test cases)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/engine/synonym-scanner.js` in full (70 lines). Note the existing loop at lines 59–67 builds `result` in `Map` insertion order. Read the existing scanner test file to match fixture style (`mini-en-synonyms.json`, `makeSynonymsStub`, `baseSettings(scanDepth, minOccurrences)`).
2. **Write Failing Tests:** In `tests/engine/synonym-scanner.test.js`, add a `describe("sorting and topN")` block with cases:
   - **Sorts by count descending:** history where word A appears 5×, B appears 3×, C appears 4× (all with synonym entries, all ≥ threshold). Assert result order is `[A, C, B]`.
   - **Alphabetical tiebreaker:** two words with equal count. Use names that prove ordering — `"zebra": 3, "apple": 3` → assert result is `["apple", "zebra"]`.
   - **`topN` cap respected:** set `baseSettings` to include `{ scanDepth: 6, minOccurrences: 2, topN: 2 }`, provide 3 eligible words. Assert `result.length === 2` and that the two kept are the highest-frequency ones.
   - **`topN` larger than pool:** `topN: 10`, only 2 eligible words → result length 2, no padding.
   - **`topN` missing from settings:** settings without `topN` field (legacy-shape simulation) → falls back to a hardcoded default of 3 (define a module-level `DEFAULT_TOP_N = 3` constant). Assert no throw and result length ≤ 3.
   - Use a new mini fixture or extend the existing inline stub for words like `"running"`, `"apple"`, `"slow"` with synonym entries.
   Run tests; they must fail.
3. **Implement Minimal Code:**
   - After the existing `for` loop builds `result` (currently in insertion order), add: `result.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))`.
   - Read `topN` from `synSettings.topN`; if not a positive integer, fall back to `DEFAULT_TOP_N = 3`.
   - Return `result.slice(0, topN)`.
   - Keep all existing behavior unchanged (stopword filtering, `hasEntry` check, `SUGGESTION_CAP = 2`).
4. **Verify:** `npm test` passes including pre-existing scanner tests.
5. **Commit:** `feat(scanner): sort synonym results by frequency and apply topN cap`

---

### Task 3: Injector — multi-word rendering + mode branch + independent depth/role

**Objective:** Replace the single-word rendering at `src/engine/injector.js:99–116` with a multi-word pipeline. Branch on `syn.outputMode` (`"avoid-only"` or `"with-suggestions"`). Render one row per result word using `syn.customPromptRow`, then nest the joined rows into `syn.customPrompt` via a new `{{rows}}` placeholder. Use `syn.injectionDepth` / `syn.injectionEndRole` instead of `rw.injectionDepth` / `rw.injectionEndRole`.

**Files to modify/create:**
- Modify: `src/engine/injector.js` (the `if (syn.enabled) { ... }` block, lines 99–116)
- Modify: `tests/engine/injector.test.js` (new cases)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/engine/injector.js` in full (119 lines). Note the existing `renderTemplate(template, vars)` helper at line 30 throws on unresolved `{{`. Note the existing `mapRole(roleStr)` helper. Read `tests/engine/injector.test.js` to see the `makeSynonymsStub` / `makeSettings` patterns.
2. **Write Failing Tests:** In `tests/engine/injector.test.js`, extend the existing `describe("injector — buildInjections")` block. Update the existing `makeSettings` helper to populate the new `synonyms` fields (topN, outputMode, customPromptRow, injectionDepth, injectionEndRole) from defaults so old tests still pass. Then add new cases:
   - **with-suggestions renders all top-N rows:** history where 2 words ("running", "apple") cross threshold, `topN: 3, outputMode: "with-suggestions"`. Assert the rendered content contains `"running"`, `"apple"`, and both rows' synonyms (`"jogging"`, the apple stub's synonyms). Assert it contains `{{rows}}` resolved (no literal `{{rows}}` remains).
   - **avoid-only renders rows without synonyms:** same history, `outputMode: "avoid-only"`. Assert content contains `"running"` and `"apple"` but does NOT contain `"jogging"` or any synonym. Assert the row template's `{{synonyms}}` resolved to empty string and any trailing ` — try:` separator was stripped.
   - **Empty scan → null slot:** history below threshold. `result.synonyms === null`.
   - **Independent depth:** `syn.injectionDepth: 4, rw.injectionDepth: 0`. Assert `result.synonyms.depth === 4` (not 0).
   - **Independent role:** `syn.injectionEndRole: "user", rw.injectionEndRole: "system"`. Assert `result.synonyms.role === 1` (user), not 0.
   - **Broken `{{` in row template → synonyms slot null AND warn called:** row template `"broken {{originalWord"`. Assert `result.synonyms === null` and `warnCalls.length > 0`.
   - **Broken `{{` in outer template → synonyms slot null AND warn called:** outer template `"broken {{rows"`. Same assertion.
   - **Single word still works (no regression):** one overused word → slot non-null, contains that word.
   Update the existing `"synonyms enabled → slot non-null"` test (line 102) — its assertion that content includes `"jogging"` still holds under `outputMode: "with-suggestions"` default. Run tests; they must fail.
3. **Implement Minimal Code:**
   - In the synonyms branch, read `syn.outputMode`, `syn.customPromptRow`, `syn.injectionDepth`, `syn.injectionEndRole`.
   - Compute depth/role from `syn.*`, not `rw.*`.
   - Build rows: for each entry in `overused`, render `customPromptRow` with `{ originalWord, count, synonyms }`. In avoid-only mode, pass `synonyms: ""` and strip any trailing `\s*[—–-]\s*try:\s*$` from the rendered row (regex; covers the default template and most reasonable edits).
   - Join rendered rows with `"\n"`.
   - Render outer `syn.customPrompt` with `{ rows: joinedRows }`.
   - Wrap everything in the existing try/catch — template render failures still null the slot and call `warn`.
4. **Verify:** `npm test` passes including the existing single-word test (which now exercises the multi-row path with a single-element list).
5. **Commit:** `feat(injector): render multi-word synonym prompts with mode branch and independent depth/role`

---

### Task 4: Synonym preview function for the Test button

**Objective:** Export a pure `buildSynonymsPreview(settings, lang, chatTexts)` that runs the same scan-and-render pipeline as the production synonyms slot but returns the rendered string (or a sentinel `"no overused words found"` message) instead of writing to a slot. The UI Test button calls this. Kept inside the engine layer so the UI→engine dependency is a single function, matching the existing `generateWords` pattern.

**Files to modify/create:**
- Modify: `src/engine/injector.js` (add `buildSynonymsPreview` export; refactor the row-building logic into a shared internal helper so both production and preview use it)
- Modify: `tests/engine/injector.test.js` (new test block)

**Instructions for Execution Agent:**
1. **Context Setup:** Re-read the current `buildInjections` synonyms branch (now refactored in Task 3). Identify the pure compute steps that can be lifted into a `renderSynonymPrompt(synSettings, lang, chatTexts, deps) → string | null` internal helper.
2. **Write Failing Tests:** In `tests/engine/injector.test.js`, add `describe("buildSynonymsPreview")`:
   - **Returns rendered string when overused words found:** chat history has overused "running", `outputMode: "with-suggestions"`. Result is a string containing `"running"` and its synonyms.
   - **Returns null-ish sentinel when nothing overused:** empty history or no words cross threshold. Define the contract: return value is `null` (UI translates null to a user-facing "no overused words" toast). Assert `=== null`.
   - **Respects topN cap:** 5 eligible words, `topN: 2` → result references only 2 words.
   - **Avoid-only mode:** no synonyms in output.
   - **Does not depend on randomWords settings:** pass minimal settings with `randomWords: undefined`. Must not throw.
   Run tests; fail.
3. **Implement Minimal Code:**
   - Extract the row-building + outer-template-rendering code from `buildInjections` into a private `renderSynonymPrompt(syn, lang, chatTexts)` function that returns `string | null` (null on empty result or template error).
   - `buildInjections` calls `renderSynonymPrompt(...)`; if non-null, wraps with `{ content, depth, role }`.
   - New export `buildSynonymsPreview(settings, lang, chatTexts)` calls `findOverusedWords` then `renderSynonymPrompt`; returns the string or `null`. Reuses the same `deps.synonyms` injection.
4. **Verify:** `npm test` passes.
5. **Commit:** `feat(injector): add buildSynonymsPreview for Test button`

---

### Task 5: Call-site — filter chat to assistant messages

**Objective:** In `src/index.js` `handleGeneration`, filter the chat array passed to `buildInjections` to exclude `is_user === true` entries, so the synonym scanner sees assistant (and system/narrator) messages only. This is the change that makes the feature match the user's mental model.

**Files to modify/create:**
- Modify: `src/index.js` (the `chatTexts` mapping at lines 179–181)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/index.js:146–187` to see how `ctxChat` is currently mapped to `chatTexts` and how `lastUser` is extracted. Note that `lastUser` extraction already uses `is_user` filtering — that pattern can be reused.
2. **No Unit Test** (this layer sits behind ST globals; per `AGENTS.md`, UI/integration paths are manual-only). Skip TDD here. Rely on the manual smoke checklist in Task 7.
3. **Implement the Change:**
   - Replace the `chatTexts` mapping with: filter `ctxChat` entries where `m && m.is_user === false`, then map to `m?.mes ?? m?.content ?? ''`.
   - Keep `lastUser` extraction unchanged (it still scans the full chat for the latest user message).
   - Add a brief comment explaining the filter — one line, stating *why* (synonym scanner is assistant-only).
4. **Verify:** `npm test` still passes (no engine test touches this code path). Manual verification happens in Task 7.
5. **Commit:** `feat(index): pass assistant-only chatTexts to synonym scanner`

---

### Task 6: UI — settings controls + Test Synonyms button

**Objective:** Add the new synonym settings controls to the panel HTML and wire them. Add a "Test Synonyms" button that calls `buildSynonymsPreview` and surfaces the result via `toastr`.

**Files to modify/create:**
- Modify: `src/ui/templates.js` (extend the synonyms section with: topN slider, outputMode radio, injectionDepth slider, injectionEndRole select, customPromptRow textarea + reset button, Test Synonyms button). Match existing HTML class/ID conventions (`rabbit_*` IDs, `rabbit-setting-row` wrappers, `rabbit-advanced-*` collapse pattern).
- Modify: `src/ui/panel.js` (extend `readSynonymsPatch` to read new fields; extend `synInputs` array; bind new reset button for the row template; bind Test Synonyms button).
- Modify: `src/index.js` (`wireDeps()` — inject `buildSynonymsPreview` into the panel via `setPanelDeps`, mirroring how `generateWords` is injected today)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/ui/templates.js` — find the synonyms section (search for `rabbit_synonym_enabled`). Read `src/ui/panel.js` lines 70–242 — see `readSynonymsPatch`, the `synInputs` array, the `#rabbit_test` click handler (the existing Test Random Words button), and `#rabbit_synonym_reset_prompt`. Read `src/index.js:254–265` — the `setPanelDeps` block where `generateWords` is injected.
2. **No Unit Test** (UI is manual-only per `AGENTS.md`). Skip TDD.
3. **Implement Templates:**
   - Add to `synonymsSection(settings)` in `templates.js`:
     - Number input `#rabbit_top_n` (1–8, step 1).
     - Radio group `name="rabbit_synonym_output_mode"` with values `avoid-only` and `with-suggestions`.
     - Number input `#rabbit_synonym_injection_depth` (0–99).
     - Select `#rabbit_synonym_injection_end_role` with options `system`/`user`/`assistant` (mirror the random-words role select).
     - Textarea `#rabbit_synonym_prompt_row` for `customPromptRow`, with a `#rabbit_synonym_reset_prompt_row` reset button.
     - Button `#rabbit_test_synonyms` labeled "Test Synonyms".
   - Keep all existing controls unchanged.
4. **Implement Panel Bindings:**
   - Extend `readSynonymsPatch` to read `topN`, `outputMode` (from radio), `customPromptRow`, `injectionDepth`, `injectionEndRole`.
   - Extend `synInputs` with the new selectors.
   - Add reset button handler for `#rabbit_synonym_reset_prompt_row` — mirrors the existing `#rabbit_synonym_reset_prompt` handler, resets to `DEFAULT_SYNONYM_PROMPT_ROW`.
   - Add `#rabbit_test_synonyms` click handler:
     - Load settings, resolve language from latest user message (same pattern as the existing Test Random Words button).
     - Pull assistant-only chat texts from `deps.getContext().chat` (apply the same `is_user === false` filter).
     - Call `deps.buildSynonymsPreview(settings, lang, chatTexts)`.
     - If result is a non-empty string → `toastr.success(result, "Rabbit Response Team", { timeOut: 10000, extendedTimeOut: 5000 })`.
     - If result is null → `toastr.info("No overused words found in the last N assistant messages.", "Rabbit Response Team")` where N is `settings.synonyms.scanDepth`.
5. **Wire Deps in src/index.js:**
   - Import `buildSynonymsPreview` from `./engine/injector.js`.
   - In `setPanelDeps({ ... })`, add `buildSynonymsPreview: async (settings, lang, chatTexts) => { await ensureAssetsForLanguage(lang); return buildSynonymsPreview(settings, lang, chatTexts); }` (lazy asset load, same pattern as `generateWords` injection).
6. **Verify:** `npm test` still green. Manual UI check in Task 7.
7. **Commit:** `feat(ui): add synonym output-mode/topN/depth controls and Test Synonyms button`

---

### Task 7: Manual smoke-test checklist + CHANGELOG

**Objective:** Validate the end-to-end behavior in SillyTavern against a real chat, and document the new behavior in the CHANGELOG.

**Files to modify/create:**
- Modify: `CHANGELOG.md` (add entry under Unreleased for the synonym overhaul)
- Modify: `docs/manual-smoke-test.md` or equivalent (the existing checklist file referenced in commit `f52aee9`)

**Instructions for Execution Agent:**
1. **Locate the Existing Checklist:** Run `Glob` for `docs/**/smoke*` or `docs/**/manual*` to find the existing manual smoke-test checklist committed in `f52aee9`.
2. **Add Synonym Steps:**
   - Open a SillyTavern chat with ≥10 assistant messages (the calibration chat or similar).
   - Enable synonyms, leave defaults (`scanDepth: 10, minOccurrences: 5, topN: 3, outputMode: with-suggestions`).
   - Click "Test Synonyms" — verify a toast appears showing 1–3 overused words with their synonyms, formatted as rows.
   - Toggle outputMode to `avoid-only` — click Test again — verify words appear without synonyms and no ` — try:` trailing separator.
   - Verify (by reading the rendered toast) that user-side repeated words are NOT flagged. Compare against the chat: pick a word that appears many times in user messages and confirm it's absent from the toast.
   - Send a chat message — verify the `rabbitResponseTeam_synonym` slot in browser devtools shows the rendered prompt.
   - Set `injectionDepth: 4` for synonyms and `0` for random words — trigger another generation — verify the synonym slot lands at depth 4 (visible via SillyTavern's prompt inspector or devtools) while the random slot remains at depth 0.
3. **CHANGELOG Entry:** Under `## Unreleased` add bullets:
   - Synonym scanner now scans assistant messages only (excludes `is_user`).
   - Surfaces top-N overused words by frequency (configurable, default 3) instead of one.
   - Two output modes: avoid-only and with-suggestions.
   - Independent depth/role settings for the synonym slot.
   - New "Test Synonyms" button mirroring the existing Test Random Words button.
   - Defaults calibrated from real chat data (`scanDepth: 10, minOccurrences: 5`).
4. **Verify:** `npm test` green; manual checklist executed end-to-end without surprises. If issues surface, file follow-up tasks rather than expanding scope here.
5. **Commit:** `docs: synonym overhaul smoke-test checklist and CHANGELOG entry`

---

## Notes for execution agents

- **Task ordering matters.** Tasks 1→4 build on each other (settings → scanner → injector → preview). Tasks 5 and 6 depend on all four. Task 7 must come last.
- **Backward compatibility.** Existing tests hardcode `scanDepth: 6, minOccurrences: 2` etc. — they must not break. Only the defaults in `defaultSettings` change.
- **The `×` character in row template** is a literal Unicode multiplication sign (U+00D7), not the letter `x`. Copy-paste carefully.
- **Fail-safe invariant** (`AGENTS.md` "Fail safe!" section): every new code path in `buildInjections` must be inside the existing try/catch. Template rendering must never throw into ST's prompt pipeline.
- **Manual smoke test for UI changes is non-negotiable** per `AGENTS.md`. Don't claim Task 6 works without running it in a browser.
