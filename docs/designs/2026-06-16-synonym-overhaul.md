# Synonym feature overhaul

**Date:** 2026-06-16
**Status:** Proposed
**Supersedes (in part):** `docs/designs/2026-06-15-offline-refactor.md` §8.4 (synonym scanner), `docs/designs/2026-06-16-setextensionprompt-injection.md` §3 (synonym slot).

## 1. Problem

The current synonym feature has four rough edges, three of which actively degrade output quality:

1. **Role-blind scan.** `findOverusedWords` receives the full chat array (user + assistant interleaved) and counts every token. User-side text — including OOC notes, persona text, author's notes — contributes to "overuse." The model gets told to avoid words the *user* repeats, not words *it* repeats.
2. **Wrong word surfaced.** `src/engine/injector.js:105` renders `overused[0]` — insertion order from the underlying `Map`, not the most frequent word. Even when five words cross threshold, only one is rendered, and it's often not the most overused.
3. **Threshold too low.** Calibration against a real 21-message assistant chat (`scripts/calibrate_synonyms.js`, run against `R:\downloads\Zoe - 2026-05-27@17h35m17s574ms.jsonl`) shows median **177 words** cross `minOccurrences >= 3` in a 10-message assistant window after stopword filtering. The `hasEntry` check trims this further, but the threshold is still too permissive to surface meaningfully-overused words.
4. **Borrowed injection settings.** Synonym slot reuses `randomWords.injectionDepth` / `injectionEndRole`. Users cannot position the two slots independently.

## 2. Goals

- Scan **assistant messages only** (`is_user === false`), per Q1 answer — keep system/narrator messages in for v1.
- Surface **top N words by frequency**, ranked descending, with N user-configurable.
- Offer two **output modes** as a radio toggle: avoid-only, and avoid-with-synonyms.
- Provide **independent depth/role** settings for the synonym slot.
- Provide a **Test button** in the UI that renders the actual prompt against the current chat.
- Calibrate sensible defaults from real data.

## 3. Non-goals

- Token-budget windows (would require an offline tokenizer — out of scope).
- "Surprise score" ranking relative to baseline corpus frequency (YAGNI for v1).
- Scanning system/narrator messages separately, or excluding them — deferred (Q1 answer explicitly keeps them in).
- Per-message-type thresholds (one threshold covers all assistant messages).

## 4. Calibration findings

Script: `scripts/calibrate_synonyms.js`. Sample: 21 assistant messages from a real ERP chat (the only large sample available). Method: sliding windows across the chat, with the production stopword filter applied.

| Window | `minOcc >= 3` median | `minOcc >= 5` median | `minOcc >= 8` median |
|---|---|---|---|
| 5 msgs  | 85  | 42  | (not measured) |
| 10 msgs | 177 | 81  | (not measured) |
| 15 msgs | 266 | 127 | (not measured) |
| 20 msgs | 372 | 179 | (not measured) |

**Top-N word frequency in a 10-message window:**

| Rank | Median count |
|---|---|
| Top 3 | 30 |
| Top 5 | 21 |
| Top 8 | 20 |

**Conclusion:** with `minOccurrences: 5` in a 10-message window, ~80 candidate words survive the stopword filter before the `hasEntry` check. After `hasEntry` trims to top-20K dictionary words, ~10–30 typically remain — enough to fill a top-3 meaningfully without flooding the prompt. Top-3 words have frequencies in the 25–35 range, well above any reasonable threshold.

**Sample caveat:** n=21 messages, single chat, single genre. Numbers are directional, not statistically robust. Defaults can be re-tuned as more chats become available — the calibration script ships with the repo for that purpose.

## 5. Design

### 5.1 Settings schema changes

`extension_settings.rabbitResponseTeam.synonyms` gains three fields and loses none. Current fields preserved for back-compat.

**Before:**
```js
synonyms: {
  enabled: false,
  scanDepth: 6,
  minOccurrences: 3,
  customPrompt: DEFAULT_SYNONYM_PROMPT,
}
```

**After:**
```js
synonyms: {
  enabled: false,
  scanDepth: 10,                 // assistant messages (was 6, mixed)
  minOccurrences: 5,             // was 3
  topN: 3,                       // NEW — 1..8
  outputMode: "with-suggestions", // NEW — "avoid-only" | "with-suggestions"
  customPrompt: DEFAULT_SYNONYM_PROMPT,  // kept; only used in "with-suggestions" mode
  injectionDepth: 0,             // NEW — independent from randomWords
  injectionEndRole: "system",    // NEW — independent from randomWords
}
```

`schemaVersion` stays at `1` — the migration in `settings.js` already does `mergeDeep(defaults, slot)`, so missing fields are filled from defaults without an explicit bump. Legacy fields (`scanDepth`, `minOccurrences`, `customPrompt`) are preserved if the user customized them; new fields default to the values above.

**Migration behavior:** `loadSettings()` already merges defaults into stored settings via `mergeDeep`. No new migration code needed. Existing users with `scanDepth: 6` keep `6` — they opt into `10` by resetting or editing the slider. This is fine: the goal is sensible defaults for new installs, not forced re-tuning.

### 5.2 Scanner changes — `src/engine/synonym-scanner.js`

Signature unchanged: `findOverusedWords(chatHistory, lang, settings, opts)`. Internal changes:

1. **Sort by frequency descending.** Current loop iterates `counts` in insertion order and pushes everything that passes filters. Change to collect all candidates, then `sort((a, b) => b.count - a.count)` before returning.
2. **Apply `topN` cap.** After sorting, `result.slice(0, topN)`.
3. **Tiebreaker.** When two words have equal `count`, fall back to alphabetical (deterministic) so test output is stable.

The `chatHistory` parameter remains a `string[]` — the role filtering happens at the call site in `src/index.js` (see §5.4). This keeps the scanner pure and testable with plain string arrays.

### 5.3 Injector changes — `src/engine/injector.js`

Replace the single-word rendering block (`injector.js:99–116`) with:

1. Call `findOverusedWords(...)` — already sorted + capped by the scanner.
2. If empty → `synonymsSlot = null`.
3. Branch on `syn.outputMode`:
   - `"avoid-only"` → render a new template `DEFAULT_SYNONYM_PROMPT_AVOID` with `{{words}}` (the bare word list).
   - `"with-suggestions"` → render the existing `customPrompt` once per word? **No** — render once with two interpolated lists: `{{words}}` and `{{suggestions}}`. See §5.4 of *this* doc (template format) for the shape.
4. Build the slot descriptor with `depth`/`role` from `syn.injectionDepth`/`syn.injectionEndRole` (not `rw.*`).

**Template format — "with-suggestions" multi-word:**

The current template uses `{{originalWord}}` (singular) and `{{synonyms}}`. We need a multi-word shape. Two options considered:

- **Option A — single template, list-flattened vars.** Keep one template string; interpolate `{{words}}` with `"smile", "nod", "softly"` and `{{suggestions}}` with `"grin/beam, tilt/gesture, quietly/gently"` (paired per word, slash-separated within a pair, comma-separated across pairs). Compact but the per-word pairing is ugly.
- **Option B — per-row template + joiner.** A `customPromptRow` template rendered once per word (`"{{originalWord}} (try: {{synonyms}})"`), joined by a configurable separator into the outer `customPrompt`. More moving parts, but cleaner output and easier for users to customize.

**Recommendation: Option B.** Adds one extra template field but the result reads naturally and users can edit either layer. Shape:

```js
synonyms: {
  customPrompt: DEFAULT_SYNONYM_PROMPT,       // outer wrapper
  customPromptRow: DEFAULT_SYNONYM_PROMPT_ROW, // per-word line
}
```

Defaults:

```
DEFAULT_SYNONYM_PROMPT =
  "[OOC WORD FRESHNESS: The following words have been used frequently. " +
  "Avoid reusing them; vary your vocabulary.\n{{rows}}]"

DEFAULT_SYNONYM_PROMPT_ROW =
  "- \"{{originalWord}}\" ({{count}}×) — try: {{synonyms}}"

DEFAULT_SYNONYM_PROMPT_AVOID =
  "[OOC WORD FRESHNESS: The following words have been used frequently. " +
  "Avoid reusing them; vary your vocabulary.\n{{rows}}]"
```

For `outputMode: "avoid-only"`, rows are rendered as `- "{{originalWord}}" ({{count}}×)` — i.e., the row template is **not** used; a hardcoded avoid-row format is applied. This keeps the avoid-mode prompt intentionally simpler and not user-editable per-row (YAGNI; if power users want avoid-mode customization they can switch to with-suggestions and zero out the synonyms).

Actually — simpler: one `customPromptRow` template that includes the synonym portion, and `outputMode: "avoid-only"` simply renders the row template with `{{synonyms}}` replaced by empty string. Then the user can edit either mode from a single template. Reconsidering...

**Final decision: single `customPromptRow` template, used by both modes.** In avoid-only mode, `{{synonyms}}` resolves to empty string; the default row template trims trailing punctuation when synonyms are empty. This avoids template duplication and keeps the UI to: outer prompt + row prompt + mode toggle. Implementation detail: the renderer checks `synonyms === ""` and strips trailing `" — try:"` if present, OR the default row template reads `- "{{originalWord}}" ({{count}}×){{#if synonyms}} — try: {{synonyms}}{{/if}}` — but we don't have a conditional templating engine. Simplest: hardcode the dash-trimming in the renderer. It's a one-liner.

### 5.4 Call-site changes — `src/index.js`

Currently (`src/index.js:179–187`):
```js
const chatTexts = (ctxChat ?? []).map((m) => m?.mes ?? m?.content ?? '');
```

Change to:
```js
const chatTexts = (ctxChat ?? [])
  .filter((m) => m && m.is_user === false)
  .map((m) => m?.mes ?? m?.content ?? '');
```

This excludes user messages, keeps system/narrator messages (per Q1).

The `slice(-scanDepth)` still happens inside the scanner — `scanDepth` now means "last N assistant messages," not "last N mixed messages," because the input array is already assistant-only.

### 5.5 UI changes — `src/ui/panel.js` + `src/ui/templates.js`

Add to the synonyms settings block:

- **Slider:** "Scan depth (assistant messages)" — range 1..30, step 1, default 10.
- **Slider:** "Minimum occurrences" — range 2..20, step 1, default 5.
- **Slider:** "Top N words" — range 1..8, step 1, default 3.
- **Radio toggle:** "Output mode" — `Avoid only` / `Avoid with suggestions`.
- **Slider:** "Injection depth" — same range as random-words depth slider.
- **Select:** "Injection role" — same options as random-words role select.
- **Textareas:** two — outer `customPrompt` and per-row `customPromptRow`. Reset-to-default buttons next to each (matches existing pattern for the random-words prompt).
- **Button:** "Test Synonyms" — renders the prompt against the current chat and shows it in a `toastr` (or modal — see §5.6).

### 5.6 Test button behavior

Per Q4 answer: **show the rendered prompt string** against **current chat history**. No fallback to fixtures — if the chat is too short or no words cross threshold, the toast says exactly that (`"Synonym scan: no overused words found in the last N assistant messages."`). Honest output trumps demo-quality output.

Implementation: the Test button calls a new engine entry point `buildSynonymsPreview(settings, lang, chatTexts)` (exported from `src/engine/injector.js` or a new `src/engine/synonym-preview.js`) that runs the same scan + render pipeline as production but returns the string instead of writing to a slot. This keeps the UI → engine dependency at one function (matches the existing `generateWords` injection pattern).

**Toastr vs modal:** the rendered prompt can be 200–400 chars with top-3 multi-line output. `toastr` is OK for short v1; if it feels cramped we promote to a modal in a follow-up. v1 ships with `toastr`.

### 5.7 Error handling

No change to the existing fail-safe pattern (`try/catch` around the whole synonyms branch in `buildInjections`, swallow + warn). The new code paths (sort, slice, multi-template render) all sit inside the same `try`. Template rendering still throws on unresolved `{{`, still caught upstream.

## 6. Testing strategy

### 6.1 Unit tests — `tests/engine/synonym-scanner.test.js`

Extend existing suite. New cases:

- **Sorts by frequency descending** — input with known frequencies, assert output order.
- **Tiebreaker is alphabetical** — two words with equal count, deterministic order.
- **`topN` cap respected** — scanner returns at most N entries when more are eligible.
- **`topN` larger than candidate pool** — returns all candidates, no padding.
- **`topN` field missing from settings** — falls back to a sane default (e.g., 3).

### 6.2 Unit tests — `tests/engine/injector.test.js`

- **Avoid-only mode** renders the avoid template, no `{{synonyms}}` interpolation needed.
- **With-suggestions mode** renders rows, one per word.
- **Empty scan result** → `synonymsSlot === null`.
- **Multiple words** → all rendered, not just first.
- **Independent depth/role** — synonym slot uses `syn.injectionDepth`, not `rw.injectionDepth`.

### 6.3 Unit tests — `tests/ui/panel.test.js` (new or extended)

- Test button click invokes the preview function with current chat.
- Radio toggle changes `outputMode` in saved settings.
- Sliders persist numeric values.

### 6.4 Manual smoke test

Add to the existing manual checklist (already in the repo):

1. Open a chat with ≥10 assistant turns.
2. Enable synonyms, default settings.
3. Click "Test Synonyms" — verify rendered prompt shows top-3 words from recent assistant messages.
4. Switch to avoid-only mode — verify suggestions disappear.
5. Send a message — verify slot content visible in browser devtools (setExtensionPrompt state).
6. Verify user-repeated words are NOT flagged.

## 7. Rollout

Single PR. No feature flag — the schema migration is additive (new fields default sensibly, existing fields preserved). Users with customized `scanDepth` / `minOccurrences` keep their values; only new installs get the calibrated defaults.

## 8. Open questions

None blocking. Two minor decisions deferred to implementation:

- Whether the "Test Synonyms" output goes to `toastr` (v1 plan) or a small modal (cleaner for long prompts). Decide after seeing real output length.
- Whether to expose `customPromptRow` in the UI at v1 (current plan: yes) or hardcode the row format (simpler UI, less flexible). Lean toward exposing — power users will want it.

## 9. Artifacts

- `scripts/calibrate_synonyms.js` — committed alongside the design. Lets anyone re-run the calibration on their own chat exports to argue for different defaults.
- This design doc.
