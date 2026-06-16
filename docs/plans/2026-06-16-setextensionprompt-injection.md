# setExtensionPrompt Injection — Implementation Plan

**Goal:** Replace `promptData.chat` mutation in `CHAT_COMPLETION_PROMPT_READY` with SillyTavern's `setExtensionPrompt` API hooked via `GENERATION_AFTER_COMMANDS`, plus diagnostic logging so silent failures become traceable.
**Design doc:** `docs/designs/2026-06-16-setextensionprompt-injection.md`
**Testing conventions:** Node built-in test runner (`npm test` → `node --test "tests/**/*.test.js"`). ESM, `import { test, describe, beforeEach } from "node:test"` and `import assert from "node:assert/strict"`. Test files mirror `src/` layout under `tests/`. Pure-function layers (engine, data, util, settings, scripts) are unit-tested; ST-global wiring in `src/index.js` is manual-only per AGENTS.md.

---

### Task 1: Refactor `engine/injector.js` to pure compute (`buildInjections`)

**Objective:** Replace `onPromptReady(promptData)` (which mutated `promptData.chat` via splice) with a pure `buildInjections(settings, lang, userMessage, chatTexts)` function that returns `{ random: {content, depth, role} | null, synonyms: {content, depth, role} | null }`. Engine layer must remain free of ST globals. This task is the foundation — Task 2 cannot be written without it.

**Files to modify/create:**
- Modify: `src/engine/injector.js` (Replace `onPromptReady` export with `buildInjections`. Keep `__setDepsForTest` seam and existing deps shape — `words`, `synonyms`, `warn`. Drop `getSettings` and `getContext` from deps since the new signature takes settings + userMessage + chatTexts directly as parameters.)
- Modify: `tests/engine/injector.test.js` (Rewrite all 10 existing tests to assert on `buildInjections` return value instead of `promptData.chat` mutation.)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/engine/injector.js` and `tests/engine/injector.test.js` in full. Read `src/settings.js` lines 1-32 for the `defaultSettings` shape (so you know what fields exist on `settings.randomWords` and `settings.synonyms`). Read `src/engine/random-words.js` lines 170-220 for the `generateWords(lang, settings, userMessage, opts)` signature. Read `src/engine/synonym-scanner.js` for `findOverusedWords` signature.
2. **Write Failing Tests (Red):** Rewrite `tests/engine/injector.test.js`. The describe block stays `describe("injector — buildInjections", ...)`. Replace every test body to call `await buildInjections(settings, "en", userMessage, chatTexts)` and assert on the returned object. Specifically:
   - "both features disabled → both slots null"
   - "random enabled → `result.random` is `{content, depth, role}` with content containing rendered words, depth from settings, role mapped from 'system'→0"
   - "synonyms enabled → `result.synonyms` is non-null with originalWord and synonyms substituted; `result.random` is null"
   - "depth=N passes through to `result.random.depth`"
   - "role='user' maps to `result.random.role === 1`"
   - "role='assistant' maps to `result.random.role === 2`"
   - "unknown role string falls back to 0 (SYSTEM) and triggers warn"
   - "broken '{{' in custom prompt → `result.random` is null AND warn was called"
   - "empty generated words array → `result.random` is null"
   - "generateWords throws → caught, `result.random` is null, warn called"
   The existing stub factories `makeWordsStub`, `makeSynonymsStub`, `makeSettings`, and the `__setDepsForTest({ words, synonyms, warn })` wiring all stay — only the call site and assertions change.
   Run `npm test` and confirm the new tests fail (no `buildInjections` export yet).
3. **Implement (Green):** Refactor `src/engine/injector.js`:
   - Delete `computeInsertIndex`, `messageText`, `lastUserText` — no longer needed (chat-texts and user message arrive as parameters).
   - Keep `renderTemplate` as-is.
   - Add a `mapRole(roleStr)` helper: `"system"`→0, `"user"`→1, `"assistant"`→2, default 0 with a `deps.warn(...)` call on miss.
   - Replace `onPromptReady` and `buildInjections`'s old shape with a new `buildInjections(settings, lang, userMessage, chatTexts)` that returns `{ random, synonyms }`. Each slot is built independently; if a feature is disabled or its data is empty/throws, that slot is `null`. The synonym slot reuses `findOverusedWords(chatHistoryTexts, lang, settings, { synonyms: deps.synonyms })` exactly as today.
   - Both slots' `depth` comes from `settings.randomWords.injectionDepth` (shared); both slots' `role` comes from `settings.randomWords.injectionEndRole` mapped via `mapRole`.
   - Export `buildInjections` and `__setDepsForTest`. Remove the `onPromptReady` export entirely.
4. **Verify:** Run `npm test`. All engine tests must pass. Confirm no other test file imports `onPromptReady` (grep `tests/` to be sure).
5. **Commit:** `refactor(injector): replace onPromptReady with pure buildInjections`

---

### Task 2: Rewire `src/index.js` to use `setExtensionPrompt` + `GENERATION_AFTER_COMMANDS`

**Objective:** Replace the `CHAT_COMPLETION_PROMPT_READY` listener (`handlePromptReady`) with a `GENERATION_AFTER_COMMANDS` listener (`handleGeneration`) that calls `setExtensionPrompt` for each of the two slots (or clears them when null). Add diagnostic logging at every decision point so silent failures become traceable. Depends on Task 1 (uses the new `buildInjections` export).

**Files to modify/create:**
- Modify: `src/index.js` (Add imports for `setExtensionPrompt`, `extension_prompt_types`, `extension_prompt_roles` from `../../../../../script.js`. Replace `handlePromptReady` with `handleGeneration`. Update `registerEventListener` to register on `GENERATION_AFTER_COMMANDS` via `eventSource.makeFirst`. Update the `onPromptReady` import to `buildInjections`. Add a `clearSlot(key)` helper and a `writeSlot(key, injection)` helper. Add a `mapRole` mirror or import it from injector.js — preferred: export `mapRole` from injector.js and import it here, to keep a single source of truth.)
- Modify: `src/engine/injector.js` (Export `mapRole` alongside `buildInjections` so `src/index.js` can reuse it. One-line change.)
- No new test files — wiring layer is manual-only per AGENTS.md. The diagnostic logs added in this task ARE the verification surface for manual smoke test in Task 3.

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/index.js` in full (current ~180 lines). Read `src/engine/injector.js` post-Task-1 to confirm `buildInjections` signature and the `mapRole` export. Optionally verify the ST API shape by reading `C:\projects\SillyTavern\public\script.js` lines 480-500 (the `extension_prompt_types` and `extension_prompt_roles` enums) and lines 8860-8875 (`setExtensionPrompt` signature) — but do NOT add SillyTavern as a dependency, just confirm the import path and signatures.
2. **Implement:** Modify `src/index.js`:
   - Add to the existing `script.js` import block: `setExtensionPrompt`, `extension_prompt_types`, `extension_prompt_roles`.
   - Update the `./engine/injector.js` import: replace `onPromptReady, __setDepsForTest as setInjectorDeps` with `buildInjections, mapRole, __setDepsForTest as setInjectorDeps`.
   - In `src/engine/injector.js`: add `mapRole` to the export list (one line — already implemented in Task 1, just needs to be exported).
   - Define two slot-key constants at module scope: `SLOT_RANDOM = 'rabbitResponseTeam_random'`, `SLOT_SYNONYM = 'rabbitResponseTeam_synonym'`.
   - Replace `handlePromptReady` with `handleGeneration(type, options, dryRun)`:
     - Wrap entire body in try/catch. On catch: `console.warn('🐰 RRT: handleGeneration failed:', err)`.
     - Log entry: `console.log('🐰 RRT: handleGeneration entry dryRun=...')`.
     - `loadSettings()`; compute `rwEnabled` and `synEnabled`; log `🐰 RRT: enabled random=... synonyms=...`.
     - If both disabled: clear both slots, log `🐰 RRT: slot=random action=clear reason=disabled` and same for synonyms, return.
     - Resolve `lastUser` from `SillyTavern.getContext().chat` exactly as today; `resolveLanguage`; log `🐰 RRT: resolved lang=... (lastUser N chars)`.
     - `await ensureAssetsForLanguage(resolved)`; log `🐰 RRT: assets loaded`. On catch (asset failure): clear both slots, log, return (existing `announceFailure` already fires toastr).
     - `chatTexts = ctxChat.map(m => m?.mes ?? m?.content ?? '')`.
     - `const result = await buildInjections(settings, resolved, lastUser, chatTexts)`.
     - For each slot: if `result.random` is non-null → `writeSlot(SLOT_RANDOM, result.random)` and log `🐰 RRT: slot=random action=set contentLen=... depth=... role=...`; else → `clearSlot(SLOT_RANDOM)` and log `🐰 RRT: slot=random action=clear`. Same for synonyms.
     - Log exit: `🐰 RRT: handleGeneration exit duration=Xms`.
   - `writeSlot(key, injection)` calls `setExtensionPrompt(key, injection.content, extension_prompt_types.IN_CHAT, injection.depth, false, injection.role)`.
   - `clearSlot(key)` calls `setExtensionPrompt(key, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM)`.
   - In `registerEventListener`: change `event_types.CHAT_COMPLETION_PROMPT_READY` to `event_types.GENERATION_AFTER_COMMANDS`. Use `eventSource.makeFirst(type, handleGeneration)` instead of `eventSource.on(type, ...)`. Update the missing-event-type warn message accordingly.
3. **Verify:** Run `npm test` — all tests still green (no tests touch `src/index.js`). Manually grep `src/` for any lingering `handlePromptReady` or `CHAT_COMPLETION_PROMPT_READY` references — must be zero.
4. **Commit:** `refactor(index): switch injection to setExtensionPrompt + GENERATION_AFTER_COMMANDS`

---

### Task 3: CHANGELOG entry, full-suite verification, manual smoke checklist

**Objective:** Document the depth-semantics behavior change (top-down → bottom-up ST-standard), run the full test suite one more time, and capture the manual smoke-test checklist inside the repo so the user can verify in their SillyTavern install.

**Files to modify/create:**
- Create: `CHANGELOG.md` at repo root (does not currently exist — create with standard Keep-a-Changelog header). Entry under `## [Unreleased]`:
  - `Changed` — `injectionDepth` now follows SillyTavern's standard bottom-up semantics (depth=0 = bottom of chat). Previously treated as index-from-top. Users who relied on the old top-down meaning must adjust their depth value.
  - `Changed` — injection mechanism switched from `promptData.chat` mutation in `CHAT_COMPLETION_PROMPT_READY` to `setExtensionPrompt` in `GENERATION_AFTER_COMMANDS`. No user-visible change except more reliable injection and new `🐰 RRT:` console logs.
  - `Removed` — `{{words}}` in user-authored prompts is still NOT substituted (this design does not register a SillyTavern macro). Tracked separately.
- Create: `docs/manual-smoke-test.md` capturing the manual verification checklist from design §7.3.

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/designs/2026-06-16-setextensionprompt-injection.md` §7.3 (manual smoke checklist) and §4.5 (depth-semantics shift). Confirm `CHANGELOG.md` does not already exist at repo root (`Glob CHANGELOG.md`).
2. **Write CHANGELOG:** Create `CHANGELOG.md` with the standard Keep-a-Changelog header and an `## [Unreleased]` section containing the three bullets above. Use the conventions from https://keepachangelog.com/.
3. **Write Smoke-Test Doc:** Create `docs/manual-smoke-test.md` with the checklist from design §7.3, formatted as numbered steps with expected `🐰 RRT:` log lines at each stage.
4. **Verify:** Run `npm test` — full suite green. Run `npm run verify` — asset checker passes (no asset changes, but confirms nothing broke). Grep `src/` for `TODO`/`FIXME` introduced by this work — should be zero.
5. **Commit:** `docs: add CHANGELOG and manual smoke-test checklist for setExtensionPrompt switch`
