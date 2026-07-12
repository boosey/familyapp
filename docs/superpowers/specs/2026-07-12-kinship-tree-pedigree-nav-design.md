# Kinship tree — pedigree navigation (design)

**Date:** 2026-07-12
**Status:** Approved design, pre-plan
**Branch/worktree:** `worktree-tree-pedigree-nav` off `kinship-integration` @ `580e63c`
**Supersedes (nav only):** the expand/collapse interaction in
`2026-07-12-kinship-tree-viz-design.md` §7 and
`2026-07-12-kinship-tree-interactions-design.md`. The auth surface, read path
(`resolveKinshipTree`, `fetchSubtreeAction`), and the `ResolvedKinshipEdge`
contract are **unchanged** and reused. **One additive data-model change:** a
nullable `sex` attribute on `persons` (new migration), surfaced through
`TreeNode`, to drive card color only (see "Person sex attribute" below).

## Problem

The current `/hub/tree` renderer lays generations top-to-bottom and hangs a
per-box expand/collapse caret on the top (ancestors) and bottom (descendants)
edge of every node, plus a select-then-second-tap re-root gesture. In practice
this is cluttered and confusing: carets everywhere, an accidental-re-root
gesture, and no clear "which way is back in time."

We are replacing the navigation model with a FamilySearch-style **directional
pedigree**, keeping the existing data/read/auth layers intact.

## Goals

- Ancestors read in one fixed direction, descendants in the other — no ambiguity.
- One expansion mechanism (an edge chevron at the frontier), not a caret per box.
- Deliberate, never-accidental re-rooting.
- A clear, ungendered add-relative surface (child / sibling / parent / partner)
  reachable both globally (the root) and per-card (any person).
- Preserve the ability to represent an **unnamed "bridge" person** who exists
  only to connect a known relationship across a generation (e.g. a granddaughter
  to her grandmother through an as-yet-unnamed parent).

## Non-goals (v1)

- Multiple spouses / remarriage. v1 gates "Add partner" to when the person has
  no loaded partner; the multi-partner case is a deferred follow-up.
- **Gendered relation labels** (mother/father, grandmother/grandfather). Labels
  stay ungendered ("parent," "partner," "grandparent"). The new `sex` attribute
  drives **card color only** — it does not change any relation label. Gendered
  labels remain a deferred follow-up (kinship-repository.ts:170–172).
- Zoom-to-fit-all, minimap, print/export. Pan + Fit + ±zoom only, as today.

## The model we are replicating (FamilySearch landscape, observed)

- Directional pedigree: focus center; **ancestors extend one way, descendants
  the other**; a strict line, siblings/collaterals minimized.
- Expansion is a single chevron on the outer frontier that loads the next
  generation outward. No scattered collapse controls.
- Empty relationship positions are inline `ADD …` placeholders.
- Clicking a person opens a detail panel with an explicit **re-root** action.

## Decisions (locked with product owner)

1. **Layout:** directional pedigree — **ancestors right, descendants (children)
   left**, focus at x=0 — **plus** the focus person's siblings stacked in the
   focus column.
2. **Cards:** keep **one card per person** (existing `PersonNode`); a couple is
   two adjacent same-generation cards joined by the existing partner connector.
   (No merged two-name card.)
3. **Sibling order:** stack the focus generation by **birth year** (nulls last,
   stable by id); partners kept adjacent via the existing union clustering.
4. **Re-root:** the **only** trigger is a **"Center tree here"** button in the
   detail panel. The select / second-tap gesture is removed.
5. **Name click → detail panel.** (Card body is not a separate target.)
6. **Add affordances (all ungendered):**
   - A shared `KebabMenu` offering **Add child**, **Add sibling**,
     **Add parent** *(when the person has <2 loaded parents)*, **Add partner**
     *(when the person has no loaded partner)*.
   - Mounted **twice**: a **global ⋮** in the toolbar (target = current root) and
     a **per-card ⋮** (target = that card's person).
   - **Inline "Add parent" slot**: when a drawn node has zero parent edges and
     `hasHiddenParents === false`, the layout emits an empty parent slot on the
     ancestor side. Clicking it opens the add-parent flow anchored on that node —
     this is how the connecting (possibly unnamed) bridge person gets created.
7. **Sex-colored card accent.** A nullable `sex` (male / female / unknown) on
   `persons` drives a card color bar: male / female tokens, and the existing
   neutral monogram styling for `unknown`/null (incl. unnamed bridge nodes).
   Captured optionally in the add-relative flow; editable on the profile surface.

## Architecture

Reused unchanged: `fetchSubtreeAction`, `merge.ts`, `relabel.ts`, and the
`ResolvedKinshipEdge` contract. `TreeNode` gains one field (`sex`);
`resolveKinshipTree` projects it. Work spans `apps/web/app/hub/tree/*`,
`apps/web/app/hub/kin/*` and the profile surface, `@chronicle/db` (schema +
migration), and `@chronicle/core` (`TreeNode`, kinship read), plus copy strings.

### Person sex attribute (`@chronicle/db`, `@chronicle/core`, write/edit)

- **Schema (`@chronicle/db/schema.ts`):** add `sex` to `persons`. Postgres enum
  `person_sex` = `('male','female','unknown')`, column nullable with default
  `'unknown'` (null and `'unknown'` are treated identically downstream). Run
  `db:generate` → new incremental migration `NNNN_*.sql` (chain currently at
  0011 on this branch → **0012**); no invariant change. The snapshot
  (`schema.sql`) and the drift-guard test update together.
- **Domain type:** export `PersonSex = 'male' | 'female' | 'unknown'` from
  `@chronicle/db` and re-export via `@chronicle/core`.
- **`TreeNode.sex: PersonSex`** — added to the interface; `resolveKinshipTree`'s
  SQL selects `persons.sex` (coalescing null → `'unknown'`). Bridge/unidentified
  nodes surface `'unknown'`. This is metadata-safe (no new PII beyond what the
  node already exposes) and passes through the subject-hide overlay unchanged.
- **Write (add-relative):** `/hub/kin` add form gains an optional Sex select
  (male / female / prefer not to say → `unknown`); `addRelative` accepts and
  persists it on the created person. Default `unknown` when omitted.
- **Edit:** the profile / person-edit surface gains a Sex control writing the
  same column through the existing person-update path.

### `tree-layout.ts` — rewrite the placement half only

Keep (direction-agnostic): node/edge dedup + deterministic sort, BFS generation
assignment from root, the default ±N window + fixpoint reveal of expanded
frontier kin, and union/cluster adjacency.

Change:

- **Axis transpose.** Generation maps to **x**: `x = -generation * COL_STEP`
  (ancestors, negative generation, land at positive x → right; descendants at
  negative x → left). Focus at x=0.
- **Vertical stacking within a generation** by birth year (nulls last, id
  tiebreak), keeping union clusters contiguous. This replaces the old
  parent-centering x-sweep, now applied on the y-axis per column.
- **Expansion state shrinks** to `{ expandedParents, expandedChildren }`.
  Remove `collapsedAncestors` / `collapsedDescendants` and all collapse logic.
- **Affordance model changes** from per-box carets to two emitted lists:
  - `FrontierChevron[]`: one per node with `hasHiddenParents` (placed on its
    right/ancestor edge) or `hasHiddenChildren` (left/descendant edge). Activating
    it calls the existing `revealFetch` in that direction.
  - `EmptyParentSlot[]`: one per drawn node with zero parent edges and
    `hasHiddenParents === false` (placed on the ancestor edge). Carries the anchor
    personId for the add-parent link. (Children/partner adds are kebab-only.)
- Connectors: same elbow geometry, re-derived for the horizontal axis
  (parent right-edge → child left-edge; partner link vertical between adjacent
  same-generation cards).
- Bounds must enclose cards, chevrons, and empty slots.

The function stays **pure and deterministic** — a pure function of
`(nodes, edges, rootPersonId, expansion)`.

### `tree-canvas.tsx` — interaction rewrite

- Remove `selected`-as-reroot and the `TAP_SLOP` second-tap logic. A node's
  name click sets `selected` → opens `PersonPanel` (read-only).
- `PersonPanel` gains an `onRecenter(personId)` prop wired to the existing
  `recenterOn` (fetch neighborhood → merge → relabel → reset expansion → smooth
  pan). This is the sole re-root path.
- Render `FrontierChevron[]` (→ `revealFetch`) and `EmptyParentSlot[]` (→ add
  link) from the layout instead of the old caret list.
- Toolbar gains a **global ⋮** (`KebabMenu` targeting `rootPersonId`).
- Keep drag-pan, Fit, ±zoom.

### `person-node.tsx`

- Keep single-card presentation and all four visual states (You / living /
  deceased / anonymous bridge).
- Add an optional **per-card ⋮** button (top-right of the card) that opens the
  `KebabMenu` for that node.
- **Sex color bar:** a left-edge accent colored by `node.sex` — `--sex-male`,
  `--sex-female`, or (for `unknown`/null, incl. bridge nodes) no bar / the
  existing neutral treatment. New Kindred tokens `--sex-male` / `--sex-female`
  (final hex pulled from the design system; mockup used a slate `#5C7A97` and a
  clay-rose `#B57F73` as stand-ins). The root/You accent border still wins over
  the sex bar.

### `person-panel.tsx`

- Add the primary **"Center tree here"** button (hidden when the node is already
  the root).
- Add **"Add partner"** to the existing parent/child/sibling links (all via
  `/hub/kin?scope=&anchor=&relation=`). Relation value `partner` (matches the
  `partnered_with` edge).

### `kebab-menu.tsx` (new, shared)

- Props: `{ node, familyId, parentCount, partnerCount }` (counts from loaded
  adjacency, computed in the canvas from `edges`).
- Renders Add child / Add sibling always; Add parent when `parentCount < 2`;
  Add partner when `partnerCount === 0`. Each is a link to the `/hub/kin` add
  flow anchored on `node.personId`. Disabled items are omitted (or shown disabled
  with a reason — implementation detail).

### Copy (`app/_copy`, `hub.tree.*`)

Add: `centerHere`, `addPartner`, kebab labels, empty-slot label ("Add parent"),
frontier-chevron aria labels ("Show earlier generations" / "Show descendants"),
and the Sex select labels ("Male" / "Female" / "Prefer not to say").

## Data flow

1. Server renders `/hub/tree` with an initial `KinshipTreeData` (root = viewer).
2. Canvas holds `nodes`/`edges`/`expansion`/`rootPersonId`; `computeTreeLayout`
   is a pure `useMemo`.
3. Frontier chevron → `revealFetch(direction, personId)` → `fetchSubtreeAction`
   → merge → relabel to current root → grow `expandedParents/Children`.
4. Panel "Center tree here" → `recenterOn(id)` → fetch → merge → relabel to `id`
   → reset expansion → `setRootPersonId(id)` → smooth pan + shallow `?root=` sync.
5. Any add action → navigate to `/hub/kin?scope=<family>&anchor=<id>&relation=<r>`
   (existing #32 write path; add `relation=partner`).

## Validity gates (best-effort, from loaded adjacency)

- **Add parent** shown when `< 2` parent edges are loaded for the person AND the
  node does not report `hasHiddenParents` for the missing slots. Within the
  default window a drawn node's own parents are materialized, so this is reliable
  near the root; deep frontier nodes fall back to the chevron.
- **Add partner** shown when `0` partner edges are loaded (v1 simplification;
  remarriage deferred).

These are UI affordance gates only; the `/hub/kin` write path remains the
authority and re-validates.

## Error handling

Unchanged from today: `fetchSubtree` failures set `loadError` and keep prior
data; auth/family re-validation lives in `fetchSubtreeAction` and
`resolveKinshipTree` (defense in depth). Empty tree (root only) renders the root
card with its add affordances and no chevrons.

## Testing

- **`tree-layout.test.ts` (rewrite/extend):**
  - ancestors place at positive x, descendants at negative x, focus at 0;
  - within-generation vertical order follows birth year (nulls last, id tiebreak);
  - union partners stay adjacent in a column;
  - `FrontierChevron` emitted iff `hasHiddenParents`/`hasHiddenChildren`;
  - `EmptyParentSlot` emitted iff zero parents AND not `hasHiddenParents`;
  - no collapse state exists; determinism (same input → same output);
  - unnamed bridge node still places and connects.
- **`kebab-menu` component test:** parent gate at 2, partner gate at 1, anchored
  link targets.
- **`tree-canvas` / panel test:** name click opens panel; "Center tree here"
  invokes recenter with the node id; frontier chevron invokes reveal in the
  right direction; no re-root on plain node click.
- **Sex attribute:**
  - migration drift-guard (snapshot vs chain) stays green with `0012`;
  - `resolveKinshipTree` projects `sex`, coalescing null → `'unknown'`;
  - `addRelative` persists a supplied sex and defaults to `'unknown'`;
  - `person-node` renders `--sex-male`/`--sex-female` bars and no colored bar for
    `unknown`/bridge; root accent overrides.

## Open items (tracked, not blocking)

- Multiple partners / remarriage (relaxes the Add-partner gate and the union
  clustering assumptions).
- Exact "hidden parent slot" precision for deep frontier nodes may want a
  per-node `parentSlotsOpen` count from the read layer rather than inference.
- Ungendered "Add parent" UX when two parents are added one at a time (labeling
  the two slots without sex).
