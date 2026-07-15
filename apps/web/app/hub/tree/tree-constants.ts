/**
 * tree-constants — the single source of truth for the visual family tree's tweakable geometry and
 * style knobs (spec 2026-07-13). Every number here is a design/behavior knob a developer or designer
 * would reasonably want to adjust; nothing here is incidental.
 *
 * WHY this file exists: `NODE_W`/`NODE_H` (card dimensions) were previously declared TWICE — once in
 * `tree-layout.ts` (which does the geometry math) and once in `person-node.tsx` (which renders the
 * card). Bump one and not the other and the layout math silently desynced from the rendered card, so
 * carets/connectors pointed at the wrong card edge. This module makes each such value exist exactly
 * once; `tree-layout.ts` re-exports the geometry primitives so its public surface is unchanged.
 *
 * PLACEMENT RULE (see docs/superpowers/specs/2026-06-28-centralize-copy-constants-design.md):
 *   - Pure design token (color/spacing/radius/type, no JS math) → a CSS custom property in
 *     app/_kindred/tokens.css, NOT here.
 *   - Value used in JS arithmetic (geometry, zoom bounds, thresholds) → here, as a TS constant.
 *   - The same number must never live in two places.
 */

// ---------------------------------------------------------------------------
// Card geometry — consumed by BOTH the layout math (tree-layout.ts) and the
// rendered card (person-node.tsx). Single source of truth; do not re-declare.
// ---------------------------------------------------------------------------

/** Uniform card width (px). */
export const NODE_W = 150;
/** Uniform card height (px) — avatar · name · dates. */
export const NODE_H = 168;

// ---------------------------------------------------------------------------
// Generation spacing — primitives the layout math derives its steps from.
// ---------------------------------------------------------------------------

/** Horizontal gap between stacked same-generation (non-partner) cards. */
export const CROSS_H_GAP = 26;
/** Tight gap inside a partnership — partners sit ~half as far apart as ordinary neighbors. */
export const PARTNER_GAP = 7;
/** Vertical gap between generation rows (room for gutter carets + the descent bus). */
export const GEN_V_GAP = 78;

// ---------------------------------------------------------------------------
// Gutter affordance (the expand/collapse caret & "+"): size and its OVERLAP
// with the card. This overlap is the knob to tweak for the affordance's visual
// bite into the card corner.
// ---------------------------------------------------------------------------

/** Rendered diameter (px) of a gutter caret/"+" button (AffordanceButton in tree-canvas.tsx). */
export const AFFORDANCE_SIZE_PX = 30;
/**
 * How much of the affordance glyph overlaps the card, as a fraction of the glyph's own size.
 * 0.25 → a quarter of the glyph sits over the card edge. THIS is the knob to change the "bite".
 */
export const CARET_OVERLAP_FRACTION = 0.35;
/**
 * Distance (px) from the card edge to a gutter caret/"+" CENTER. DERIVED from the two knobs above so
 * the overlap can never silently disagree with the rendered button size:
 *   overlap_px   = AFFORDANCE_SIZE_PX/2 − CARET_GAP           (glyph radius minus the outward gap)
 *   overlap_frac = overlap_px / AFFORDANCE_SIZE_PX
 * ⇒ CARET_GAP = AFFORDANCE_SIZE_PX · (0.5 − CARET_OVERLAP_FRACTION).  (22 · 0.25 = 5.5)
 */
export const CARET_GAP = AFFORDANCE_SIZE_PX * (0.5 - CARET_OVERLAP_FRACTION);
/** Half-size of a caret/"+" glyph, reserved as padding so a side/edge affordance never clips. */
export const CARET_HALF = 12;

// ---------------------------------------------------------------------------
// Canvas zoom / pan behavior (tree-canvas.tsx) — pure behavior, no CSS.
// ---------------------------------------------------------------------------

/** How far (px) a pointer may move between down and up and still count as a tap, not a drag. */
export const DRAG_SLOP_PX = 6;
/** Minimum zoom scale. */
export const ZOOM_MIN = 0.3;
/** Maximum zoom scale. */
export const ZOOM_MAX = 2.5;
/** Multiplier per +/− zoom step. */
export const ZOOM_STEP = 1.2;
/** Breathing room around the tree when fitting the whole thing to the viewport. */
export const FIT_MARGIN = 0.9;
/** Don't zoom a tiny tree in past this when fitting (a lone node shouldn't fill the screen). */
export const FIT_MAX_SCALE = 1.2;

// ---------------------------------------------------------------------------
// Card interior styling (person-node.tsx). Sizes used in layout/JS stay here;
// pure colors/spacing that map to Kindred tokens should use those tokens.
// ---------------------------------------------------------------------------

/** Avatar / monogram diameter (px). */
export const AVATAR_SIZE_PX = 52;
/** Height (px) of the top-edge sex accent bar. */
export const SEX_BAR_HEIGHT_PX = 6;
/** Inset (px) of the per-card ⋮ kebab from the top-right corner. */
export const KEBAB_INSET_PX = 4;
/** Max lines the card name may wrap to before truncating. */
export const NAME_LINE_CLAMP = 2;

/**
 * Deterministic-monogram color knobs. The hash → hue mapping produces a stable per-person color; the
 * saturation/lightness are the design knobs for how vivid/dark those monograms read.
 */
export const MONOGRAM_HUE_MODULO = 360;
export const MONOGRAM_SATURATION_PCT = 45;
export const MONOGRAM_LIGHTNESS_PCT = 42;
