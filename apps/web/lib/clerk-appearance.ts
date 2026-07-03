/**
 * Kindred theming for Clerk's hosted <SignIn>/<SignUp>/<UserButton>. A plain, serializable style
 * object — it MUST NOT import from @clerk/* so it can be imported from any module (including the
 * mock build) without pulling Clerk into the graph.
 *
 * SPLIT OF RESPONSIBILITY (read before adding element styles here):
 * `variables` are resolved by Clerk at the widget WRAPPER, where the Kindred tokens exist, so
 * `var(--accent)` works and the computed value inherits into Clerk's internals — keep the palette
 * here. But `elements` styles are applied ON Clerk's own form controls, and Clerk RESETS CSS custom
 * properties on those controls — so a `var(--token)` placed on a control resolves to EMPTY and the
 * control silently paints with Clerk's defaults (this is what left the primary button transparent).
 * Therefore the token-based VISUAL styling of the controls (button/input/label/social/divider/card)
 * lives in global CSS instead — see the "Clerk … Kindred theme" block in app/globals.css, which
 * re-asserts the tokens with `inherit` before using them. Only put styles here that use LITERAL
 * values (no `var(--…)`) or are pure structural hides. Do NOT reintroduce `var(--…)` element styles.
 *
 * Variable names follow Clerk's modern `appearance` API, verified against @clerk/nextjs 6.39.5.
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
    // AuthScreen already renders the title/subtitle — hide Clerk's duplicate header. Structural
    // hides use literal values, so (unlike var()-based styling) they apply fine on reset controls.
    headerTitle: { display: "none" },
    headerSubtitle: { display: "none" },
  },
} as const;
