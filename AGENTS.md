# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rabbit Response Team is a SillyTavern extension that injects truly random words from external APIs into AI prompts to disrupt LLM pattern-based thinking. Pure vanilla JavaScript with no build system or package dependencies.

## Build & Development

No build system. The extension runs directly in SillyTavern's client-side JavaScript environment.

**Installation**: Copy this folder to SillyTavern's `third-party/` directory, then enable via SillyTavern's Extensions UI.

**Testing**: Manual testing only — use the "Test Random Words" button in the extension settings panel.

**Linting/CI**: None configured.

## Architecture

Single-file architecture in `index.js` (~1670 lines). All logic lives here; `styles.css` provides the settings UI styling, `manifest.json` provides SillyTavern extension metadata.

### API Integrations

Three external APIs for random word generation:
- **Heroku Random Word API** — multi-language support
- **Vercel Random Word API** — advanced filters (length, frequency)
- **Datamuse API** — part-of-speech filtering, contextual relationships

Falls back to a 113-word hardcoded bank if all APIs fail.

### Core Functions

- `loadSettings()` / `saveSettings()` — settings with automatic migration from flat to nested structure
- `fetchRandomWordsFromAPI()` — dispatches to configured API provider
- `injectRandomWords()` — main prompt injection on `CHAT_COMPLETION_PROMPT_READY`
- `injectSynonyms()` — detects overused words, suggests replacements
- `createSettingsUI()` — builds the collapsible settings panel

### Settings Structure

Nested under `extension_settings.randomWords` and `extension_settings.synonyms`:
- `randomWords.enabled`, `wordCount`, `useAPI`, `apiProvider`, `wordHistorySize`, `blacklist`, `doublePass`, `contextualMode`, `injectionDepth`
- `synonyms.enabled`, `scanDepth`, `minOccurrences`

### SillyTavern Dependencies

Uses global SillyTavern APIs: `saveSettingsDebounced`, `extension_settings`, `eventSource`, `event_types`, `getContext()`, `toastr`.

## Key Design Decisions

- **Word history tracking** prevents repeat words within a configurable window
- **Double pass mode**: picks one anchor word, then themes remaining words around it
- **Contextual mode**: extracts keywords from user's message and finds semantically related words via Datamuse
- **Injection depth**: controls where in the prompt the random words appear (system prompt vs. user message boundary)
