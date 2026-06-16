# Changelog

All notable changes to Rabbit Response Team are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **`injectionDepth` now follows SillyTavern's standard bottom-up semantics** (depth=0 = bottom of chat, depth=N = N messages up from the bottom). Previously it was treated as an index from the top of the chat (depth=0 → first message). This aligns Rabbit Response Team with Author's Note, Vectors, Memory, and other ST injection features. Users who relied on the old top-down meaning must adjust their depth value.
- **Injection mechanism switched** from mutating `promptData.chat` inside a `CHAT_COMPLETION_PROMPT_READY` listener to SillyTavern's blessed `setExtensionPrompt` API hooked via `GENERATION_AFTER_COMMANDS` (registered with `makeFirst`). No user-visible change except more reliable injection and new `🐰 RRT:` console diagnostic logs on every generation.

### Removed

- **`{{words}}` macro is still not substituted** in user-authored custom prompts. This design does not register a SillyTavern macro, so writing `{{words}}` directly in a prompt field has no effect. Tracked separately as a future subsystem.
