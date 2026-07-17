/** Every token a skin is REQUIRED to define. Skin-neutral tokens (type scale, spacing, touch,
 * tracking) live in the base :root and are intentionally NOT part of this per-skin contract. */
export const REQUIRED_SKIN_TOKENS = [
  "--surface-page","--surface-card","--surface-sunken",
  "--text-body","--text-muted","--text-meta",
  "--accent","--accent-strong","--accent-soft","--accent-on",
  "--support","--support-soft","--border","--border-strong","--focus-ring",
  "--shadow-sm","--shadow-card","--shadow-lift",
  "--font-display","--font-read","--font-ui","--font-story","--font-mono",
  "--radius-sm","--radius-md","--radius-lg","--radius-xl","--radius-pill",
  "--ease-quiet","--dur-fade","--dur-settle","--dur-pulse",
] as const;
