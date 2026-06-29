/**
 * Reading-size control — the persistence key.
 *
 * The numeric knobs (root point sizes per step, default step) live in `@/lib/constants`
 * (FONT_SIZE_STEPS_PT, DEFAULT_FONT_SIZE_INDEX). This module keeps only the localStorage key,
 * which is an internal identifier rather than a tunable value.
 */

/** localStorage key holding the chosen reading-size step index. */
export const FONT_SIZE_STORAGE_KEY = "kin-font-size";
