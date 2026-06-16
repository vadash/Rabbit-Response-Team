# Stemming for synonym matching

**Date:** 2026-06-16
**Status:** Implemented (Tasks 1–6 of `docs/plans/2026-06-16-stemming-synonym-matching.md` complete; Tasks 7–10 pending). Two deviations from the original design were made during Task 6 — see §13 below.
**Overturns (in part):** `docs/designs/2026-06-15-offline-refactor.md` §2 Non-Goals ("No stemming or lemmatization in synonym lookups").

## 1. Problem

The synonym scanner and the random-words picker's contextual mode match chat tokens against `assets/{en,ru}/synonyms.json` keys via raw `Object.prototype.hasOwnProperty` (`src/data/synonyms.js:57`). Tokens are lowercased but otherwise unmodified (`src/engine/synonym-scanner.js:16`, `src/engine/random-words.js:55`). Asset keys are lowercased-but-not-stemmed dictionary headwords.

This produces three classes of legitimate misses:

1. **Russian case system.** `"госпожа"`, `"госпожи"`, `"госпожой"` are three tokens for one lemma; only the headword form (if present in the asset) ever matches.
2. **English regular inflection.** `"apples"`, `"houses"`, `"running"` are common chat tokens; WordNet indexes some `-ing`/`-ed`/`-s` forms but not the bulk of them (~1,285 `-ing`, ~891 `-ed`, ~1,145 `-s` keys out of 18,511 in `assets/en/synonyms.json`).
3. **ё/е asymmetry (existing bug).** `scripts/prep/prep-yarn.js:34` normalizes `ё→е` on every RU asset key at build time (0 keys in the built asset contain `ё`). The runtime tokenizers do not perform the same normalization, so a chat token `"ещё"` never matches the asset key `"еще"`. This is a pure correctness bug, independent of stemming — but any stemming solution must also close it, because a stemmer fed `"ещё"` will not produce the same output as one fed `"еще"`.

The audit also flagged that the runtime tokenizer is duplicated across two engine modules with slightly different regex shapes but equivalent behavior. Any normalization inserted pre-lookup must be applied at both sites or factored into a shared helper.

## 2. Goals

- Collapse inflected forms of a single lemma to one canonical match key, for both EN and RU.
- Apply the *same* normalization at build time (asset keys) and at runtime (chat tokens), with the same algorithm — otherwise the two sides never meet.
- Close the ё/е asymmetry bug as part of the normalization layer.
- Unify the two runtime tokenizers into one shared helper.
- Keep the random-words picker's display output in headword form (no `"госпож"` injected into prompts).

## 3. Non-goals

- **Irregular English verb/noun lemmatization** (`went→go`, `mice→mouse`, `ate→eat`). Porter is purely algorithmic and cannot handle these. Accepted gap; deferred until evidence of real-chat impact.
- **Russian morphological lemmatization** (Az.js or equivalent). Snowball stemming handles the case system adequately for "detect same word" purposes; full lemmatization with case/gender/number metadata is deferred.
- **Stemming `assets/{en,ru}/words.json`.** The word bank drives display output for the random-words picker; stemming it would inject non-words (`"госпож"`) into prompts.
- **Build-time stemming of synonym *values*.** Suggestion lists must stay readable; only keys get stemmed.
- **Per-call normalization inside `src/data/synonyms.js`.** Callers already know `lang`; pushing normalization there would force `lang` plumbing through the data-layer API and break the existing test seam.

## 4. Decisions (from brainstorm session)

1. **Algorithms:** Porter (EN) + Snowball RU. Accept the Porter irregular-verb gap.
2. **Vendor source:** Pull from npm devDependencies via a new `scripts/vendor-stemmers.js` step. Do **not** use esm.sh `?bundle` — URLs are unstable, transforms are uncontrolled, and the canonical implementations are already available as plain ESM.
3. **Scope:** Scanner + random-words picker. Both consume the new normalizer and the new unified tokenizer. Word bank untouched.
4. **Normalize-layer shape:** New `src/util/normalize.js` exposes `normalize(word, lang)`. The full chain — `toLowerCase → trim → ё→е (RU only) → stem(lang)` — lives behind that single function. Both build scripts and runtime import it.
5. **Collision policy:** When stemming collapses two distinct headwords to one stem at build time, union the `s[]` and `a[]` lists with dedupe-by-first-seen. Downstream `SUGGESTION_CAP = 2` (`src/engine/synonym-scanner.js:8`) truncates any noise.
6. **Fixed-point iteration (added during Task 6, see §13):** `normalize` applies the stemmer repeatedly until output stabilises (max 8 iterations). Porter and Snowball are not idempotent on their own output — e.g. RU `"сказал" → "сказа" → "сказ"`, EN `"houses" → "hous" → "hou"`. Without iteration, the asset verifier's stem-key invariant (`key === normalize(key, lang)`) is unsatisfiable, and runtime token lookup would miss build-time keys by one stem step.

## 5. Architecture

```
src/util/
├── normalize.js     ← NEW: normalize(word, lang) → stem key
├── tokenize.js      ← NEW: extractTokens(text) → string[]
├── porter.js        ← VENDORED: ~5KB, license header, @vendored-from marker
└── snowball-ru.js   ← VENDORED: ~30KB, license header, @vendored-from marker

scripts/
├── vendor-stemmers.js  ← NEW: reads node_modules, emits vendored files
└── lib/
    └── stemmer.js      ← NEW: re-export of src/util/normalize.js for build scripts
```

**Dependency rule preserved:** `util/` is leaf-level — `engine/` and `data/` may import it; `util/` imports nothing project-local. Build scripts import `src/util/normalize.js` via relative path (through `scripts/lib/stemmer.js` so there's one seam).

## 6. Module contracts

### `src/util/normalize.js`

```js
/**
 * Reduce a raw token to its canonical match key.
 * Pipeline: toLowerCase → trim → ё→е (RU only) → stem(lang) iterated to fixed point.
 * Non-string or empty input returns "" (never matches any key).
 * Output is idempotent: normalize(x) === normalize(normalize(x)).
 */
export function normalize(word, lang) → string
```

- `lang === "en"` → Porter stemmer, iterated until output stabilises (≤8 iterations).
- `lang === "ru"` → Snowball RU stemmer (with `ё→е` applied first), iterated until output stabilises.
- Any other `lang` → lowercased+trimmed word with no stemming. Defensive; should not occur given `resolveLanguage` only returns `"en"` or `"ru"`.

**Why iterated (added Task 6 — see §13):** Porter and Snowball are not idempotent on their own output. A single application leaves keys that fail `key === normalize(key, lang)`, breaking both the asset verifier invariant and runtime-vs-build lookup parity.

### `src/util/tokenize.js`

```js
export function extractTokens(text) → string[]
```

Unified regex, behavior identical to the current `src/engine/synonym-scanner.js:16` tokenizer. Replaces both that regex and the duplicate at `src/engine/random-words.js:55`.

### `scripts/lib/stemmer.js`

Re-exports `normalize` from `../../src/util/normalize.js`. Build scripts import from here, never from `src/util/` directly — single seam if the path ever moves.

### `scripts/vendor-stemmers.js`

- Reads `node_modules/porter-stemmer/` and `node_modules/snowball-stemmer.jsx/` (or chosen equivalents — package selection confirmed at implementation time against npm availability and ESM-friendliness).
- Emits `src/util/porter.js` and `src/util/snowball-ru.js` with a header comment preserving license/attribution and a `// @vendored-from: <pkg>@<version>` marker.
- Wired into `npm run build` as a prerequisite step, before `scripts/build_assets.js`.
- Idempotent: re-running with the same input versions produces byte-identical output.
- Exits non-zero with a clear message if `node_modules` is missing, rather than silently shipping an un-stemmed asset.

## 7. Build-pipeline changes

**`scripts/build_assets.js` — synonyms emit (lines ~156–184):**

1. Build the raw `{word: {s, a}}` map as today.
2. For every key, compute `stemmedKey = normalize(word, lang)`.
3. Merge entries that collide on `stemmedKey`: union `s` arrays, union `a` arrays, dedupe each by first-seen.
4. Write `assets/{lang}/synonyms.json` keyed by stemmed form.

**`scripts/build_assets.js` — words emit:** unchanged. `words.json` keeps headword keys.

**`scripts/prep/prep-yarn.js:34` ё→е step:** kept (idempotent; defense-in-depth for any future maintainer who skips the new normalizer).

**`scripts/verify_assets.js`:** two checks touch the synonym/word linkage:
- **New (Task 6):** every key in `synonyms.json` must equal `normalize(key, lang)`. Catches drift if someone hand-edits the asset. Works because `normalize` is now iterated to a fixed point (§4.6, §13.3).
- **Relaxed (Task 6, see §13.2):** the pre-existing check (d) "every synonym key must exist in `words.json`" now compares via `normalize()`: a synonym key (a stem) must equal `normalize(headword, lang)` for some headword in `words.json`. Required because Task 5 deliberately leaves `words.json` in headword form while `synonyms.json` keys are stems.

## 8. Runtime changes

**`src/engine/synonym-scanner.js`:**
- Remove local `tokenize` (lines 14–18). Import `extractTokens` from `src/util/tokenize.js`.
- At the `hasEntry` call (line 63): `hasEntry(lang, normalize(token, lang))` instead of `hasEntry(lang, token)`.
- Same wrapping for the subsequent `getSynonyms` call.

**`src/engine/random-words.js`:**
- Remove the duplicate tokenizer (lines 53–55). Import `extractTokens`.
- In `runContextual` (line 121+): `normalize` candidate tokens before `hasEntry`/`getAssociations`.
- `runRandom` and `runDoublePass`: no change — they sample from the word bank, which stays in headword form.

**`src/data/synonyms.js`:** unchanged. `hasEntry`/`getSynonyms`/`getAssociations` keep raw key access. The caller is now responsible for normalizing.

## 9. Error handling

- Stemmers are pure functions; the only failure mode is non-string input. `normalize` returns `""` for non-strings, which never matches any key (`hasEntry("")` → `false`). No throw, no log — consistent with the project's "fail safe, no throw into ST's prompt pipeline" rule.
- Vendor-step failure: `scripts/vendor-stemmers.js` exits non-zero with a clear message before `build_assets.js` runs. Build aborts rather than shipping an un-stemmed asset silently.

## 10. Testing strategy

**New unit tests:**
- `tests/util/normalize.test.js` — EN/RU/unknown-lang branches, ё→е, empty input, non-string input. Includes the user's original motivating example: `normalize("госпожа", "ru") === normalize("госпожой", "ru")`.
- `tests/util/tokenize.test.js` — port the implicit contract from `synonym-scanner.test.js`; add the apostrophe/hyphen/emoji cases the audit flagged as missing.
- `tests/scripts/vendor-stemmers.test.js` — idempotency (run twice → same bytes), header presence, version-pin marker check.

**Updated tests:**
- `tests/engine/synonym-scanner.test.js` — add cases: `"apples"` matches an `"apple"`-stemmed fixture key; `"госпожой"` matches `"госпожа"`-stemmed fixture; `"ещё"` matches `"еще"` fixture.
- `tests/engine/random-words.test.js` — `runContextual` with an inflected user-message token resolves to a stemmed fixture key.
- `tests/scripts/verify_assets.test.js` — add the stem-key invariant check.
- Test fixtures (`tests/fixtures/mini-en-synonyms.json`, `mini-ru-synonyms.json`) get re-stemmed; expected suggestion lists for colliding keys reflect union+dedupe.

**Manual smoke test:** update the existing smoke-test checklist to verify in ST that typing inflected RU/EN words in chat triggers the synonym prompt as expected.

## 11. Migration

- Asset rebuild on first `npm run build` after merge. No user-facing migration needed — assets are bundled, not user state.
- `extension_settings` schema unchanged. `schemaVersion` stays at 1.
- Legacy `extension_settings.randomWords` / `.synonyms` migration path (`src/settings.js → migrate`) is unaffected.

## 12. Deferred follow-ups

- **Irregular EN verb/noun lemmatization.** Address only with real-chat evidence (e.g. a sample chat log showing repeated `"went"`/`"was"`/`"mice"` misses). Likely fix: tiny curated exception map layered before Porter, or swap to `compromise.js` (~250KB).
- **Russian lemmatization** (Az.js) for cases where Snowball over-collapses distinct lemmas to the same stem. Same trigger: evidence first.

## 13. Implementation deviations (recorded 2026-06-16, after Task 6)

Three issues surfaced during Task 6's end-to-end `npm run build && npm run verify` step that the original plan did not anticipate. All three were resolved in commit `3e02759` ("feat(scripts): verify synonyms.json keys are stemmed") as part of Task 6, broadening its scope. Future maintainers and executors of Tasks 7–10 must read this section.

### 13.1 Built assets were stale after Task 5

Task 5 modified `scripts/build_assets.js` and `scripts/lib/stemmer.js` but did **not** re-run `npm run build` and re-commit `assets/{en,ru}/synonyms.json`. The committed assets still contained headword keys. Task 6 rebuilt them; the rebuilt assets now contain fixed-point stems.

### 13.2 Verify check (d) was incompatible with stemmed synonym keys

The pre-existing check (d) asserted "every synonym key must exist in `words.json`". Task 5 deliberately leaves `words.json` in headword form (Task 5 step 3: "Leave the `words.json` emit path untouched") while stemming `synonyms.json` keys. These two invariants are mutually exclusive. Check (d) now builds a set of `normalize(headword, lang)` stems from `words.json` and asserts each synonym key is in that set. Error message: `"${lang}/synonyms.json: key \"${word}\" not found in words.json (nor its stem)"`.

### 13.3 The stemmer is not idempotent — `normalize` now iterates to a fixed point

Porter (EN) and Snowball (RU) do not satisfy `stem(stem(x)) === stem(x)`:
- RU: `normalize("сказал", "ru") → "сказа"`, but `normalize("сказа", "ru") → "сказ"`. ~4,547 of 15,849 keys affected.
- EN: `normalize("houses", "en") → "hous"`, but `normalize("hous", "en") → "hou"`. ~520 of 14,689 keys affected.

The plan's Task 6 invariant `key === normalize(key, lang)` is unsatisfiable as written. `normalize` (in `src/util/normalize.js`) now iterates the stemmer until output stabilises, with a safety cap of 8 iterations. This makes `normalize` idempotent: `normalize(x) === normalize(normalize(x))`. The invariant now holds.

**Implication for runtime (Tasks 7, 8):** chat tokens also go through `normalize` at lookup time, so a chat token `"сказал"` resolves to `"сказ"` — the same key the build emits. Without fixed-point iteration, runtime would have produced `"сказа"` and missed every multi-step-stemmed asset key. Task 7/8 executors can rely on this.

**Implication for Task 9 fixture work:** the plan's step 2 ("compute `normalize(key, lang)` using the actual function, do not hand-compute") now produces fixed-point stems automatically. Callers should not be surprised that some stems look aggressive (e.g. `"houses" → "hou"`, `"госпожой → госпож"`, `"сказал → сказал → сказ"`). Trust the function output; the verifier has already validated the same invariant against the real assets.

### 13.4 Test (h) in `tests/scripts/verify_assets.test.js` was rewritten

The original test (h) "clean synthetic assets under `tests/fixtures` pass" iterated `tests/fixtures/mini-{en,ru}-synonyms.json`. After Task 5, those fixtures still use headword keys and would fail the new stem invariant. Rather than re-stem fixtures mid-Task-6 (Task 9's job), test (h) was rewritten to use an in-memory synthetic tree with already-stemmed keys, asserting only that no stem-invariant error fires. Task 9 may optionally restore the fixture-based form once fixtures are re-stemmed.

### 13.5 Debug logging added

- `DEBUG_VERIFY=1` → `scripts/verify_assets.js` prints per-step stderr: `[verify] start`, per-lang `words.json` stem count, stem-invariant scan progress at 10% intervals, full offender list (≤50), `[verify] done` summary.
- `DEBUG_BUILD=1` → `scripts/build_assets.js` prints sample merged-collision entries in the stem-merge step. Default build log now also reports input-headword vs output-stem count and the collision delta.

