// Domain numeric knobs for the web app. Tune here, not at call sites.
// (FONT_SIZE_STORAGE_KEY stays in _kindred/font-scale-constants.ts — it is a localStorage key,
// an internal identifier, not a tunable knob.)

/** Derived-key length (bytes) for scrypt password hashing. */
export const SCRYPT_KEY_LENGTH_BYTES = 64;

/** Random salt size (bytes) for password hashing. */
export const PASSWORD_SALT_BYTES = 16;

/**
 * Root font sizes (in points) for each step of the reading-size picker, smallest → largest.
 * The Kindred type scale is in `rem`, so setting the root font size rescales every token at once.
 * Single source of truth for both the picker UI and the pre-paint script in layout.tsx.
 */
export const FONT_SIZE_STEPS_PT = [8, 10, 12, 14, 18] as const;

/** Default reading-size step before the narrator chooses one. */
export const DEFAULT_FONT_SIZE_INDEX = 1;
