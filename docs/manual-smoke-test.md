# Manual Smoke Test — `setExtensionPrompt` Injection

This checklist verifies the SillyTavern wiring layer (`src/index.js`) end-to-end after the switch from `CHAT_COMPLETION_PROMPT_READY` chat mutation to `setExtensionPrompt` via `GENERATION_AFTER_COMMANDS`.

Per `AGENTS.md`, the ST-global wiring layer is not covered by unit tests — pure-function layers are. Use this checklist after any change to `src/index.js` injection wiring.

**References:** `docs/designs/2026-06-16-setextensionprompt-injection.md` §4.7 (log points), §4.5 (depth semantics), §4.6 (clear-on-every-fire).

---

## Setup

1. Install: copy this folder into SillyTavern's `third-party/Rabbit-Response-Team/`.
2. Enable the extension via SillyTavern → Extensions → Rabbit Response Team.
3. Open the browser DevTools console.
4. In the console filter box, type `🐰 RRT:` so only this extension's logs are visible.

## Test 1 — Random words, enabled, default settings

1. In the Rabbit Response Team panel, toggle **Random Words → Enabled** on.
2. Set **Word Count** to `3`, **Mode** to `random`, **Injection Depth** to `0`, **End Role** to `system`.
3. Send any chat message that triggers a Generate.
4. **Expected console log sequence (in order):**
   ```
   🐰 RRT: handleGeneration entry dryRun=false
   🐰 RRT: enabled random=true synonyms=false
   🐰 RRT: resolved lang=en (lastUser <N> chars)
   🐰 RRT: assets loaded en=ok
   🐰 RRT: generated random=3 words
   🐰 RRT: slot=random action=set contentLen=<N> depth=0 role=0
   🐰 RRT: slot=synonym action=clear
   🐰 RRT: handleGeneration exit duration=<N>ms
   ```
5. Open SillyTavern's prompt debugger (the cyan chat tokens view) and confirm a system-role message containing the three quoted words appears at the bottom of the chat (depth=0).
6. The model's response should reference or be nudged by at least one of the three words.

## Test 2 — Toggle feature off → slot cleared

1. From the state above, toggle **Random Words → Enabled** off.
2. Trigger another Generate.
3. **Expected console logs:**
   ```
   🐰 RRT: handleGeneration entry dryRun=false
   🐰 RRT: enabled random=false synonyms=false
   🐰 RRT: slot=random action=clear
   🐰 RRT: slot=synonym action=clear
   🐰 RRT: handleGeneration exit duration=<N>ms
   ```
4. In the prompt debugger, confirm the previously-injected system message is gone — no leftover words from the prior turn.

## Test 3 — Depth semantics (bottom-up)

1. Re-enable Random Words. Set **Injection Depth** to `2`.
2. Set **End Role** to `user`.
3. Trigger a Generate.
4. **Expected log line:** `🐰 RRT: slot=random action=set contentLen=<N> depth=2 role=1`.
5. In the prompt debugger, confirm the injected message sits two messages up from the bottom of the chat (not at the top), with role `user`.

## Test 4 — Synonyms slot enabled

1. Toggle **Synonyms → Enabled** on. Set **Scan Depth** to a value that covers several recent messages and **Min Occurrences** to `2`.
2. Trigger enough turns that some word repeats twice within the scan window, or paste a long user message that repeats a word.
3. **Expected console logs include:**
   ```
   🐰 RRT: enabled random=<true|false> synonyms=true
   ...
   🐰 RRT: slot=synonym action=set contentLen=<N> depth=0 role=0
   ```
4. Confirm the synonym freshness prompt appears in the debugger at depth=0, system role.

## Test 5 — Russian / auto-detect language

1. Set **Language** to `auto`.
2. Send a chat message written entirely in Russian.
3. **Expected log line:** `🐰 RRT: resolved lang=ru (lastUser <N> chars)` followed by `🐰 RRT: assets loaded ru=ok`.
4. Generated words should be Russian-script.

## Test 6 — Fail-safe: broken template does not throw

1. In the **Custom Prompt** field for Random Words, enter a malformed template containing an unclosed `{{` (e.g. `[OOC {{words`).
2. Trigger a Generate.
3. **Expected:** no exception surfaced to SillyTavern; the generate completes normally; logs include:
   ```
   🐰 RRT: slot=random action=clear
   ```
   (broken-template path returns `null` from `buildInjections`, slot is cleared, warn is emitted).
4. Restore a valid custom prompt afterward.

## Test 7 — Test button still works

1. Click the **Test Random Words** button in the panel.
2. **Expected:** a `toastr` toast appears with sampled words. No `setExtensionPrompt` write fires from the button (it calls `generateWords` directly, not the generation handler).

## Test 8 — Synonym overhaul (assistant-only scan, top-N, two modes, Test button)

This test covers the synonym redesign shipped under `docs/designs/2026-06-16-synonym-overhaul.md`.

1. **Chat setup:** open a SillyTavern chat with ≥10 assistant messages (the calibration chat or similar). Skim the chat and identify a word that appears many times in **user** messages — you'll use it as a negative control in step 6.
2. **Defaults check:** in the Rabbit Response Team panel, toggle **Synonyms → Enabled** on and leave the defaults in place — **Scan Depth** `10`, **Min Occurrences** `5`, **Top N** `3`, **Output Mode** `with-suggestions`.
3. **Test Synonyms button:** click the **Test Synonyms** button.
   - **Expected:** a `toastr` toast appears showing 1–3 overused words, each rendered as a row with its synonym suggestions (the `×` separator and ` — try:` suffix present in `with-suggestions` mode).
4. **Output mode toggle — avoid-only:** switch **Output Mode** to `avoid-only`. Click **Test Synonyms** again.
   - **Expected:** the toast still lists the overused words, but **no synonym suggestions** appear and **no ` — try:` trailing separator** is rendered — just the avoidance instruction per word.
5. **Rendered slot inspection:** with Synonyms still enabled, send any chat message that triggers a Generate.
   - **Expected:** in the browser DevTools console, SillyTavern's prompt inspector (or the cyan debugger view) shows the `rabbitResponseTeam_synonym` slot rendered at its configured depth/role (defaults: depth `0`, role `system`).
6. **Assistant-only scan (negative control):** compare the toast from step 3 against the chat. The word you identified in step 1 (heavily repeated by the **user**) must **NOT** appear in the toast — only assistant-side repetitions are flagged. If it does appear, the assistant-only filter is broken.
7. **Independent depth/role:** set **Synonyms → Injection Depth** to `4` and **Random Words → Injection Depth** to `0`. Trigger another Generate.
   - **Expected:** the synonym slot lands at depth `4` (visible via SillyTavern's prompt inspector or devtools) while the random-words slot remains at depth `0`. The two slots' depth/role settings must be fully independent — changing one must not move the other.

---

## Pass Criteria

- All eight tests produce the expected log lines and prompt-debugger state.
- No uncaught exceptions appear in the console (only intentional `warn` calls from the fail-safe path).
- The model's generation is never blocked or interrupted by this extension.
