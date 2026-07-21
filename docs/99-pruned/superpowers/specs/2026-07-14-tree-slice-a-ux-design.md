# Tree changes — Slice A: tree UX (no backend)

**Date:** 2026-07-14
**Status:** Design — awaiting user review
**Surface:** `apps/web/app/hub/tree/*` + `apps/web/app/hub/tabs/FamilyTab.tsx`
**Supersedes parts of:** `docs/superpowers/specs/2026-07-13-tree-ego-nav-redesign.md`,
`apps/web/app/hub/tree/CONTEXT.md` (the "anchor is not re-rootable / carries no visual marker"
rules are deliberately reversed here — see §1 and §4).

## Context

The user requested ten tree changes. Feasibility research (2026-07-14) showed they are not one
change-set: six are pure UI, and four need backend work or decisions that don't exist yet
(cross-person edit authorization, a `createdByPersonId` column, contribution-count queries/pages,
invite-status plumbing). To avoid holding fast UI work hostage to a heavy authorization ADR, the
work is decomposed into four independently-shippable slices:

- **Slice A (this doc)** — tree UX, no backend.
- **Slice B** — contribution destinations (Stories-contributed / Photos-contributed / Mentions).
- **Slice C** — cross-person editing (`#4` edit affordances, `#5` unknown-opens-in-edit): needs an
  authorization ADR + a `createdByPersonId` migration + new authorized write actions.
- **Slice D** — invite affordance (`#6`): plumb invite status onto the tree node + wire the existing
  invite flow.

This doc is **Slice A only**. Items mapped here: `#1, #3, #7, #8, #9, #10`, the display half of
`#4`, and the **Focus** part of `#2`.

## §0. Load-bearing terminology (the focus / focus collision)

Two unrelated things are both called "focus" in the current code. Slice A splits them and renames
the camera one so they can never be confused again:

- **Focus person** — the *relation root*. Every relation label (`#9`) is computed against them, and
  the sex ring (`#8`) marks them. **The only thing that changes the focus person is the kebab
  `Focus` action (`#2`).** Clicking, tapping, or double-clicking a card **never** changes the focus
  person. Field name stays `focusPersonId`.
- **Camera** — pan + zoom state ("focus" only in the UI-controls sense: zoom-about-a-point,
  centering). Independent of the focus person after the initial center. The code currently calls the
  camera anchor `focusPos` and the centering fn `centerOnFocus`; **rename** to `cameraAnchor` /
  `centerCamera` (and comments accordingly). No behavior change from the rename alone.

`apps/web/app/hub/tree/CONTEXT.md` will be updated to carry this distinction and to record that the
anchor is now (a) selectable via the kebab `Focus` action and (b) carries a visual marker (the ring).

## §1. Camera behavior

- On first mount, center the initial focus person once (existing `centerCamera`).
- After that, **no automatic camera movement** — not on expand/collapse (already true), and **not on
  re-focus**. Re-focusing recomputes labels + ring + refetches kin, but the viewport holds still.
- Re-focus mechanism: the layout re-normalizes its origin when the node set changes, so to keep the
  clicked card visually stationary we compute a **pan delta** that cancels the shift of a reference
  node between the pre- and post-refocus layouts. The natural reference is the newly-focused person's
  card (it exists in both layouts): record its on-screen position at click time, and after the
  refetch/relabel adjust `pan` so it lands in the same place. (The camera anchor stays the same node
  it was; only `pan` is nudged.)

## §2. Gesture model (`#1`, `#3`, display half of `#4`)

- **Remove `PersonPanel` entirely (`#1`).** Delete `person-panel.tsx` and its wiring in
  `tree-canvas.tsx`. Its add-relative buttons already exist in the kebab; nothing is lost. `selected`
  state and the name-click→panel path are removed.
- **Pan by grabbing anywhere, including cards (`#3`).** Today the viewport background pans but cards
  stop-propagate pointer events and a card tap selects. New model: a pointer that moves past
  `DRAG_SLOP_PX` pans, **wherever it started** — background or card. Implementation: the card no
  longer stop-propagates *move*; the pan handlers on the viewport see the drag. A card only intercepts
  a *tap that did not become a drag* (for double-click detection). Carets and the kebab keep their own
  `stopPropagation` so they are never swallowed by a pan.
- **Single tap/click = no-op.** With the panel gone, a single tap does nothing but (potentially)
  start a pan.
- **Double-click / double-tap on a card → a read-only details sheet (display half of `#4`).** Edit
  mode is **Slice C** — the sheet is read-only in Slice A. Double-tap detection: two taps on the same
  card within a short window (a `DOUBLE_TAP_MS` constant, new in `tree-constants.ts`) and within the
  drag slop; a drag between them cancels it.

### The details sheet (read-only, Slice A)

Opened by double-click; dismissible (× / Escape / outside-click). Contents:

- Name (or "Unknown &lt;relation&gt;" for a bridge), dates, and relation-to-**viewer** (the existing
  `viewerRelation` derivation — keep it; it is distinct from the focus-relative chip in `#9`).
- **Navigation links (user chose to include these now):** Stories contributed · Photos contributed ·
  Mentions. Only **Mentions** has a live destination in Slice A (`/hub/about/[personId]`); Stories-
  contributed and Photos-contributed destinations are built in **Slice B**. Until then those two
  links render **disabled** with a "coming soon" affordance (not dead hrefs). The links share their
  labels/targets with the future kebab items so Slice B wires both in one place.

The sheet reuses the visual treatment the old panel had (a small floating card), but is a distinct,
simpler component (`person-details.tsx`) — read-only, no add-relative actions (those are the kebab's
job now).

## §3. Kebab — the `Focus` item (`#2`, partial)

- Add a **Focus** menu item to `KebabMenu`, placed **before** the Add… actions. Reserve the final
  menu order for when Slice B lands the other three:
  `[Stories contributed · Photos contributed · Mentions · Focus] — [Add child · Add sibling · Add
  parent · Add partner]`. In Slice A only **Focus** is added; the first three arrive in Slice B.
- **Focus action = server re-root.** It calls the existing `fetchSubtree(familyId, personId)` to
  refetch the tree rooted on that person, sets `focusPersonId` to them, recomputes relation chips and
  the ring, and applies the pan-delta from §1 so the **camera does not move**. `KebabMenu` gets a new
  `onFocus(personId)` callback (via the existing `TreeAddProvider` context or a sibling context) so it
  does not need to know canvas internals.
- The focus person's own kebab still shows Focus (harmless / no-op re-focus) — or we omit it on the
  current focus. **Default: omit `Focus` on the card that is already the focus person.**

## §4. Card visuals (`#7`, `#8`, `#9`)

### `#7` FamilySearch colors (token change)

Update `apps/web/app/_kindred/tokens.css`:

- `--sex-male: #436b95;` (was `#5C7A97`) — FamilySearch blue.
- `--sex-female: #ba412f;` (was `#B57F73`) — FamilySearch red.

(Community-sourced FamilySearch palette; FamilySearch uses blue = male, red = female.) These tokens
already drive both the top-edge sex bar and — new in `#8` — the focus ring, so both stay in sync.

### `#8` Focus ring

A solid ring in the focus person's **sex color** around the focus person's card. Implementation: the
canvas knows `focusPersonId`; pass a `focus` flag into `PersonNode` for that card, which renders a
ring (e.g. an outer `box-shadow`/`outline` in `var(--sex-male|--sex-female)`, or
`var(--border-strong)` when sex is `unknown` — user choice). A new `--tree-focus-ring-width` token (or
a `FOCUS_RING_*` constant if used in JS math — it is pure CSS, so a **token**) controls thickness.
The ring **moves** when the focus person changes (`#3`/`§3`).

### `#9` Relation-to-focus chip on every card

- Render a small chip on each card showing its **relation to the focus person**. The data already
  exists: `TreeNode.relationToRoot` *is* relation-to-focus (the projection is rooted on the focus
  person). Map via the existing `hub.kin.relationLabel`.
- **Focus person's own card:** no relation chip (`relationToRoot === "self"`).
- **Viewer's own card:** always reads **"You"** (user choice) — this label takes precedence over both
  the blank-focus case and the ordinary relation chip. If the viewer *is* the focus person, their card
  reads "You" (not blank). The viewer's personId is already available (`viewerPersonId` prop).
- Bridge / unidentified nodes: no chip (their relation is already in the name line, "Unknown …").
- This reverses `person-node.tsx`'s current "no relation line" rule; update the component comment.

New copy: a `hub.tree.youLabel: "You"` key; relation labels reuse `hub.kin.relationLabel`.

## §5. Controls row (`#10`)

Move **Fit / − / +** out of the canvas and into the **view-selector row** in `FamilyTab.tsx`,
**right-justified** (Tree | List on the left; Fit / − / + on the right; the "Drag to pan" hint can
stay near the controls or be dropped).

Wiring (honest shape — a pure state-lift is awkward because Fit/center read `layout.bounds` +
viewport size that live inside `TreeCanvas`):

- **Lift `pan` and `scale` to `FamilyTab`** as state; pass them (and their setters) into `TreeCanvas`
  as controlled props. Zoom −/+ are simple clamped `setScale` calls `FamilyTab` can own directly.
- **Keep `fit()` and the initial `center()` inside `TreeCanvas`** (they need `layout.bounds` + the
  viewport ref) and expose them via `useImperativeHandle`. `FamilyTab`'s Fit button calls the handle.
- Only the **tree** view shows the controls; the **list** view shows just the selector. `FamilyTab`
  conditionally renders the controls when `view === "tree"`.

Alternative if the imperative handle feels heavy at build time: `TreeCanvas` renders its control
buttons into a container `ref` that `FamilyTab` places in the row (portal/slot), keeping all state in
`TreeCanvas`. Decide at implementation; end result (controls right-justified in the selector row) is
identical.

## §6. Out of scope for Slice A

Explicitly deferred (each to a later slice — do **not** build here):

- `#4` **edit** affordances (edit if viewer is the person / created the person / person is deceased /
  viewer is a steward) → **Slice C**. Blocked on: no `createdByPersonId` column; no authorized
  write path for editing a non-self person; needs an authorization ADR.
- `#5` unknown card opens in **edit** mode → **Slice C** (same block).
- `#6` invite affordance for an un-invited person → **Slice D** (invite flow exists; invite status is
  not on the tree node yet).
- `#2` **Stories contributed / Photos contributed** destinations → **Slice B**
  (Stories-contributed needs a count/list query + page; Photos-contributed needs both from scratch).
  Their *links* appear (disabled) in the Slice A details sheet per §2.

## §7. Files touched (Slice A)

- `apps/web/app/hub/tree/tree-canvas.tsx` — rename camera concept; remove panel; unify pan (cards
  pannable); double-click→details; `focusPersonId` state + `onFocus`; focus ring flag; controlled
  pan/scale + imperative `fit`/`center`; pan-delta on re-focus.
- `apps/web/app/hub/tree/person-node.tsx` — relation chip + "You"; focus ring; comment updates.
- `apps/web/app/hub/tree/person-details.tsx` — **new** read-only details sheet (replaces the panel).
- `apps/web/app/hub/tree/person-panel.tsx` — **delete**.
- `apps/web/app/hub/tree/kebab-menu.tsx` — add `Focus` item (before Add…), `onFocus` wiring.
- `apps/web/app/hub/tabs/FamilyTab.tsx` — controls in the selector row; lift `pan`/`scale`; call
  `fit()` handle.
- `apps/web/app/hub/tree/tree-constants.ts` — `DOUBLE_TAP_MS` (new); focus-ring width if JS-math
  (else a token).
- `apps/web/app/_kindred/tokens.css` — `--sex-male` / `--sex-female` new values; focus-ring-width
  token.
- `apps/web/app/_copy/hub.ts` — `youLabel`, `kebabFocus`, details-sheet link labels; drop dead panel
  copy.
- `apps/web/app/hub/tree/CONTEXT.md` — record the focus-person/camera split and the re-rootable
  anchor + ring.
- Tests: `tree-layout.test.ts` / `tree-constants.test.ts` and component tests updated; new regression
  tests for pan-from-card, double-click-details, re-focus-no-camera-move, relation chip / "You",
  focus-ring-follows-focus.

## §8. Testing notes

- **Determinism** discipline holds (no `Date.now()`/`Math.random()` in layout).
- Regression tests to add (companion to the behavior changes):
  1. Dragging starting **on a card** pans the canvas (does not select / open details).
  2. Double-click on a card opens the read-only details sheet; single click does not.
  3. Re-focus via kebab changes relation chips + ring but leaves `pan`/`scale` visually put
     (the newly-focused card keeps its screen position).
  4. Relation chip renders `relationToRoot`; focus card blank; viewer card = "You".
  5. Focus ring renders in the focus person's sex color and moves on re-focus; `unknown` → neutral.
  6. Fit/zoom controls live in the selector row and drive the canvas; list view hides them.
