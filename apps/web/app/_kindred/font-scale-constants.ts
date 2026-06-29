/**
 * Reading-size control — shared constants.
 *
 * The Kindred type scale is defined in `rem` (see tokens.css), so setting the root element's
 * font size in points rescales every token at once. These are the root font sizes (in points)
 * for each step of the size picker, smallest → largest. Tune them here; the picker UI and the
 * pre-paint script in `layout.tsx` both read from this single source of truth.
 */
export const FONT_SIZE_STEPS_PT = [8, 10, 12, 14,18] as const;

/** Step applied before the narrator has chosen one (≈ the historical 18px base). */
export const DEFAULT_FONT_SIZE_INDEX = 1;

/** localStorage key holding the chosen step index. */
export const FONT_SIZE_STORAGE_KEY = "kin-font-size";
