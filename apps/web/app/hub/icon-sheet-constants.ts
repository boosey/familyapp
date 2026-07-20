// IconSheet (ADR-0025 Phase B, Increment 3) — JS-math / rendered numeric knob.
//
// The lucide glyph size is passed to the icon component as a React prop (a JS value the SVG renders),
// so per CLAUDE.md's centralization rule it lives here as a TS constant — NOT as a CSS custom property
// (it would then live in two files). The trigger's layout dims are pure CSS design values in
// IconSheet.module.css; they are not duplicated here.

/** lucide glyph size (px) for an IconSheet trigger icon. */
export const ICON_SHEET_GLYPH_SIZE = 22;
