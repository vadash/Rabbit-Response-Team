# Stemming for Synonym Matching — Implementation Plan

**Goal:** Add Porter (EN) + Snowball RU stemming behind a shared `normalize()` module used by both the build pipeline (asset keys) and the runtime (scanner + random-words picker), closing the existing ё/е asymmetry bug as a side effect.

**Design doc:** `docs/designs/2026-06-16-stemming-synonym-matching.md` — **read §13 "Implementation deviations" before starting Tasks 7–10.** It records three deviations made during Task 6 that affect downstream tasks.

**Testing conventions:** `node:test` + `node:assert/strict`. Fixtures loaded via `readFileSync(fileURLToPath(new URL("../fixtures/...", import.meta.url)))`. Module dependencies injected via `opts` (scanner) or `__setDepsForTest` (data/engine modules) so unit tests never touch the real bundled assets. Run with `npm test` (which expands `tests/**/*.test.js`).

## ⚠ Deviations from original plan (recorded after Task 6, commit `3e02759`)

Tasks 1–6 are complete. Task 6 uncovered three plan-level issues and resolved them by broadening Task 6's scope. Future executors must read `docs/designs/2026-06-16-stemming-synonym-matching.md` §13 in full. Quick summary:

1. **`normalize` now iterates the stemmer to a fixed point** (≤8 iterations). Porter and Snowball are not idempotent on their own output (e.g. RU `"сказал" → "сказа" → "сказ"`). Without iteration, the Task 6 invariant is unsatisfiable and runtime lookup would miss build keys by one stem step. **For Tasks 7 & 8:** a chat token like `"госпожой"` now resolves to `"госпож"` (the same key the build emits), so runtime/build parity is automatic. Test stubs that name "already-stemmed forms" must use ACTUAL `normalize()` output (e.g. `"appl"` for `"apple"`, `"госпож"` for `"госпожа"`, `"ещ"` for `"ещё"`) — not the literal examples in this plan.
2. **Verify check (d) was relaxed** to compare synonym keys against `normalize(headword, lang)` from `words.json`, not against the raw headword set. Required because Task 5 deliberately keeps `words.json` in headword form. Error message now ends with `"(nor its stem)"`.
3. **Test (h) in `tests/scripts/verify_assets.test.js` was rewritten** to use an inline synthetic tree (already-stemmed keys) rather than `tests/fixtures/`. The fixtures remain headword-keyed until Task 9 re-stems them. Task 9 may optionally restore a fixture-based verify test.

Built assets (`assets/{en,ru}/synonyms.json`) were re-committed in `3e02759` with the new fixed-point stems; the build pipeline passes end-to-end.

---

### Task 1: Add stemmer devDependencies and vendoring script

**Objective:** Establish the source of truth for the Porter and Snowball RU stemmers as npm devDependencies, plus a `scripts/vendor-stemmers.js` step that produces self-contained ESM files under `src/util/`.

**Files to modify/create:**
- Modify: `package.json` (add `porter-stemmer` and `snowball-stemmer.jsx` to `devDependencies`; add `scripts/vendor-stemmers.js` to the `build` script as a prerequisite step before `scripts/build_assets.js`)
- Create: `scripts/vendor-stemmers.js` (Purpose: read installed stemmer packages from `node_modules/`, emit `src/util/porter.js` and `src/util/snowball-ru.js` as flat self-contained ESM with a license header and `// @vendored-from: <pkg>@<version>` marker)
- Create: `src/util/porter.js` (generated, committed)
- Create: `src/util/snowball-ru.js` (generated, committed)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `package.json` to see the existing `build` script composition. Confirm `type: "module"` is set.
2. **Package selection:** Verify `porter-stemmer` and `snowball-stemmer.jsx` exist on npm and ship ESM-friendly source. If either package's main entry is CommonJS-only or has nested `require()` chains that defeat single-file inlining, pick the closest pure-ESM equivalent (e.g. `@stanford-cls/stemmer-ru`, `stemmer`) and note the substitution in the commit message. If you substitute, confirm the algorithm is canonical Porter / Snowball RU (not a fork).
3. **Write vendoring logic:** `scripts/vendor-stemmers.js` must (a) check the source files exist in `node_modules`, (b) read them, (c) wrap with a header comment containing license text and the `@vendored-from` marker, (d) write to `src/util/porter.js` and `src/util/snowball-ru.js`. Exit non-zero with a clear "run npm install" message if `node_modules` is missing.
4. **Idempotency check:** Re-run `node scripts/vendor-stemmers.js` twice; confirm byte-identical output via `git diff` being empty after the second run.
5. **Greppable import check:** Confirm neither emitted file contains `import` statements pointing at external URLs or `node_modules` paths — they must be self-contained.
6. **Wire into build:** Update `package.json` `build` script so `vendor-stemmers` runs first: `node scripts/vendor-stemmers.js && node scripts/build_assets.js && node scripts/verify_assets.js`.
7. **Commit:** `chore: vendor Porter + Snowball RU stemmers and wire into build`

**Note:** Do not yet import these files anywhere. Task 2 establishes the consuming API.

---

### Task 2: Create `src/util/normalize.js` with full pipeline

**Objective:** Provide the single canonical function that reduces a raw token to its match key. Both build scripts and runtime will import this. Closes the ё/е bug by applying `ё→е` for RU before stemming.

**Files to modify/create:**
- Create: `src/util/normalize.js` (Purpose: export `normalize(word, lang) → string`. Pipeline: non-string/empty → `""`; else `toLowerCase → trim → ё→е (RU only) → stem(lang)`. EN branch calls vendored Porter; RU branch calls vendored Snowball RU; unknown lang returns lowercased+trimmed word with no stem.)
- Create: `tests/util/normalize.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outlines of `src/util/porter.js` and `src/util/snowball-ru.js` to confirm their export shapes (default export vs named export vs class with `.stem()` method) — this determines the import syntax inside `normalize.js`.
2. **Write Failing Tests** in `tests/util/normalize.test.js`. Cover at minimum:
   - EN regular inflection collapse: `normalize("apples", "en") === normalize("apple", "en")`, `normalize("running", "en") === normalize("run", "en")`, `normalize("houses", "en") === normalize("house", "en")`.
   - RU case collapse — the design's motivating example: `normalize("госпожа", "ru") === normalize("госпожой", "ru") === normalize("госпожи", "ru")`.
   - ё→е normalization: `normalize("ещё", "ru") === normalize("еще", "ru")`.
   - ё→е does NOT fire for EN: `normalize("ё", "en")` is just lowercased (do not assert equality with `"е"` — assert it's unchanged by orthography).
   - Unknown lang: `normalize("Foo", "xx")` returns `"foo"` (lowercased, no stem).
   - Non-string input returns `""`: `normalize(null, "en") === ""`, `normalize(undefined, "ru") === ""`, `normalize(42, "en") === ""`.
   - Empty/whitespace input returns `""`: `normalize("", "en") === ""`, `normalize("   ", "ru") === ""`.
   - Case-insensitivity: `normalize("Apple", "en") === normalize("APPLE", "en") === normalize("apple", "en")`.
   Run `npm test` and confirm all of these fail (module doesn't exist yet).
3. **Implement `normalize.js`:** Keep the file tiny and pure. No project-local imports beyond the two vendored stemmers. The RU branch must apply `.replace(/ё/g, "е")` *before* calling the Snowball stemmer, not after.
4. **Verify:** Run `npm test` and confirm `tests/util/normalize.test.js` passes. Do not break any other test.
5. **Commit:** `feat(util): add normalize(word, lang) for stemmed match keys`

---

### Task 3: Create `src/util/tokenize.js` (unified tokenizer)

**Objective:** Eliminate the duplicate tokenizer regexes at `src/engine/synonym-scanner.js:14-18` and `src/engine/random-words.js:53-55` by extracting one shared helper with identical behavior.

**Files to modify/create:**
- Create: `src/util/tokenize.js` (Purpose: export `extractTokens(text) → string[]`. Behavior must match the existing `src/engine/synonym-scanner.js:16` regex `/[a-zà-ɏ]+|[а-яё]+/gi` after `toLowerCase()`; non-string input returns `[]`.)
- Create: `tests/util/tokenize.test.js`

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/engine/synonym-scanner.js:14-18` and `src/engine/random-words.js:53-55` to confirm both regex shapes. The audit noted they are functionally equivalent but use slightly different syntax — preserve the scanner's exact behavior.
2. **Write Failing Tests** in `tests/util/tokenize.test.js`. Cover:
   - Basic EN: `extractTokens("Hello world")` → `["hello", "world"]`.
   - Basic RU: `extractTokens("Привет мир")` → `["привет", "мир"]`.
   - Apostrophe split: `extractTokens("don't")` → `["don", "t"]` (matches current behavior; not a bug to fix here).
   - Hyphen split: `extractTokens("well-known")` → `["well", "known"]`.
   - Punctuation stripping: `extractTokens("Hello, world!")` → `["hello", "world"]`.
   - Em-dash and quote handling: `extractTokens("she said — \"yes\"")` returns no empty strings and no quote fragments.
   - All-emoji / no script chars: `extractTokens("🎉🚀")` → `[]`.
   - Empty / whitespace: `extractTokens("")` → `[]`, `extractTokens("   ")` → `[]`.
   - Non-string input: `extractTokens(null)` → `[]`, `extractTokens(42)` → `[]`.
   - Mixed scripts in one input: `extractTokens("hello привет")` → `["hello", "привет"]`.
   Run `npm test` and confirm these fail.
3. **Implement `tokenize.js`:** One function, pure, no project-local imports. Preserve the scanner's exact regex.
4. **Verify:** `npm test` passes including the new file. Do NOT yet touch the two engine files — Tasks 7 and 8 do that.
5. **Commit:** `feat(util): add extractTokens shared tokenizer`

---

### Task 4: Create `scripts/lib/stemmer.js` build-side re-export

**Objective:** Give build scripts a single import path for `normalize`, so the build pipeline and runtime share identical code. Build scripts import from `scripts/lib/stemmer.js`, never from `src/util/` directly.

**Files to modify/create:**
- Create: `scripts/lib/stemmer.js` (Purpose: re-export `normalize` from `../../src/util/normalize.js`)

**Instructions for Execution Agent:**
1. **Context Setup:** Confirm the relative path from `scripts/lib/` to `src/util/normalize.js` is `../../src/util/normalize.js`.
2. **Implement:** One-line re-export module. No tests needed for the shim itself — it's exercised by Task 5 and Task 6.
3. **Verify:** `npm test` still passes (nothing should change). Add a trivial smoke check by running `node -e "import('./scripts/lib/stemmer.js').then(m => console.log(typeof m.normalize))"` from the project root and confirming it prints `function`.
4. **Commit:** `feat(scripts): re-export normalize for build-time use`

---

### Task 5: Stem `synonyms.json` keys at build time with union+dedupe

**Objective:** Modify the synonyms emit path so every key is normalized via `normalize(word, lang)` before writing. When two source headwords collide on the same stem, merge their `s` and `a` arrays with first-seen dedupe.

**Depends on:** Task 1 (vendored stemmers), Task 4 (build-side re-export).

**Files to modify/create:**
- Modify: `scripts/build_assets.js` (Purpose: in the synonyms emit path, currently around lines 156-184, apply `normalize(word, lang)` to every key; merge collisions per the union+dedupe policy)
- Modify: `tests/scripts/wordnet-extract.test.js` or new test file (Purpose: if the EN synonyms builder has a unit-testable function, add a stem-key assertion; otherwise add an integration test that runs the build against a tiny fixture source and asserts stemmed keys)
- Create: `tests/scripts/build-synonyms-stem.test.js` (Purpose: integration test — feed a tiny raw source through the build path, assert the emitted `synonyms.json` has stemmed keys and that colliding headwords produce a unioned entry)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `scripts/build_assets.js` (specifically the synonyms emit section, lines ~133-189 per the design). Identify the exact loop that walks the top-N words and writes `assets/{lang}/synonyms.json`. Also read `scripts/lib/wordnet-extract.js` (EN path) and `scripts/lib/yarn-extract.js` (RU path) to confirm where the `{word: {s, a}}` map is assembled.
2. **Write Failing Tests** in `tests/scripts/build-synonyms-stem.test.js`. Cover:
   - EN stemming: a fixture raw source containing `apple`, `apples`, `running` produces a built map whose keys include the Porter stems of those words (not the headwords themselves). Assert `apple` and `apples` collapse to the same key.
   - RU stemming + ё→е: a fixture raw source containing `госпожа`, `госпожой`, `ещё` produces a map whose keys are the Snowball stems with `ё→е` applied.
   - Collision union: a fixture raw source with two distinct headwords that stem to the same key produces one merged entry; the merged `s` array is the union (deduped, first-seen order) of the two sources; same for `a`.
   - Values are NOT stemmed: the merged entry's `s` and `a` arrays still contain the original headword-form suggestions, not stems.
   If the build's internal functions are not easily unit-testable in isolation, write the test as: invoke the relevant extraction function with a stubbed tiny input, then run the new stem-and-merge step, then assert on the output.
3. **Implement:** In `scripts/build_assets.js`, after the raw `{word: {s, a}}` map is assembled, add a stem-and-merge pass:
   - Import `normalize` from `./lib/stemmer.js`.
   - Build a new map keyed by `normalize(word, lang)`.
   - For each source entry, look up (or create) the stemmed entry; concatenate `s` arrays, concatenate `a` arrays; dedupe each via a `Set`-or-`Array.filter` preserving first-seen order.
   - Write the merged map to `assets/{lang}/synonyms.json` exactly as today (same `writeJsonAtomic` call).
   Leave the `words.json` emit path untouched.
4. **Verify:** `npm test` passes. Manually run `npm run build` and spot-check `assets/en/synonyms.json` and `assets/ru/synonyms.json`: keys should no longer be plain headwords (e.g. `apples` should be absent; its stem should be present instead). The RU file should still have zero `ё` characters in keys (regression check on the existing invariant).
5. **Commit:** `feat(scripts): stem synonyms.json keys with union+dedupe collision policy`

---

### Task 6: Add stem-key invariant to asset verifier

**Objective:** Prevent drift — if anyone hand-edits `assets/{en,ru}/synonyms.json` and adds a key that is not its own stem, `scripts/verify_assets.js` must fail the build.

**Depends on:** Task 4 (build-side re-export), Task 5 (assets are stemmed).

**Files to modify/create:**
- Modify: `scripts/verify_assets.js` (Purpose: add a check that iterates every key in both `synonyms.json` files and asserts `key === normalize(key, lang)`; report any offenders with a clear message)
- Modify: `tests/scripts/verify_assets.test.js` (Purpose: add cases that exercise the new check — a fixture with a valid stemmed key passes; a fixture with an un-stemmed headword key fails)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `scripts/verify_assets.js` to see how existing checks are structured (size bounds, key counts). Match the existing error-reporting style.
2. **Write Failing Tests** in `tests/scripts/verify_assets.test.js`. Cover:
   - A synonyms fixture where every key equals `normalize(key, lang)` passes verification.
   - A synonyms fixture containing at least one un-stemmed headword key (e.g. `"apples"` under EN, `"госпожой"` under RU) fails verification with a message identifying the offending key(s).
   - The check applies to both EN and RU fixtures.
3. **Implement:** In `scripts/verify_assets.js`, add a function that loads `assets/{lang}/synonyms.json`, iterates keys, and asserts the invariant. Wire it into the existing verify pipeline so a failure aborts the build with non-zero exit.
4. **Verify:** `npm test` passes including the new cases. Run `npm run build` end-to-end and confirm verify succeeds against the freshly-built stemmed assets.
5. **Commit:** `feat(scripts): verify synonyms.json keys are stemmed`

---

### Task 7: Wire synonym scanner to use `normalize` + `extractTokens`

**Objective:** Replace the local tokenizer in `src/engine/synonym-scanner.js` with `extractTokens`, and route every token through `normalize` before the `hasEntry` / `getSynonyms` lookup.

**Depends on:** Task 2, Task 3.

> **Deviation note (read design §13 first):** `normalize` now iterates to a fixed point, so inflected chat tokens (e.g. `"госпожой"`, `"сказал"`) resolve directly to the build's stem keys. When writing stub fixtures with "already-stemmed forms", compute the actual stems via `normalize()` rather than copying the literal examples in step 2 below — `normalize("apple","en") === "appl"`, not `"apple"`.

**Files to modify/create:**
- Modify: `src/engine/synonym-scanner.js` (Purpose: remove the local `tokenize` function at lines 14-18; import from `src/util/tokenize.js`; wrap the lookup token in `normalize(token, lang)` at the `hasEntry` and `getSynonyms` call sites around line 63-64)
- Modify: `tests/engine/synonym-scanner.test.js` (Purpose: add inflected-input cases that would fail without normalization)
- Modify: `tests/fixtures/mini-en-synonyms.json` and `tests/fixtures/mini-ru-synonyms.json` (Purpose: re-stem fixture keys to match what the real build now produces — see Task 9 for the systematic fixture overhaul; this task only adds the new test cases and updates the fixtures enough to make them pass)

**Instructions for Execution Agent:**
1. **Context Setup:** Re-read `src/engine/synonym-scanner.js` lines 14-18 and 49-68. Confirm the exact call sites for `hasEntry` and `getSynonyms`.
2. **Write Failing Tests** in `tests/engine/synonym-scanner.test.js`. Add cases:
   - EN inflected match: build a stub synonyms module whose keys are *stems* (Porter output); feed the scanner a chat containing inflected forms; assert the scanner surfaces the word and returns its synonym list. For example, if the stub keys `"apple"` and `"run"` (already-stemmed forms), feeding chat text `"apples apples running"` with `minOccurrences: 2` should surface `"apple"` (or whatever Porter stem the chat token normalizes to) with non-empty suggestions.
   - RU inflected match: stub keys `"госпож"` and `"еще"` (already-stemmed, ё→е applied); feed chat containing `"госпожой госпожой ещё ещё"`; assert the scanner surfaces both with non-empty suggestions.
   - ё→е specifically: stub key `"еще"`; chat token `"ещё"`; assert match.
   - The existing 14 cases still pass (tokenization behavior is preserved by `extractTokens`).
3. **Implement:**
   - Remove the local `tokenize` function. Import `extractTokens` from `../util/tokenize.js`.
   - Import `normalize` from `../util/normalize.js`.
   - Where the frequency map is built, store counts under the *raw* token (preserves display fidelity for the returned `word` field).
   - At the `hasEntry`/`getSynonyms` call sites, pass `normalize(token, lang)` as the lookup key.
   - The returned entry's `word` field stays as the raw chat token (so the prompt shows `"госпожой"`, not `"госпож"`) — confirm this matches the existing return shape.
4. **Verify:** `npm test` passes including the new cases. Manually trace one new case end-to-end to confirm the lookup path.
5. **Commit:** `feat(scanner): normalize tokens before synonym lookup`

---

### Task 8: Wire random-words picker's contextual mode to use `normalize` + `extractTokens`

**Objective:** Replace the duplicate tokenizer at `src/engine/random-words.js:53-55` with `extractTokens`, and route candidate tokens through `normalize` before the `hasEntry` / `getAssociations` lookup in `runContextual`.

**Depends on:** Task 2, Task 3.

> **Deviation note (same as Task 7):** `normalize` iterates to a fixed point (design §13.3). Compute actual stem stubs via `normalize()`; do not copy literal examples like `"apple"` / `"госпож"` verbatim — they may be off by one stem step.

**Files to modify/create:**
- Modify: `src/engine/random-words.js` (Purpose: remove the local tokenizer at lines 53-55; import `extractTokens`; in `runContextual` around line 144, normalize candidate tokens before `hasEntry`; same for `getAssociations` around line 159)
- Modify: `tests/engine/random-words.test.js` (Purpose: add a contextual-mode case where the user message contains an inflected form that resolves to a stemmed fixture key)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/engine/random-words.js`, focusing on `runContextual` (line 121+) and the local tokenizer (lines 53-55). Confirm where `hasEntry` and `getAssociations` are called with the user-message tokens.
2. **Write Failing Tests** in `tests/engine/random-words.test.js`. Add cases:
   - EN contextual inflected match: stub `words.hasEntry`/`synonyms.hasEntry` such that a stemmed key exists; feed a user message containing the inflected form (e.g. `"apples"`); assert `runContextual` returns the associations for the stemmed key, not the empty fallback.
   - RU contextual inflected match: same shape with `"госпожой"` resolving to a `"госпож"`-keyed stub.
   - `runRandom` and `runDoublePass` behavior is unchanged (they sample from the word bank, which keeps headword form). Add a regression case confirming they do NOT normalize their picks.
3. **Implement:**
   - Remove the local tokenizer. Import `extractTokens`.
   - Import `normalize`.
   - In `runContextual`, when iterating user-message tokens and calling `hasEntry`/`getAssociations`, pass `normalize(token, lang)`.
   - The injected word(s) returned by this mode come from the associations list (which is headword-form, un-stemmed), so display output is unaffected.
4. **Verify:** `npm test` passes. Confirm no regression in `runRandom` / `runDoublePass` cases.
5. **Commit:** `feat(random-words): normalize tokens in contextual mode`

---

### Task 9: Re-stem test fixtures and update fixture-dependent assertions

**Objective:** The fixture files `tests/fixtures/mini-en-synonyms.json` and `tests/fixtures/mini-ru-synonyms.json` currently use headword keys. After the build pipeline stems keys (Task 5), the fixtures must match the new shape, and any test that references fixture keys by name must be updated.

**Depends on:** Task 5, Task 7, Task 8 (so the consuming tests are already in place to catch fixture drift).

> **Deviation note (read design §13 first):** `normalize` now iterates to a fixed point, so step 2's "compute `normalize(key, lang)`" yields fixed-point stems (e.g. `"houses" → "hou"`, `"сказал" → "сказ"`). Some stems look aggressive; trust the function output — the same invariant is verified against real assets. After re-stemming fixtures, you MAY optionally restore the fixture-based verify test that Task 6 converted to inline synthetic (see design §13.4); not required.

**Files to modify/create:**
- Modify: `tests/fixtures/mini-en-synonyms.json` (Purpose: replace headword keys with their Porter stems; merge colliding entries per union+dedupe)
- Modify: `tests/fixtures/mini-ru-synonyms.json` (Purpose: replace headword keys with their Snowball stems; apply ё→е; merge colliding entries per union+dedupe)
- Modify: any test under `tests/` that references a fixture key by literal name (Purpose: update the literal to the stemmed form)

**Instructions for Execution Agent:**
1. **Context Setup:** Grep across `tests/` for any literal key string that appears in either fixture (e.g. `"apple"`, `"running"`, `"яблоко"`, `"бег"`). List every reference — these all need to be re-stemmed in lockstep with the fixture files.
2. **Compute new fixture keys:** For every existing key in both fixtures, compute `normalize(key, lang)` using the actual `normalize` function (do not hand-compute stems — Porter/Snowball output is non-obvious). If two source keys collide on the same stem, union their `s` and `a` arrays per the Task 5 policy.
3. **Update fixtures:** Write the stemmed form of each fixture file. The `s` and `a` *values* stay as their original headword strings — only keys change.
4. **Update test literals:** For every grep hit from step 1, replace the literal with the corresponding stemmed form. If a test was asserting on a specific headword key, update it to assert on the stem.
5. **Verify:** `npm test` passes with zero failures. If a test was structurally dependent on a headword-form key (e.g. it stubbed the synonyms module with a literal `"apple"` key and now needs `"appl"` or whatever Porter yields), update both the stub and the assertion in the same commit.
6. **Commit:** `test: re-stem fixtures and dependent assertions`

---

### Task 10: Update smoke-test checklist and overturn prior non-goal

**Objective:** Update project documentation to reflect the new stemming behavior. The offline-refactor design explicitly listed "No stemming or lemmatization in synonym lookups" as a Non-Goal — that line must be struck or annotated. The manual smoke-test checklist gets new cases for inflected-input matching.

**Depends on:** All previous tasks merged.

**Files to modify/create:**
- Modify: `docs/designs/2026-06-15-offline-refactor.md` (Purpose: at line 21, the Non-Goal "No stemming or lemmatization in synonym lookups" — either strike it with a note pointing to the new design, or annotate that it was overturned by `docs/designs/2026-06-16-stemming-synonym-matching.md`)
- Modify: whichever file under `docs/` holds the synonym smoke-test checklist (Purpose: add manual smoke-test cases — typing `"госпожа"` repeatedly in chat should trigger the avoid-synonym prompt with the corresponding lemma's suggestions; typing `"apples"` repeatedly should match the `"apple"` stem)

**Instructions for Execution Agent:**
1. **Context Setup:** Glob `docs/**/*.md` to locate the smoke-test checklist file (likely referenced from `AGENTS.md` or `README.md`). Read it to see the existing structure.
2. **Update smoke-test checklist:** Add cases for:
   - EN inflected token triggers scanner: send 3+ assistant messages containing `"running"`; confirm the synonym prompt fires with `"run"`-stem suggestions.
   - RU case-form token triggers scanner: send 3+ assistant messages containing `"госпожой"`; confirm the synonym prompt fires with `"госпож"`-stem suggestions.
   - ё/е specifically: send 3+ assistant messages containing `"ещё"`; confirm the prompt fires (regression check on the closed bug).
   - Random-words picker display is unaffected: confirm the random-words slot still injects headword-form words (e.g. `"госпожа"`, not `"госпож"`).
3. **Update prior design:** In `docs/designs/2026-06-15-offline-refactor.md` line 21, add a one-line annotation: `_(Overturned 2026-06-16 — see docs/designs/2026-06-16-stemming-synonym-matching.md.)_`. Do not delete the original line; future readers benefit from seeing the decision history.
4. **Verify:** `npm test` still passes (documentation change, no code). Manually run the smoke-test cases in a local SillyTavern if possible; otherwise document them as pending manual verification.
5. **Commit:** `docs: update smoke-test checklist and annotate overturned non-goal`

---

## Final verification (after all tasks)

Run the full pipeline end-to-end:

1. `npm install` (fresh) — confirms devDependencies resolve.
2. `npm run build` — runs `vendor-stemmers → build_assets → verify_assets` in order. Verify exits zero.
3. `npm test` — all suites green.
4. Spot-check `assets/en/synonyms.json` and `assets/ru/synonyms.json`: keys are stems, values are headwords, zero `ё` in RU keys.
5. Manual: load extension in SillyTavern, run the smoke-test cases from Task 10.
