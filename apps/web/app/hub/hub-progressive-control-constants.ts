/**
 * Progressive hub control row (#301) — JS-math knobs.
 *
 * Horizontal gap between row units is used both as the flex `gap` and when subtracting inter-unit
 * gaps from the resolver's available width. Per CLAUDE.md it lives here once; the row applies it via
 * inline style (not a duplicated CSS literal).
 */

/** lucide glyph size (px) for Sub tabs icon-pills and the Sub tabs menu trigger. */
export const HUB_SUB_TABS_GLYPH_SIZE = 18;

/** Horizontal gap (px) between progressive control units (browse + trailing action). */
export const HUB_PROGRESSIVE_CONTROL_GAP_PX = 8;
