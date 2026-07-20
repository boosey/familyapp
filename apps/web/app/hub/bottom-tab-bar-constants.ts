// Bottom tab bar (ADR-0025 Phase B, Increment 1) — JS-math / rendered numeric knobs.
//
// The lucide icon size is passed to the icon component as a React prop (a JS value the SVG renders),
// so per CLAUDE.md's centralization rule it lives here as a TS constant — NOT as a CSS custom property
// (it would then live in two files). The bar's own layout dims (height, gap, z) are pure CSS design
// values and live in _kindred/tokens.css (`--bottom-bar-*`); they are not duplicated here.

/** lucide glyph size (px) for each bottom-bar tab icon. */
export const BOTTOM_BAR_ICON_SIZE = 22;
