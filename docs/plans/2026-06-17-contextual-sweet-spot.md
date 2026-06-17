# Contextual Anchor Sweet-Spot Selection — Implementation Plan

**Goal:** Make `runContextual` pick anchor words from a rank sweet spot (1,000–15,000) instead of most-frequent-first, for more vivid and thematically coherent word injections. Layered fallback preserves reliability for short/simple messages.

**Testing Conventions:** Tests use `node:test` with `node:assert/strict`. Data modules are injected via the `opts.words` / `opts.synonyms` stub pattern — tests never touch real assets. Fixtures live under `tests/fixtures/` as JSON. The `stemKeyedSynonymsStub` helper re-keys headword-keyed maps through `normalize()` to match the build-pipeline-emitted stem keys. Run tests with `npm test`.

---

### Task 1: Add sweet-spot constants and refactor `runContextual` anchor selection

**Objective:** Replace the current most-frequent-first anchor selection in `runContextual` with sweet-spot-first + random-within-sweet-spot + layered fallback logic. Add `SWEET_SPOT_MIN` and `SWEET_SPOT_MAX` as module-scope constants.

**Files to modify:**
- `src/engine/random-words.js` — add constants at module top (after imports, before `posList`); replace the body of `runContextual` (lines 120–169) with the sweet-spot selection algorithm.

**Instructions for Execution Agent:**

1. **Read current state:** Read `src/engine/random-words.js` lines 1–60 and 120–170 to understand the existing structure and the `runContextual` function body.

2. **Add constants:** After the `import { normalize }` line (line 13), add:
   ```js
   const SWEET_SPOT_MIN = 1000;
   const SWEET_SPOT_MAX = 15000;
   ```

3. **Refactor `runContextual`:** Replace lines 127–169 (the body after the `if (wordCount <= 0) return []` guard) with the following logic. Keep the function signature, the `rw`/`wordCount` extraction, the `tokenize()` call, and the final association-lookup block (lines 159–169) unchanged. Only the middle section — candidate gathering + anchor selection — changes:

   - **Candidate gathering (replaces lines 129–138):** Build a `candidates` array of `{word, rank}` for tokens that are both in the word bank AND have a synonym entry (checked via `synonyms.hasEntry(lang, normalize(t, lang))`). This pre-filters to only viable anchors, avoiding the old two-pass pattern (gather all, then walk looking for entries).
   - **Empty candidates guard (replaces the old "walk and pick first" loop):** If `candidates.length === 0`, warn and fall back to `runRandom` (unchanged behavior).
   - **Sweet-spot split:** `const sweetSpot = candidates.filter(c => c.rank >= SWEET_SPOT_MIN && c.rank <= SWEET_SPOT_MAX);`
   - **Anchor selection:**
     - If `sweetSpot.length > 0`: pick `sweetSpot[Math.floor(Math.random() * sweetSpot.length)].word`
     - Else: sort `candidates` ascending by rank, pick `candidates[0].word`

4. **Preserve the association-lookup tail:** Lines 159–169 (blacklist, history, `getAssociations`, `sampleWithoutReplacement`) remain unchanged. The `chosen` variable is still a string; the tail doesn't care how it was selected.

5. **Run existing tests:** `npm test` — the existing contextual tests will fail because they expect most-frequent-first behavior (e.g., "apple" at rank 100 is chosen). This is expected; Task 2 will update them.

---

### Task 2: Update existing contextual tests and add new sweet-spot tests

**Objective:** Update the existing contextual-mode tests that assume most-frequent-first behavior, and add new tests covering sweet-spot selection, fallback, and random-within-sweet-spot behavior.

**Files to modify:**
- `tests/engine/random-words.test.js` — update existing tests in the "contextual mode" describe block (lines 283–350); add new tests to the same block and/or a new "contextual sweet-spot" describe block.
- `tests/fixtures/mini-en-words.json` — add fixture entries in the sweet-spot range (ranks 1,000–15,000) with synonym entries, so sweet-spot tests have data to exercise against.
- `tests/fixtures/mini-en-synonyms.json` — add synonym entries for the new sweet-spot fixture words.

**Instructions for Execution Agent:**

1. **Read current state:** Read `tests/engine/random-words.test.js` lines 283–350 (existing contextual tests) and `tests/fixtures/mini-en-words.json`, `tests/fixtures/mini-en-synonyms.json`.

2. **Add sweet-spot fixture entries:** The current EN fixture has ranks 10–9500 but nothing in the 1000–15000 sweet spot that also has synonym entries. Add to `mini-en-words.json`:
   - `["castle", "n", 5000]` — a sweet-spot noun
   - `["whisper", "v", 6000]` — already exists at 9500, but add a second entry at e.g. `["murmur", "v", 3000]` for variety
   - `["gentle", "a", 4000]` — already exists at 8400, fine

   Add corresponding entries to `mini-en-synonyms.json`:
   - `"castl": { "a": ["tower", "knight", "siege"] }` — stem of "castle" via Porter
   - `"murmur": { "a": ["whisper", "hush"] }` — already exists as "whisper" at 9500; add "murmur" as a separate headword

   Verify stems by running `node -e "import { normalize } from './src/util/normalize.js'; console.log(normalize('castle','en')); console.log(normalize('murmur','en'));"` to get the correct stem keys.

3. **Update existing test "uses associations of the highest-rank keyword with an entry":** This test currently sends "I ate an apple today" and expects apple's associations. "apple" has rank 100 — outside the sweet spot. The test still works via the fallback path, but the assertion comment is now misleading. Update the test name to `"falls back to most-frequent-first when no sweet-spot candidates exist"` and add a comment explaining the fallback path is exercised.

4. **Add new test "prefers sweet-spot anchor over a more frequent non-sweet-spot token":** Send a message containing both "apple" (rank 100, no sweet spot) and "castle" (rank 5000, sweet spot). Verify the returned words are from castle's associations (`tower`, `knight`, `siege`), not apple's.

5. **Add new test "picks randomly among multiple sweet-spot candidates":** Send a message containing "castle" and "murmur" (both in sweet spot). Mock `Math.random` to return a deterministic value, verify the expected anchor is chosen. Run multiple times with different mock values to prove randomness.

6. **Add new test "sweet-spot constants are exported or accessible":** Verify `SWEET_SPOT_MIN` and `SWEET_SPOT_MAX` are numbers in the expected range. Since they're module-scope `const`, they aren't exported — instead, test them indirectly: call `generateWords` with a message containing only a rank-5000 word and verify it's selected (proving the sweet spot is active), then with a rank-50 word and verify fallback behavior. This avoids adding an export just for testing.

7. **Run tests:** `npm test` — all contextual-mode tests should pass, including the updated and new ones.

---

### Task 3: Verify no regressions in other modes and full suite

**Objective:** Confirm the change to `runContextual` does not affect `runRandom` or `runDoublePass` behavior, and the full test suite passes.

**Files to inspect (read-only):**
- `src/engine/random-words.js` — verify the refactored `runContextual` and untouched `runRandom`/`runDoublePass`
- `tests/engine/random-words.test.js` — verify the regression-guard tests at lines 520–562 still exist

**Instructions for Execution Agent:**

1. **Read final state of `src/engine/random-words.js`:** Verify `runRandom` (starts ~line 59) and `runDoublePass` (starts after `runContextual`) are unchanged. Only `runContextual` body and the two new constants should differ from the pre-change state.

2. **Run full test suite:** `npm test` — all tests must pass, including:
   - "runRandom returns bank headwords verbatim (no stem transformation)"
   - "runDoublePass samples raw bank headwords as anchors (no stem transformation)"
   - All Russian contextual tests
   - All inflected-token tests
   - All new sweet-spot tests

3. **Commit:** Commit with message:
   ```
   feat(contextual): prefer sweet-spot anchors over most-frequent-first

   Select contextual-mode anchor words from rank range [1000, 15000]
   (evocative nouns/adjectives) instead of walking most-frequent-first.
   Randomly sample within the sweet spot for variety across regenerations.
   Fall back to most-frequent-first when the message contains no sweet-spot
   words, preserving reliability for short messages.
   ```
