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

/**
 * Most photos accepted per import batch. The AUTHORITATIVE cap: the server action enforces it and the
 * client uploaders pre-check against it. Single source of truth — previously this 30 was copied across
 * four files (two uploaders, the server action, and the album board) and kept in sync by hand.
 */
export const PHOTO_BATCH_MAX_FILES = 30;

/**
 * Max characters accepted for a follow-up question on a published story (#77). The action enforces
 * this after trim; over-length is rejected with the mapped `hub.followUp.failed` copy. A generous cap
 * — a follow-up is a single human question, not an essay.
 */
export const FOLLOW_UP_QUESTION_MAX_CHARS = 1000;

/** Google Photos picker polling: overall timeout before giving up (ms). */
export const PHOTO_PICKER_POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** Google Photos picker polling: delay between poll attempts (ms). */
export const PHOTO_PICKER_POLL_INTERVAL_MS = 2000;

/** How long the #337 reconcile success toast stays visible before auto-dismiss (ms). */
export const RECONCILE_TOAST_DISMISS_MS = 5000;

/**
 * Canonical responsive breakpoints (min-width, in rem) for the web app's mobile-first @media layers.
 * SINGLE SOURCE OF TRUTH: every `@media (min-width: …)` under apps/web/app must use exactly one of
 * these values. Enforced by app/_kindred/responsive-breakpoints.test.ts, which scans the CSS tree and
 * fails on any min-width outside this set (px are normalized to rem at 16px/rem). Kept minimal on
 * purpose — intrinsic layout (clamp/auto-fill/flex-wrap) already handles most reflow; a width
 * breakpoint is a last resort, not the default tool.
 *   sm (40rem / 640px)  — phone → small tablet
 *   lg (64rem / 1024px) — tablet → desktop
 */
export const RESPONSIVE_BREAKPOINTS_REM = { sm: 40, lg: 64 } as const;

/**
 * Capture voice-button diameters (px). Mobile-first — the old 220 hero disc crowded phone viewports.
 * Entry = take-0 / link-session primary CTA; footer = follow-up append on the composing surface
 * (matches `--touch-voice`). Single source for NarratorRecorder / ComposingEditor / ApprovalRecorder.
 */
export const CAPTURE_VOICE_SIZE_ENTRY_PX = 120;
export const CAPTURE_VOICE_SIZE_FOOTER_PX = 96;
