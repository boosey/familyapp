# Centralization audit — user-facing copy & tweakable constants (2026-07-14)

Read-only audit of adoption against the approved plan
[`docs/superpowers/plans/2026-06-28-centralize-copy-constants.md`](../plans/2026-06-28-centralize-copy-constants.md)
and its [design spec](../specs/2026-06-28-centralize-copy-constants-design.md), plus the fixes landed on
branch `worktree-centralize-constants`.

## Headline

- **Strings (i18n on-ramp): healthy.** The 2026-06-28 plan is ~81% adopted — 7 `_copy/*` namespaces,
  ~300 keys, dynamic strings already as arrow functions. Only 3 leaky call sites remained.
- **Tweakable constants: the real gap.** The family-tree renderer carried ~40 inline magic numbers, and
  two values were genuinely *forked* across files (a latent correctness bug, not a style nit).
- **CSS: token-disciplined.** Colors/spacing/radii/type already live in `_kindred/tokens.css`. The gap is
  inline `px`/`rem` bypassing tokens, not hardcoded colors.

## What was fixed on this branch

### P0 — `NODE_W`/`NODE_H` fork (correctness bug)
The card dimensions the entire tree geometry is computed from were declared **twice** — `tree-layout.ts`
(layout math) and `person-node.tsx` (card render, imported by `tree-canvas.tsx`). Bumping one and not the
other silently desynced the math from the render, pointing carets/connectors at the wrong card edge.
Collapsed to a single source in the new `apps/web/app/hub/tree/tree-constants.ts`; `tree-layout.ts`
re-exports the primitives so its public surface is unchanged. Regression test:
`tree-constants.test.ts` (single-source equality + a source scan that fails if a copy returns).

### P1 — tree-constants.ts extraction
New module is the single home for the tree's tweakable knobs: card geometry, generation gaps, zoom/pan
bounds, and the monogram color knobs. The **affordance↔card overlap** (the thing you asked about) is now a
first-class knob: `CARET_OVERLAP_FRACTION = 0.25`, with `CARET_GAP` **derived** from it and the button
size — previously coupled only by a code comment ("keep in sync with `size` in tree-canvas.tsx").

### P1 — batch-cap dedup
"Max photos per import batch" (`30`) lived in **four** files across the client/server boundary, kept in
sync by hand. Now `PHOTO_BATCH_MAX_FILES` in `lib/constants.ts`; the picker-poll timings were deduped the
same way. Guard: `album/photo-batch-cap.test.ts`.

### P2 — 3 leaky strings
`StoryEditor` (Cancel/Save/Saving + `genericError`), `KindredProseEditor` aria-label, `OwnerActionMenu`
options labels — all now route through `_copy` (`hub.storyDetail.*`, `common.proseEditor.ariaLabel`).

## Deliberately NOT done (with rationale)

- **`DEFAULT_MAX_TOKENS = 4000` in `llm-anthropic` and `llm-groq`** — flagged as duplicated, left as-is.
  Coupling two independent vendor adapters via a shared constant to dedup a *coincidental* value adds an
  unwanted dependency edge; the true single source is the caller's `maxOutputTokens` (these are only
  fallbacks). Not worth the coupling.
- **Card font-sizes / paddings in `person-node.tsx`** (`1.35rem`, `0.95rem`, `22px 12px 14px`, …) and
  various per-component sizes — real but low-blast-radius. Left for incremental follow-up; the guard below
  covers the classes that actually caused bugs.
- **Scattered single-file timing knobs** (`SNAPSHOT_DEBOUNCE_MS`, poll intervals, R2 presign expiry, …) —
  already named and tweakable in their own file; "wrong-home", not "duplicated". Low ROI to relocate.

## Placement rule (adopted; see CLAUDE.md)

1. **Pure visual, no JS math** (color, font-size, radius, border) → a CSS custom property in
   `_kindred/tokens.css`. Never a hardcoded hex/px in a component.
2. **Used in JS arithmetic** (geometry, zoom bounds, thresholds, limits) → a TS constant
   (`tree-constants.ts`, a package `constants.ts`, or `lib/constants.ts`). The same number must never live
   in two places.
3. **Computed-then-rendered** (e.g. a slider value clamped in JS then drawn) → JS sets a CSS custom
   property; CSS consumes it. Single source = the JS.
4. **User-facing text** → `apps/web/app/_copy/{namespace}.ts` (`as const`; dynamic strings as arrow fns).

## Verification

`pnpm --filter @chronicle/web typecheck` clean; full web suite **890 passed / 122 files**; new guard +
regression tests green.
