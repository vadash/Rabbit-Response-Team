// Build-time constants for the offline asset pipeline.
// See design §5.4 for rationale on each value.

export const BUILD = {
  WORDS_TOP_N:              30_000,
  SYNONYMS_TOP_N:           20_000,   // must be ≤ WORDS_TOP_N
  SYNONYMS_PER_WORD:        8,
  ASSOCIATIONS_PER_WORD:    12,

  ASSETS_MIN_SIZE_BYTES:    5  * 1024 * 1024,   // 5 MB floor
  ASSETS_MAX_SIZE_BYTES:    100 * 1024 * 1024,  // 100 MB ceiling (GitHub single-file headroom)

  DOUBLE_PASS_ANCHOR_RETRIES: 10,   // bounds sampling when looking for an anchor with associations
};
