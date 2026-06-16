# Changelog

All notable changes to Rabbit Response Team are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Synonym scanner now scans assistant messages only** — user-side repetitions (`is_user: true`) are excluded from the frequency count, so the slot targets model habits rather than user phrasing.
- **Top-N overused words surfaced by frequency** — instead of injecting a single most-repeated word, the synonym slot now reports up to `topN` words (default `3`), ranked by occurrence count within the scan window.
- **Two output modes for the synonym slot:** `with-suggestions` (default — lists each overused word alongside suggested alternatives) and `avoid-only` (instructs the model to avoid the words without listing suggestions).
- **Independent `injectionDepth` and `injectionEndRole` settings for the synonym slot.** The synonym prompt no longer piggybacks on the random-words slot's depth/role — each slot can be placed at a different position in the prompt stack.
- **"Test Synonyms" button** in the extension panel, mirroring the existing "Test Random Words" button — renders the current synonym output (honoring the selected output mode and top-N) into a `toastr` toast without firing a generation.

### Changed

- **`injectionDepth` now follows SillyTavern's standard bottom-up semantics** (depth=0 = bottom of chat, depth=N = N messages up from the bottom). Previously it was treated as an index from the top of the chat (depth=0 → first message). This aligns Rabbit Response Team with Author's Note, Vectors, Memory, and other ST injection features. Users who relied on the old top-down meaning must adjust their depth value.
- **Injection mechanism switched** from mutating `promptData.chat` inside a `CHAT_COMPLETION_PROMPT_READY` listener to SillyTavern's blessed `setExtensionPrompt` API hooked via `GENERATION_AFTER_COMMANDS` (registered with `makeFirst`). No user-visible change except more reliable injection and new `🐰 RRT:` console diagnostic logs on every generation.

### Removed

- **`{{words}}` macro is still not substituted** in user-authored custom prompts. This design does not register a SillyTavern macro, so writing `{{words}}` directly in a prompt field has no effect. Tracked separately as a future subsystem.
