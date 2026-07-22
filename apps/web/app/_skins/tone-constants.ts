/** Emotional tone of a UI subtree. `solemn` dials Scrapbook whimsy down (structure + palette)
 *  on heavy surfaces (capture, erasure/approval/consent confirmations). Applied as a
 *  `data-tone` attribute on a wrapping element — NOT a global user preference. */
export const TONE_VALUES = ["warm", "solemn"] as const;
export type Tone = (typeof TONE_VALUES)[number];
export const DEFAULT_TONE: Tone = "warm";
export const TONE_ATTR = "data-tone";
