# Contextual Mode Anchor Sweet-Spot Selection

**Date:** 2026-06-17
**Status:** Proposed
**Scope:** `src/engine/random-words.js` — `runContextual` function only

## Problem

`runContextual` currently walks user-message tokens sorted by ascending rank (most frequent first) and picks the first token with a synonym entry as the anchor. Because the most frequent words in the bank are generic function words and high-frequency nouns/verbs (*go, thing, have, day*), the anchor is almost always bland — and its associations are similarly generic. Contextual mode fails to deliver on its promise of thematically relevant word injections.

## Goal

Pick anchor words from a "semantic sweet spot" — moderately rare, content-rich words that carry more thematic weight (e.g., *ship, woods, castle, scared*) rather than high-frequency function words. The change must preserve reliability: short or simple messages (e.g., *"Come here!"*) that contain no sweet-spot words should still produce output via a layered fallback.

## Constants

Two module-scope constants at the top of `src/engine/random-words.js`:

```js
const SWEET_SPOT_MIN = 1000;
const SWEET_SPOT_MAX = 15000;
```

These are tuning knobs for a ~30k-entry word bank. `SWEET_SPOT_MIN` excludes the most common function words; `SWEET_SPOT_MAX` excludes very rare/obscure words whose association pools tend to be sparse or noisy.

Both current banks (`assets/en/words.json`, `assets/ru/words.json`) contain exactly 30,000 entries with ranks spanning ~1–31,000 (EN) and ~1–30,000 (RU). The sweet spot targets roughly the 3rd–50th percentile of ranks — where evocative nouns and descriptive adjectives cluster.

## Algorithm

Replaces the current rank-sort-and-pick-first logic in `runContextual` (lines 127–150):

```
1. Tokenize user message via tokenize() — split on word characters, filter
   language-specific stopwords, dedupe.
2. For each unique token:
   a. Look up {pos, rank} via words.getWordMeta(lang, token).
   b. Check if normalize(token, lang) has a synonym entry via
      synonyms.hasEntry(lang, stem).
   c. Keep only tokens that pass both checks → candidates[]{word, rank}.
3. If candidates is empty → warn, fall back to runRandom() (unchanged).
4. Split candidates:
   - sweetSpot[]  = candidates where rank ∈ [SWEET_SPOT_MIN, SWEET_SPOT_MAX]
   - fallback[]   = candidates outside the sweet spot
5. Anchor selection:
   a. If sweetSpot is non-empty: pick uniformly at random from sweetSpot.
      This adds variety across regenerations — a message like "sneak into
      the castle" can yield either "sneak" or "castle" as anchor.
   b. Otherwise: sort fallback ascending by rank, pick the first (most
      frequent — closest to original behavior). No warning emitted; this is
      a normal condition for short messages.
6. Look up associations via synonyms.getAssociations(lang, normalize(chosen)).
7. Filter blacklist and history.
8. Return sampleWithoutReplacement(eligible, wordCount) — up to wordCount
   associations, potentially fewer if the pool is small.
```

## Error Handling

| Scenario | Behavior | Warning? |
|---|---|---|
| `wordCount <= 0` | Return `[]` | No |
| No tokens found in word bank | Fall back to `runRandom()` | Yes (unchanged) |
| Tokens in bank but none have synonym entries | Fall back to `runRandom()` | Yes (unchanged) |
| Sweet spot empty, fallback used | Pick most-frequent from fallback pool | No |
| Sweet spot non-empty | Random pick from sweet spot | No |
| All associations blacklisted/in history | Return `[]` | No |

The new "sweet spot empty" path is handled silently — it is a normal condition for short messages like *"Come here!"* and does not indicate failure.

## Data Flow

```
userMessage
  │
  ▼
tokenize() ──────────► tokens[] (stopwords removed, deduped)
  │
  ▼
words.getWordMeta() ─► candidates[]{word, rank}
synonyms.hasEntry()      (filtered to those with synonym data)
  │
  ▼
sweet-spot filter ────► sweetSpot[], fallback[]
  │
  ▼
anchor selection ─────► chosen: string
  │                        │
  │                        ├─ sweetSpot random pick
  │                        └─ fallback: sort ascending, pick first
  ▼
synonyms.getAssociations()
  │
  ▼
filter blacklist + history
  │
  ▼
sampleWithoutReplacement(eligible, wordCount) ──► picks[]
```

## UX Impact

**None visible to the user.** No settings change, no UI change. The improvement is in output quality: contextual mode produces more vivid, thematically coherent word injections.

Before: *"go"* → associations like *person, individual, place, thing*.
After: *"castle"* → associations like *tower, knight, siege, dungeon*.

## Testing

New tests in `tests/engine/random-words.test.js` under the existing contextual-mode describe block:

1. **`prefers sweet-spot anchor over a more frequent non-sweet-spot token`** — fixture contains both a rank-50 word and a rank-5000 word with synonym entries; verify the rank-5000 word is chosen.

2. **`falls back to most-frequent-first when no sweet-spot candidates exist`** — fixture contains only words outside [1000, 15000]; verify original behavior is preserved and no warning is emitted.

3. **`picks randomly among multiple sweet-spot candidates`** — fixture contains several sweet-spot words; mock `Math.random` to return fixed values and verify different anchors are selected.

4. **`SWEET_SPOT_MIN and SWEET_SPOT_MAX are module constants`** — verify the constants exist and are numbers in the expected range.

Existing tests that must remain green:
- Inflected-token resolution (`apples` → `appl`, `госпожой` → `госпож`)
- Russian contextual mode (`яблоко`)
- Stopword filtering
- Fallback to random when no synonyms entry exists
- `runRandom` and `runDoublePass` do not normalize (regression guard)

## Files Changed

- `src/engine/random-words.js` — replace anchor selection logic, add constants
- `tests/engine/random-words.test.js` — add 4 new tests

No changes to: `src/index.js`, `src/engine/injector.js`, `src/settings.js`, `src/data/*`, `assets/*`, docs.
