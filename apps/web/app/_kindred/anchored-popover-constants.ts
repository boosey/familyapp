// AnchoredPopover (#300) — JS-math geometry for placement / clamping.
// Pure design chrome (radius, shadow, colors) lives in AnchoredPopover.module.css; these numbers are
// used in placement math so they stay here (CLAUDE.md single-source rule). CSS reads the same values
// via custom properties set on the panel.

/** Gap between trigger bottom/top and the panel (px). */
export const ANCHORED_POPOVER_GAP_PX = 8;

/** Minimum viewport gutter from the panel edges (px). */
export const ANCHORED_POPOVER_EDGE_GUTTER_PX = 8;

/**
 * If space below the trigger is below this (px) and space above is larger, flip the panel above.
 */
export const ANCHORED_POPOVER_FLIP_BELOW_MIN_PX = 240;

/** Floor for panel min-width (px) — 12rem at 16px root. */
export const ANCHORED_POPOVER_MIN_WIDTH_PX = 192;

/** Cap for panel max-width (px) — 22rem at 16px root; also supplied as --anchored-popover-max-width. */
export const ANCHORED_POPOVER_MAX_WIDTH_PX = 352;
