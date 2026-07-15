# ADR-0020 — UI constants are set-once compile-time; only per-user app preferences vary at runtime

Status: Accepted (2026-07-14)

Follows the constants-centralization work (the `_copy/*` copy modules, per-package `constants.ts`,
`hub/tree/tree-constants.ts`) which put every user-facing string and tweakable UI number in one place.
That raised two questions this ADR settles: can a developer/designer change these live in production
without a redeploy, and how do we mark the few that an end-user may set?

## Context

Once the constants were centralized, "one place to change a value" invited "change it *without shipping
code*." Two audiences were conflated under that phrase:

1. **Developer/designer tuning** — nudging a border width, a color, tree-node spacing.
2. **End-user preference** — a specific person choosing their own text size or theme.

The app already ships two working end-user preferences — reading size and color palette — each
hand-rolled: a value in `localStorage`, an apply function that mutates the document (`documentElement.
style.fontSize`, `data-theme`), bespoke validation, and a duplicate of that apply/validate logic inside
the pre-paint inline script in `app/layout.tsx`. The glossary (CONTEXT.md § Identity & membership,
**Settings**) already defines these as *device-local app preferences, not identity*.

The tempting design was a unified runtime-config system (a `knob()` registry with `code | runtime | user`
scopes, global overrides served from Vercel Edge Config, per-user overrides in `localStorage`). On
inspection the "developer runtime" half does not earn its cost **for this app**: these constants are
tuned once during design and then never change; the payoff of "no redeploy" is marginal against a ~90s
Vercel deploy, while the cost is real — an external store that can drift from code, a fail-safe read on
every render (a new outage surface), and a second source of truth. This mirrors the repo's existing
posture on prompt storage (DECISIONS.md § Prompt storage: defer the swap-without-redeploy store until a
concrete trigger) and single-schema/no-migrations (defer until users exist).

## Decision

**UI constants are compile-time defaults, changed only by redeploy. The single class of value that
varies at runtime is the per-user app preference.**

- **No developer runtime-config layer.** Vercel Edge Config and a developer tuning panel are both
  **rejected** (not merely deferred): a set-once value does not need a live-edit channel, and redeploy is
  the correct tool for changing code. Tree geometry (`NODE_W`, `PARTNER_GAP`, `GEN_V_GAP`, the
  affordance offset) and every other non-preference constant stays compile-time.

- **App preferences are a declarative, opt-in registry.** A constant stays a plain `export const` until
  it is deliberately promoted to a registered preference — promotion *is* the act of "designating the
  few." The two existing preferences (reading size, theme) are folded in as its first entries; the
  pre-paint script becomes registry-driven instead of special-casing them by hand, collapsing today's
  triplicated apply/validate logic to one source.

- **A preference is serializable data, not code.** Because its apply logic must run in three places —
  the pre-paint inline script (which cannot import TS), the React control, and validation — a preference
  entry carries **no functions**. It is `{ key, storageKey, default, strategy, target, validate }` where
  `strategy` is a **closed enum** (`css-var` | `data-attr` | `root-font-size`), each with one applier
  written once in vanilla JS and once in TS, and `validate` is **declarative** (numeric range, enum, or
  regex) so it serializes into the injected script and runs unchanged in React.

- **Preferences are browser-applied, so JS-math values cannot be preferences today.** A value that
  JavaScript does arithmetic on — chiefly the tree geometry, whose SVG coordinates are computed over the
  whole tree graph and are irreducibly not expressible as a CSS variable — cannot ride the
  `localStorage → pre-paint → --var` path. If a *specific* JS-math value is ever wanted as a per-user
  preference (e.g. "this person's tree is more spread out"), it is added then by introducing a `js-read`
  strategy — the tree code reads the stored value via a resolver seam instead of the browser applying it.
  The closed-enum design makes that **additive** (one new applier), so this boundary constrains what is
  built now without foreclosing the future.

- **Preferences stay device-local (`localStorage`).** This holds the glossary's "device-local, not
  identity" line. A per-account (Neon) layer that syncs a person's preferences across devices is a
  conscious future change to that definition — it moves preferences from device-local to identity — and
  is not built now.

## Consequences

- The centralized constants keep their compile-time nature and type-inlining; nothing about the
  just-completed centralization is undone. Promotion to a preference is a per-constant opt-in, never a
  wholesale migration.
- The pre-paint script, the control components, and validation stop duplicating per-preference logic:
  the registry is the single source, the fancy existing controls (segmented reading-size, theme swatches)
  stay bespoke but become thin wrappers over the registry API, and new simple preferences get a generic
  registry-driven control.
- A future reader will ask "why isn't any of this runtime-configurable, and why can't tree geometry be a
  preference?" — this ADR is the answer: set-once constants don't warrant a live channel, and the
  preference system is deliberately browser-applied/serializable, with JS-math parked behind an additive
  `js-read` strategy.
- Adding an apply-strategy (e.g. `js-read`) or a storage backend (Neon per-account) is an additive change
  against the closed-enum registry, not a redesign — the extension points are named on purpose.

## Alternatives considered

- **Global runtime override via Vercel Edge Config.** A live-editable, globally-replicated store read at
  render, changed from a dashboard with no redeploy. Rejected: the constants it would serve are set once
  and never change, so the benefit is marginal, while it adds an external source of truth that can drift
  from code and a fail-safe read that becomes a new site-outage surface.
- **Developer tuning panel (localStorage dev overrides + a resolver seam).** Would let the developer drag
  a slider and watch tree spacing change live in-browser. Rejected as overkill: geometry is tuned once
  during design; the panel's build cost dwarfs its lifetime use, and it is device-local to the developer
  anyway.
- **Comprehensive registry** (every constant registered with a scope). Rejected for opt-in: a full
  catalog is a large mechanical migration that loses compile-time inlining across the board to serve only
  a speculative admin panel.
- **Per-account (Neon) preference storage now.** Rejected for `localStorage`-first: it contradicts the
  current "device-local, not identity" glossary definition, needs a migration and a write path, and no
  cross-device requirement exists yet. Left as a deliberate, additive future change.
