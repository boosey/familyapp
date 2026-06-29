// Domain numeric knobs for the web app. Tune here, not at call sites.
//
// NOTE: the reading-size font-scale constants (FONT_SIZE_STEPS_PT, DEFAULT_FONT_SIZE_INDEX)
// will also move here once the in-flight font-sizer edits land; FONT_SIZE_STORAGE_KEY stays in
// _kindred/font-scale-constants.ts (it is a localStorage key, an internal identifier — not a knob).

/** Derived-key length (bytes) for scrypt password hashing. */
export const SCRYPT_KEY_LENGTH_BYTES = 64;

/** Random salt size (bytes) for password hashing. */
export const PASSWORD_SALT_BYTES = 16;
