# Design: Switch Injection Mechanism to `setExtensionPrompt`

**Date:** 2026-06-16
**Status:** Approved (pending review)
**Builds on:** `docs/designs/2026-06-15-offline-refactor.md` (§4 layered architecture, §9.3 fail-safe)

---

## 1. Goal

Replace the current injection mechanism — mutating `promptData.chat` inside a `CHAT_COMPLETION_PROMPT_READY` listener — with SillyTavern's blessed `setExtensionPrompt(key, value, position, depth, scan, role, filter)` API. Add diagnostic logging throughout the handler so silent failures become traceable.

Symptoms addressed:

- "I don't see any inject from this app" — the current listener fires silently on the happy path; nothing in the log confirms whether it ran, what language it resolved, how many words it generated, or where it placed the injection.
- `{{words}}` in the user's own prompt is unresolved (out of scope here — tracked separately; the macro is not registered).

## 2. Non-Goals

- **`{{words}}` macro registration.** Putting `{{words}}` directly in a SillyTavern prompt field does nothing today because we never call `SillyTavern.registerMacro` or `SillyTavern.macros.register`. That is a separate subsystem and gets its own design if pursued.
- **Text Completion API support beyond what `GENERATION_AFTER_COMMANDS` already provides.** No per-API branching.
- **UI/UX changes** to the settings panel. Depth, role, custom prompt fields all stay.
- **Test-button behavior changes.** The Test button already calls `generateWords` directly.
- **Synonym feature redesign.** Synonyms just get their own slot via the same mechanism.

## 3. Constraints

- **Fail safe (carried from §9.3 of the prior design).** No code path may throw into SillyTavern's generation pipeline. Every step wrapped in try/catch; broken templates, missing assets, or ST API oddities degrade silently.
- **No engine-layer ST globals (carried from §4 dependency rule).** `engine/injector.js` stays pure compute. ST globals live in `src/index.js`.
- **Zero new runtime dependencies.**
- **Diagnostic logging must be greppable and cheap.** Single `🐰 RRT:` prefix, no per-token spam.

## 4. Architecture

### 4.1 Module responsibility shift

| Module | Before | After |
|---|---|---|
| `src/engine/injector.js` | `onPromptReady(promptData)` mutates `promptData.chat` via splice | `buildInjections(settings, lang, userMessage, chatTexts)` returns `{ random, synonyms }` — pure compute, no ST globals, no mutation |
| `src/index.js` | Wraps `onPromptReady`; handles lazy asset load; wires deps | Adds: imports `setExtensionPrompt`, `extension_prompt_types`, `extension_prompt_roles`; replaces `handlePromptReady` with `handleGeneration`; calls `setExtensionPrompt` per slot |

The engine layer stays pure-compute; ST-aware code stays in `src/index.js`. This matches the existing dependency rule ("Only `src/index.js` and `engine/injector.js` sit at the top of the import graph").

### 4.2 Function contracts

#### `buildInjections(settings, lang, userMessage, chatTexts)` — engine layer

Pure async function. Uses already-injected `deps.words` and `deps.synonyms` (same `__setDepsForTest` seam as today).

```js
// Returns
{
  random: {
    content: "[OOC NARRATIVE OVERDRIVE: ... \"apple\", \"running\", \"serendipity\" ...]",
    depth:   0,                       // settings.randomWords.injectionDepth, bottom-up
    role:    0,                       // mapped: "system" → 0, "user" → 1, "assistant" → 2
  } | null,                           // null when feature disabled or words array empty
  synonyms: {
    content: "[OOC WORD FRESHNESS: ...]",
    depth:   0,
    role:    0,
  } | null,                           // null when feature disabled or no overused words
}
```

Errors during word generation or template rendering are caught internally; the offending slot returns `null` (preserving the current "broken template → prompt unchanged" guarantee, just expressed as "broken slot → slot cleared").

#### `handleGeneration(type, options, dryRun)` — index.js wiring

Replaces `handlePromptReady`. Fires on `GENERATION_AFTER_COMMANDS`. Flow:

```
1. Log entry (prefix 🐰 RRT:) with dryRun flag
2. loadSettings() → rwEnabled, synEnabled booleans
3. Log enabled state
4. If both disabled → clear both slots, log, return
5. Resolve language from last user message; log
6. ensureAssetsForLanguage(resolved) — lazy load on first need; log asset state
   On failure → announceFailure already fires toastr once; clear both slots, return
7. const injections = await buildInjections(settings, lang, userMessage, chatTexts)
8. For each slot:
   - If injections[slot] is non-null → setExtensionPrompt(key, content, IN_CHAT, depth, false, role)
   - Else → setExtensionPrompt(key, '', IN_CHAT, 0)   // clear stale value
   - Log: "🐰 RRT: slot=random action=set contentLen=147 depth=0 role=0"
                            action=clear otherwise
9. Log exit + duration
```

### 4.3 Event registration

```js
eventSource.makeFirst(eventTypes.GENERATION_AFTER_COMMANDS, handleGeneration);
```

`makeFirst` ensures we run before other extensions that hook the same event (matches OpenVault's pattern at `events.js:418`). Drop the `CHAT_COMPLETION_PROMPT_READY` registration entirely.

### 4.4 Slot keys & semantics

| Slot key | Feature | Position | Depth source | Role source |
|---|---|---|---|---|
| `rabbitResponseTeam_random` | randomWords | `IN_CHAT` (1) | `settings.randomWords.injectionDepth` | `settings.randomWords.injectionEndRole` |
| `rabbitResponseTeam_synonym` | synonyms | `IN_CHAT` (1) | `settings.randomWords.injectionDepth` (shared) | `settings.randomWords.injectionEndRole` (shared) |

Role mapping: `{ "system": 0, "user": 1, "assistant": 2 }` → `extension_prompt_roles.{SYSTEM,USER,ASSISTANT}`. Unknown strings default to `SYSTEM` (0) with a warn.

Position is `IN_CHAT` for both so `depth` is honored. `scan` defaults to `false`. No filter function.

### 4.5 Depth semantics — behavior change

**Before:** `injectionDepth` was treated as **index from top** (depth=0 → spliced at chat[0]). This was non-standard.

**After:** `injectionDepth` follows **SillyTavern's standard bottom-up** semantics (depth=0 → bottom of chat, depth=N → N messages up from the bottom). This matches Author's Note, Vectors, Memory, OpenVault, and every other ST injection feature.

This is a user-visible behavior change. Document in CHANGELOG. No code migration on load — the value itself stays valid, only its interpretation changes.

### 4.6 Disabled-state handling — clear-on-every-fire

`setExtensionPrompt` is **persistent across generations**. Once written, the value stays until overwritten. Therefore on every `GENERATION_AFTER_COMMANDS` fire:

- Feature disabled → write `setExtensionPrompt(key, '', IN_CHAT, 0)` to clear.
- Feature enabled but word generation produced empty result → write `''` to clear (don't leave last turn's words).
- Feature enabled with content → write fresh content (last-write-wins, idempotent).

This is the OpenVault pattern (`safeSetExtensionPrompt('', 'openvault')` in their disable branch).

### 4.7 Diagnostic logging

All logs use the prefix `🐰 RRT:` so users can filter the browser console. Concrete log points:

```
🐰 RRT: handleGeneration entry dryRun=false
🐰 RRT: enabled random=true synonyms=false
🐰 RRT: resolved lang=ru (lastUser 84 chars)
🐰 RRT: assets loaded ru=ok
🐰 RRT: generated random=3 words
🐰 RRT: slot=random action=set contentLen=147 depth=0 role=0
🐰 RRT: slot=synonym action=clear
🐰 RRT: handleGeneration exit duration=12ms
```

On error path:

```
🐰 RRT: handleGeneration failed: <Error: ...>
🐰 RRT: handleGeneration exit duration=8ms (failed)
```

Volume: 6-8 lines per generation. Cheap enough to leave on; greppable; enough to reconstruct exactly which branch fired. No per-token or per-word spam.

## 5. Data Flow

```
SillyTavern Generate button
  └─> mainGenerationLoop (script.js)
        └─> emits GENERATION_AFTER_COMMANDS  ← we hook here with makeFirst
              └─> handleGeneration(type, options, dryRun)
                    ├─ loadSettings()
                    ├─ resolveLanguage(lastUser)
                    ├─ ensureAssetsForLanguage(resolved)
                    ├─ buildInjections(settings, lang, userMessage, chatTexts)
                    │     ├─ generateWords(...)            [engine/random-words.js]
                    │     ├─ renderTemplate(customPrompt)  [injector.js, internal]
                    │     └─ findOverusedWords(...)        [engine/synonym-scanner.js]
                    └─ for each slot:
                          setExtensionPrompt(key, content|'', IN_CHAT, depth, false, role)
                            └─ writes to ST's extension_prompts map
                  └─ (we return; ST continues to assemble the prompt)
                        └─ ST reads extension_prompts at assembly time
                              └─ our content becomes a Message at the configured depth/role
```

## 6. Error Handling

Same fail-safe contract as today (§9.3), expressed differently:

| Failure | Behavior |
|---|---|
| Settings missing or corrupt | `loadSettings()` falls back to defaults; both slots cleared |
| Asset fetch fails | One-time `toastr.error` via `announceFailure`; both slots cleared; handler returns |
| `generateWords` throws | `buildInjections` catches; `random` slot returns `null` → cleared |
| Template has unresolved `{{` | `buildInjections` catches; `random` slot returns `null` → cleared |
| `setExtensionPrompt` itself throws | Outer try/catch in `handleGeneration` swallows; logs `🐰 RRT: handleGeneration failed`; ST pipeline unaffected |
| Event bus unavailable at boot | Existing `registerEventListener` warn fires; no slot writes; ST pipeline unaffected |

No path may throw into ST's generation pipeline.

## 7. Testing Strategy

### 7.1 Unit tests — `tests/engine/injector.test.js`

Rewrite the existing 10 tests. Replace all `promptData.chat.length` and `promptData.chat[N].content` assertions with assertions on the `buildInjections` return value:

| Old assertion | New assertion |
|---|---|
| `promptData.chat.length === N+1` | `result.random !== null` (or `=== null` for disabled) |
| `promptData.chat[0].content.includes('"apple"')` | `result.random.content.includes('"apple"')` |
| `promptData.chat[0].role === "system"` | `result.random.role === 0` |
| `promptData.chat[3].content.includes('"apple"')` (depth test) | `result.random.depth === 3` |
| Broken-template test | `result.random === null` AND `warnCalls.length > 0` |
| Empty-words test | `result.random === null` |

The existing test names + scenarios all stay valid; only the assertion targets change. Coverage stays at the same level.

### 7.2 Engine + data + util layers — unchanged

`random-words.test.js`, `synonym-scanner.test.js`, `settings.test.js`, `data/*`, `util/*` all unchanged.

### 7.3 `src/index.js` wiring — manual only

Per AGENTS.md ("UI is manual-only"), the wiring layer is verified by manual smoke test:

1. Enable extension in panel.
2. Open browser console, filter by `🐰 RRT:`.
3. Trigger a Generate.
4. Verify log sequence matches §4.7.
5. Verify ST's prompt debugger (cyan chat tokens) shows the injected message at the expected depth/role.
6. Toggle feature off, Generate again, verify `slot=random action=clear` and the injected message is gone.

## 8. Migration & Compatibility

- **Settings schema**: no change. `schemaVersion` stays 1.
- **Default values**: no change. `randomWords.enabled` and `synonyms.enabled` still default to `false`.
- **Depth semantics**: behavior change — see §4.5. Document in CHANGELOG. Users who relied on depth=0 meaning "top of chat" will need to switch to a higher depth value or use position=IN_PROMPT (future work, not in scope).
- **Role strings**: still accepted as `"system"`/`"user"`/`"assistant"` in settings; mapped to integers at the `setExtensionPrompt` call site.

## 9. Rollout

Single PR. Steps:

1. Refactor `src/engine/injector.js`: replace `onPromptReady` with `buildInjections`. Keep `__setDepsForTest` seam.
2. Rewrite `tests/engine/injector.test.js` to assert on return value.
3. Update `src/index.js`: import ST prompt API, replace handler, switch event hook to `GENERATION_AFTER_COMMANDS` with `makeFirst`, wire slot writes, add diagnostic logging.
4. Run `npm test` — all green.
5. Manual smoke test per §7.3.
6. CHANGELOG entry noting depth-semantics shift.

## 10. Open Questions

None at design-approval time. The macro-registration question (the other root cause from the original bug report) is explicitly deferred to a separate design if pursued.
