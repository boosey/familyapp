/**
 * Kindred theming for Clerk's hosted <SignIn>/<SignUp>/<UserButton>. A plain, serializable style
 * object — it MUST NOT import from @clerk/* so it can be imported from any module (including the
 * mock build) without pulling Clerk into the graph. Values reference the live Kindred CSS custom
 * properties (from _kindred/tokens.css) so the theme tracks the design system, not a copy of it.
 *
 * Property names follow Clerk's `appearance` API (variables + elements), verified against current
 * Clerk docs for @clerk/nextjs 6.39.5 — the current (non-deprecated) variable names are used
 * (colorForeground / colorMutedForeground / colorInput / colorInputForeground). Do not edit from memory.
 */
export const kindredClerkAppearance = {
  variables: {
    colorPrimary: "var(--accent)",
    colorForeground: "var(--text-body)",
    colorMutedForeground: "var(--text-muted)",
    colorBackground: "var(--surface-card)",
    colorInput: "var(--surface-page)",
    colorInputForeground: "var(--text-body)",
    colorDanger: "var(--accent-strong)",
    fontFamily: "var(--font-ui)",
    borderRadius: "var(--radius-md)",
  },
  elements: {
    rootBox: { width: "100%" },
    // Flatten Clerk's own card so it sits inside the AuthScreen shell, not as a competing widget.
    card: {
      boxShadow: "none",
      border: "none",
      background: "transparent",
      padding: 0,
    },
    // AuthScreen already renders the title/subtitle — hide Clerk's duplicate header.
    headerTitle: { display: "none" },
    headerSubtitle: { display: "none" },
    formButtonPrimary: {
      backgroundColor: "var(--accent)",
      color: "var(--accent-on)",
      fontFamily: "var(--font-ui)",
      borderRadius: "var(--radius-md)",
      textTransform: "none",
    },
    formFieldLabel: { fontFamily: "var(--font-ui)", color: "var(--text-meta)" },
    formFieldInput: {
      background: "var(--surface-page)",
      borderColor: "var(--border)",
      borderRadius: "var(--radius-md)",
      color: "var(--text-body)",
    },
    footerActionLink: { color: "var(--accent-strong)", fontWeight: 600 },
  },
} as const;
