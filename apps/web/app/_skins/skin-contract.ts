/** Every token a skin is REQUIRED to define. Skin-neutral tokens (type scale, spacing, touch,
 * tracking) live in the base :root and are intentionally NOT part of this per-skin contract.
 *
 * NOTE (known limitation): this is a HAND-MAINTAINED allowlist. The guard test asserts each listed
 * token is defined per skin, but does not cross-check against what components actually consume via
 * var(--…). Adding a NEW consumed token means adding it here too, or a skin could omit it silently.
 * Follow-up (Phase 2+): derive this list by scanning `var(--…)` usage across the src tree. */
export const REQUIRED_SKIN_TOKENS = [
  "--surface-page","--surface-card","--surface-sunken",
  "--text-body","--text-muted","--text-meta","--text-danger",
  "--accent","--accent-strong","--accent-soft","--accent-on",
  "--support","--support-soft","--border","--border-strong","--focus-ring",
  "--shadow-sm","--shadow-card","--shadow-lift",
  "--font-display","--font-read","--font-ui","--font-story","--font-mono",
  "--radius-sm","--radius-md","--radius-lg","--radius-xl","--radius-pill",
  "--ease-quiet","--dur-fade","--dur-settle","--dur-pulse",
  "--deco-coral","--tape-bg","--tilt-shadow","--highlighter","--tell-card-bg","--accent-gradient",
  "--sticker-coral-bg","--sticker-coral-ink",
  "--sticker-sky-bg","--sticker-sky-ink",
  "--sticker-leaf-bg","--sticker-leaf-ink",
  "--sticker-gold-bg","--sticker-gold-ink",
] as const;
