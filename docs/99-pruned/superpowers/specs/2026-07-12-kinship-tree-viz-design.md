> **SUPERSEDED (2026-07-13)** by `docs/superpowers/specs/2026-07-13-tree-ego-nav-redesign.md`.
> The re-rootable pedigree model here is retired; do not build from this file.

# Kinship Tree Visualization — v1 Design

Date: 2026-07-12
Status: Approved (brainstorming) — ready for implementation planning
Anchor: ADR-0016 (the deferred **visual tree renderer** seam; "rendering the family tree is a query over that family's edges")

## 1. Summary

A per-family, read-first **visual family tree** at `/hub/tree`. It renders a generational
diagram anchored on the viewer, lets them orient and navigate their kin, tap a person for
details, and jump to that person's stories or re-center the tree on them. It is a **projection
over existing kinship data** — it introduces no new authorization surface and (with one small
exception, §4) no new data model. Adding, editing, and governing edges stay on the existing
`/hub/kin` forms; the tree never writes.

## 2. Locked decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Primary job | **Orient & navigate** (read-first). Not a workspace, not a storytelling lens. |
| Layout paradigm | **Generational rows** (classic pedigree), legibility over spectacle. |
| Anchoring | **You-anchored, re-centerable.** Default root = viewer's `self` Person; tapping a person can re-root. |
| Tap behavior | **Open a read-only detail panel** (no layout jump on tap). |
| Node content | **Avatar nodes**, **monogram-only in v1** (deterministic color + initial; real photos deferred). |
| View scope | **Bounded neighborhood** (~±2 generations around root), with progressive disclosure. Fetch is **bounded + incremental server-side** (never "load the whole family") so it scales to large/imported trees. |
| Progressive disclosure | Per-node **expand/collapse** of hidden parents/children, plus per-**generation-level** collapse. Affordances render as **medium-weight chevron carets**, not heavy arrows. |
| Canvas motion | **Pan** (drag) + a **Fit** control. **No zoom** in v1. |
| Governance on tree | **None.** Denied/hidden edges already don't draw; no affirmed badges. |
| Rendering tech | **Hand-rolled**: a pure layout function + SVG render + CSS/viewBox pan. No graph-layout library, no React Flow. |

## 3. Where it lives

- **Route:** `apps/web/app/hub/tree/page.tsx` (React Server Component).
- **Query params:**
  - `?scope=<familyId>` — the family whose projection is drawn (consistent with the rest of the
    hub; validated against the viewer's own active families, falling back to their first active
    family, exactly as `/hub/kin` does).
  - `?root=<personId>` — the person the tree is anchored on. Absent ⇒ the viewer's `self` Person.
    Present ⇒ validated to be a node within the family projection. A re-centered view is therefore
    **deep-linkable**.
- **Cross-linking:** `/hub/kin` gains a prominent "Family tree" link to `/hub/tree` (and vice-versa,
  a "Manage kin" affordance in the tap panel). `/hub/tree` is a standalone deep-link surface with a
  back-link, matching `/hub/kin` / `/hub/about/[personId]` conventions (it is not a hub tab).

## 4. Data model change — death fields

The schema currently has `persons.birthYear`, `persons.birthDate`, and `persons.lifeStatus`
(`living | deceased`) but **no death date**. A deceased node can therefore only say "in memory,"
never a `1920–1998` life span. We add the symmetric fields:

- `persons.deathYear` — `integer`, nullable. The coarse anchor shown on nodes.
- `persons.deathDate` — `date`, nullable. Full date when known (mirrors `birthDate`).

Both nullable, both defaulting to NULL (existing rows backfill to NULL). One incremental migration
(next number in the drizzle chain; schema.ts is the source of truth → `db:generate` emits it).

**Capture path (so the fields are never write-only):** extend the existing `/hub/kin`
add-relative form with an optional **"Year of death"** field, shown only when *Life status =
deceased*. This threads through `addRelativeAction` → `addRelative`'s `AddRelativeInput`
(`deathYear?`, `deathDate?`). Editing an existing relative's death year is **out of scope for this
spec** (there is no edit-a-relative flow yet; when one lands it carries these fields). v1 only needs
create-time capture + display.

## 5. Core read — `resolveKinshipTree`

One new authorized read in `packages/core/src/kinship-repository.ts` (already on the architecture-test
allowlist — no new content-door entry).

```ts
resolveKinshipTree(db, ctx, familyId, rootPersonId, window?): KinshipTreeData

// `window` bounds how much of the graph is materialized in one read. Default ±2 generations
// from root. This is the scalability seam: the read fetches a BOUNDED NEIGHBORHOOD, never the
// whole family, so a 10,000-person imported tree costs the same first read as a 10-person one.
type TreeWindow = { generationsUp: number; generationsDown: number };

type KinshipTreeData = {
  familyId: string;
  rootPersonId: string;
  nodes: TreeNode[];            // only the persons within `window` of root
  edges: ResolvedKinshipEdge[]; // parent_of (directed) + partnered_with (normalized), among loaded nodes + boundary
};

type TreeNode = {
  personId: string;
  displayName: string | null;   // null ⇒ anonymous bridge, render from relation
  identified: boolean;
  lifeStatus: "living" | "deceased";
  birthYear: number | null;
  deathYear: number | null;
  relationToRoot: KinRelation | "self" | null; // via deriveKin(loaded edges, root); null if unrelated/bridge-only
  // Boundary flags — TRUE when this person has parents/children that exist in the family
  // projection but were NOT materialized in this window. They drive the expand carets AND tell
  // the client that expanding requires a server fetch (vs. a purely client-side reveal).
  hasHiddenParents: boolean;
  hasHiddenChildren: boolean;
};
```

Behavior and guarantees:
- Composes `resolveKinshipProjection(db, ctx, familyId)` — so it inherits **family-membership
  gating** and the **subject-hide overlay** (hidden edges never appear) for free. Anonymous viewers
  are rejected upstream, as elsewhere on the kinship surface.
- **Bounded, incremental fetch (scales to large families).** The read walks outward from `root` only
  as far as `window`, materializing that neighborhood plus its boundary. It computes
  `hasHiddenParents` / `hasHiddenChildren` from edge *existence* at the boundary (cheap: does this
  person have a `parent_of`/child edge beyond the window?) without hydrating those extra nodes. The
  whole family is **never** required in memory or on the wire.
- **Expansion round-trips when it must.** Revealing kin that are already inside the loaded window is a
  client-side reveal (no round-trip). Revealing kin *at the boundary* (a `hasHidden*` node) issues a
  follow-up `resolveKinshipTree` centered/re-windowed to load that subtree, then merges it into the
  client's node/edge set. Re-centering (`?root=`) is likewise a server read. So small families
  effectively load in one shot; large families load lazily as the user explores — same UX either way.
- Hydrates each materialized Person (name, identified, life status, birth/death year) behind the
  kinship front door; attaches `relationToRoot` via the existing pure `deriveKin`.
- Kinship metadata only — consistent with ADR-0016's "kinship never drives authorization." The tree
  exposes names/relations/coarse life data, never Story/Media content; the sole jump to content
  ("Stories about them") routes through the existing SEE-gated `listStoriesAboutPerson`.

## 6. Pure layout module — `computeTreeLayout`

The heart of the hand-rolled approach. A **dependency-free, unit-tested pure function** living in the
web app (e.g. `apps/web/app/hub/tree/layout.ts`). Types only; no DB, no React — safe to run on server
or client and trivial to test.

```ts
computeTreeLayout(
  nodes: TreeNode[],
  edges: ResolvedKinshipEdge[],
  rootPersonId: string,
  expansion: ExpansionState,
): TreeLayout

type ExpansionState = {
  // nodes whose hidden parents / children have been revealed
  expandedParents: Set<string>;
  expandedChildren: Set<string>;
  // whole generations the user has collapsed (relative to root: -2, -1, 0, +1, ...)
  collapsedGenerations: Set<number>;
};

type TreeLayout = {
  placed: PlacedNode[];       // { personId, x, y, generation }
  unions: PlacedUnion[];      // partner pairs, for the partner link glyph
  connectors: Connector[];    // parent→child + partner path geometry
  bounds: { width: number; height: number };
  affordances: Affordance[];  // per-node caret up/down where hidden kin exist; per-generation collapse
};
```

Algorithm:
- **Generation assignment:** root = generation 0; BFS over `parent_of` (a parent is child − 1, a
  child is parent + 1) and `partnered_with` (same generation). Partners are placed **adjacent** as a
  union; children are centered under their parents' union midpoint; siblings share parents.
- **Bounding:** include only generations within ±2 of root by default; a node/level outside the
  window is omitted unless the corresponding `expansion` entry reveals it.
- **Affordances:** a node gets an **up caret** iff it has parents not currently drawn — whether those
  are already loaded (client reveal) or beyond the window (`hasHiddenParents` ⇒ triggers a fetch); a
  **down caret** likewise (`hasHiddenChildren`); each generation row gets a **collapse caret**. The
  layout function is agnostic to *how* the node set grows — it re-runs on whatever nodes/edges are
  present. Fetching more is the client's job (§7), keeping the layout pure.
- **Determinism:** stable ordering within a generation (by `seq`, then name) so the same data always
  lays out identically — matching the repo's determinism discipline.
- **Awkward shapes handled explicitly:** multiple partners (one node, side-by-side unions), cousins
  sharing grandparents (a DAG "diamond" — position by generation, accept shared-ancestor connectors),
  anonymous bridge nodes (rendered from relation), and root-only / disconnected families (draw just
  the root's reachable component; unreachable clusters are reached by re-centering).

## 7. Client components

- **`TreeCanvas`** (client component) — owns the loaded `nodes`/`edges`, `expansion`, and `pan` state;
  calls `computeTreeLayout`; renders nodes + connectors as SVG (or absolutely-positioned HTML node
  cards over an SVG connector layer); implements drag-to-pan (translate the viewBox / a transform) and
  a **Fit** button that reframes on the root. No zoom. **Fetch-on-expand:** when a boundary caret
  (`hasHidden*`) is tapped, it calls a server action wrapping `resolveKinshipTree` for that subtree and
  **merges** the returned nodes/edges into its set (dedup by `personId` / normalized edge key), then
  re-runs the pure layout. In-window carets reveal without fetching. This is what lets the same
  component serve a 10-person and a 10,000-person family.
- **`PersonNode`** — one monogram card, handling four visual states (see §8). Emits a tap event.
- **Caret affordances** — medium-weight chevron carets: per-node up/down (reveal hidden
  parents/children by mutating `expansion`) and per-generation collapse.
- **`PersonPanel`** — the read-only tap detail. Shows name (or "Unknown <relation>"), relation-to-you,
  life line ("b. 1948 · living" or "1920–1998 · in memory"), identified/anonymous. Three actions,
  all navigational: **Stories about them** (`/hub/about/[personId]`), **Center tree here**
  (`?root=<id>`), **Manage kin** (`/hub/kin`). No writes.

Component isolation check — each has one purpose and a clear interface: `resolveKinshipTree` (auth +
data), `computeTreeLayout` (geometry, pure), `TreeCanvas` (state + rendering), `PersonNode` (one
node), `PersonPanel` (tap detail). The page composes them.

## 8. Node states & styling

Follow the Kindred design system and reuse `/hub/kin` conventions (`KindredButton`, design tokens,
all copy centralized in `apps/web/app/_copy/hub.ts` under `hub.tree.*`).

- **You** — accent border + accent monogram; life line reads "you · b.YYYY".
- **Living relative** — plain card; "relation · b.YYYY".
- **Deceased** — muted tint; **"YYYY–YYYY · in memory"** when both years known, else "in memory · b.YYYY", else just "in memory".
- **Anonymous bridge** (`identified = false`) — dashed border, italic "Unknown", `?` monogram,
  relation-derived sublabel ("grandfather").
- **Monogram** — deterministic color from a hash of `personId` + the name's initial (`?` for anon).

## 9. Empty & error states

- **Not signed in** → redirect to `/` (matches the kinship surface).
- **No active family** → gentle prompt to join/start a family (mirrors `/hub/kin`).
- **No kin yet** (root is a lone node) → show just the You node with a CTA linking to `/hub/kin` to
  add the first relative.
- **Invalid `?root=`** (not in the projection) → fall back to the viewer's `self` root.

## 10. Testing plan

- **Layout (pure, TDD-first):** generation assignment; partner pairing & union placement; child
  centering; bounded windowing and expansion reveal; per-node caret presence logic; anonymous-bridge
  labeling; determinism; shared-grandparent DAG; multiple partners; root-only/disconnected.
- **Core `resolveKinshipTree` (PGlite):** family-membership gate; subject-hidden edge suppressed;
  anonymous viewer rejected; `root` defaulting and invalid-root fallback; hydration correctness
  (names, identified, life years, `relationToRoot` under re-centering); **windowing** — a person
  outside `window` is not materialized but its parent/child at the boundary sets `hasHiddenParents` /
  `hasHiddenChildren`; a follow-up windowed read merges cleanly (no dup nodes/edges). Include a
  **large-tree** fixture (deep multi-generation graph) asserting the first read stays bounded.
- **Capture regression:** add-relative with `lifeStatus = deceased` + death year persists and surfaces
  on the node (companion regression test for the schema/write change).
- **Component:** four node states render correctly; panel buttons link to the right routes; empty
  states.

## 11. Scope boundaries (explicit)

**In v1:** the route, `resolveKinshipTree`, the pure layout + SVG canvas, monogram nodes, tap panel,
bounded view with caret expand/collapse + pan/Fit, death fields + create-time capture + display.

**Deferred seams (out of v1):** real person photos (`persons.photoMediaId` + upload/crop/read-auth);
zoom; on-tree editing/governance; steward-affirmed badges; whole-graph / cross-family view; GEDCOM /
genealogy-API import (a separate ADR-0016 seam); an edit-a-relative flow (which would later also edit
death year).

**Explicitly NOT designed out: large families.** The bounded+incremental fetch (§5) and
fetch-on-expand client (§7) mean an imported 10,000-person tree works on the same code paths as a
small one — the first read stays bounded and subtrees load lazily as the user explores. Import itself
is deferred, but the tree renderer does not assume small graphs anywhere.

## 12. Dependencies & sequencing

This design targets the **merged Track-A kinship base** — the reconciled `#31 → #32 → (#33/#34 + #35)`
stack (currently the `worktree-issue-33-steward-hide` line + `#35` story-subjects), which provides
`resolveKinshipProjection`, `deriveKin`, `listMyKin`, the `/hub/kin` surface, and migrations
0008–0010. **Landing that stack to master (Track A) precedes or runs concurrently with building this
tree.** The one schema change here (death fields) adds the next migration on top of that base.

Note: this spec is authored on the `worktree-issue-31-kinship-edge-model` branch; when the Track-B
implementation branch is cut off the merged base, the spec travels with it.
