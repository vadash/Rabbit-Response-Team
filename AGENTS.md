# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rabbit Response Team is a fully offline SillyTavern extension that injects bundled random words (English & Russian) into AI prompts to disrupt LLM pattern-based thinking. Supports three language modes: English, Russian, and Auto-detect. No runtime network calls, no npm runtime dependencies.

## Build & Development

**Asset pipeline:** `npm run build` runs `scripts/build_assets.js` (extracts/normalizes from `scripts/raw/` sources into `assets/{en,ru}/`) followed by `scripts/verify_assets.js` (postbuild checker). See `scripts/raw/README.md` for source-download instructions.

**Tests:** `npm test` runs the `node:test` suite under `tests/`. Pure-function layers (`data/`, `engine/`, `settings.js`, `scripts/lib/`) are unit-tested; UI is manual-only.

**Installation:** Copy this folder to SillyTavern's `third-party/` directory, then enable via SillyTavern's Extensions UI.

**Manual smoke test:** Use the "Test Random Words" button in the extension settings panel.

## Architecture

Layered ES-module structure under `src/` (per `docs/designs/2026-06-15-offline-refactor.md` §4). The root `index.js` is a one-line re-export of `src/index.js` — `manifest.json` keeps `js: "index.js"`.

### Module map

| Module | Responsibility |
|---|---|
| `src/index.js` | ST entry: imports globals, registers `CHAT_COMPLETION_PROMPT_READY`, renders settings UI, wires module deps. |
| `src/settings.js` | Default settings, `loadSettings` / `saveSettings`, legacy-schema `migrate`. |
| `src/data/language.js` | `detectLanguage` / `resolveLanguage`, EN+RU stopword sets. |
| `src/data/words.js` | Word-bank lazy loading, filtering, sampling. |
| `src/data/synonyms.js` | Synonym + association lookups. |
| `src/util/random.js` | Fisher-Yates shuffle, sampling without replacement, history bookkeeping. |
| `src/engine/random-words.js` | `generateWords(lang, settings, userMessage)` — random / double-pass / contextual modes. |
| `src/engine/synonym-scanner.js` | `findOverusedWords` — frequency map + synonym suggestions. |
| `src/engine/injector.js` | `onPromptReady(promptData)` — top-level orchestrator that splices rendered prompts. |
| `src/ui/templates.js` | HTML-string builders for the settings panel. |
| `src/ui/panel.js` | `renderSettings` / `bindEvents` for the collapsible settings UI. |
| `assets/{en,ru}/words.json` | Bundled word banks: `[[word, pos, rank], ...]`. |
| `assets/{en,ru}/synonyms.json` | Bundled synonym/association map: `{ word: { s:[...], a:[...] } }`. |

### Dependency rule

Engine never imports UI. Data never imports engine. UI never imports engine (one intentional exception: the Test button calls a `generateWords` function injected from `src/index.js` at boot). Only `src/index.js` and `engine/injector.js` sit at the top of the import graph. Every inter-file import uses an explicit `.js` extension.

### Injection seam

ST globals (`extension_settings`, `saveSettingsDebounced`, `SillyTavern.getContext()`, jQuery, toastr) and inter-module deps are injected via each module's `__setDepsForTest` hook — `src/index.js` wires production deps through the same hook at boot.

### Bundled offline assets

Word banks and synonym maps ship as committed JSON under `assets/{en,ru}/`. Sources (Datamuse wordfreq, `wordnet-db`, Badestrand Russian Dictionary, YARN) are processed by the build pipeline at `scripts/`. No network calls at runtime.

### Settings Structure

Single namespace `extension_settings.rabbitResponseTeam` with `schemaVersion: 1`:
- `randomWords`: `enabled`, `wordCount`, `customPrompt`, `injectionDepth`, `injectionEndRole`, `wordLength`, `partsOfSpeech`, `mode` (`random` | `double-pass` | `contextual`), `wordHistorySize`, `blacklist`, `themeWords`
- `synonyms`: `enabled`, `scanDepth`, `minOccurrences`, `customPrompt`
- `language`: `'en'` | `'ru'` | `'auto'`

Legacy `extension_settings.randomWords` / `.synonyms` are migrated on first load (see `settings.js → migrate`).

## Key Design Decisions

- **Lazy per-language asset loading.** Word banks and synonym maps are fetched on the first chat turn that needs them, not at boot. Cached at module scope after first load.
- **Word history tracking** prevents repeat words within a configurable window.
- **Three generation modes**: random (filtered sample), double-pass (anchor + associations), contextual (keywords from the user's latest message).
- **Injection depth** controls where in the prompt the rendered template splices in (system prompt vs. user message boundary).
- **Fail safe.** No code path may throw into ST's prompt pipeline — the injector wraps every step in try/catch and silently no-ops on broken templates, missing data, or asset fetch failures (with a one-time `toastr.error` from `src/index.js`).
