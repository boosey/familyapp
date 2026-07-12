# Kinship Tree Interaction Upgrades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/hub/tree` a first-class hub destination with reliable click-to-center, a story→author deep-link, and a per-box expand/collapse caret model, plus let a member attach kin to any selected person.

**Architecture:** Five workstreams on `worktree-kinship-integration`. A backend anchor param on `addRelative` unblocks the panel's Add buttons; a pure-layout caret rewrite replaces per-generation carets with per-box toggles; `TreeCanvas` gains client-side root state, reliable tap detection, and smooth re-centering; two small UI additions (hub tab, story link). #3 reuses the relation-relabel rule already added to `merge.ts`.

**Tech stack:** TypeScript (strict, ESM), Next.js 15 / React 19 (app router), Drizzle + PGlite for DB tests, Vitest. Run tests with `pnpm --filter @chronicle/<pkg> exec vitest run <file>`.

**Spec:** `docs/superpowers/specs/2026-07-12-kinship-tree-interactions-design.md`.

---

## File map

| File | Change |
|---|---|
| `packages/core/src/kinship-write.ts` | Add optional `anchorPersonId` to `AddRelativeInput`; anchor the switch on it (default = viewer). |
| `packages/core/test/kinship-write.test.ts` | Anchor-variant tests. |
| `apps/web/app/hub/kin/actions.ts` | Parse optional `anchorPersonId` from the form; pass through. |
| `apps/web/app/hub/kin/add-relative-form.tsx` | Accept optional `anchorPersonId` + preset relation (hidden field / preselect). |
| `apps/web/app/hub/kin/page.tsx` | Read `?anchor=` / `?relation=` and pass to the form. |
| `apps/web/app/hub/tree/tree-layout.ts` | Replace `Affordance`/`ExpansionState` model with per-box toggles + subtree-collapse cuts. |
| `apps/web/app/hub/tree/tree-layout.test.ts` | Rewrite caret tests to the new model. |
| `apps/web/app/hub/tree/relabel.ts` | NEW: pure `relabelToRoot(nodes, edges, rootPersonId)` helper. |
| `apps/web/app/hub/tree/relabel.test.ts` | NEW: relabel tests. |
| `apps/web/app/hub/tree/tree-canvas.tsx` | Client root state, tap-vs-drag detection, first-click-panel/second-click-recenter, smooth pan, new caret rendering, viewerPersonId prop. |
| `apps/web/app/hub/tree/person-node.tsx` | `relationToRootLabel` → "You" only for the viewer. |
| `apps/web/app/hub/tree/person-panel.tsx` | Drop "Center tree here"; add Add parent/child/sibling links. |
| `apps/web/app/hub/tree/page.tsx` | Pass `viewerPersonId` to `TreeCanvas`. |
| `apps/web/app/hub/tree/tree-canvas-expand.test.tsx`, `tree-person-panel.test.tsx` | Update to new interaction/panel. |
| `apps/web/app/hub/page.tsx` + `apps/web/app/hub/HubTabs.tsx`/`HubTabsNav.tsx` | Add a "Family tree" link tab. |
| `apps/web/app/_copy/hub.ts` | New copy strings (tree tab label, panel add-actions, story link). |
| `apps/web/app/hub/stories/[id]/page.tsx` + `StoryDetailClient.tsx` | "View in family tree" link by the byline. |

---

## Task 1: `addRelative` optional anchor (backend)

**Files:**
- Modify: `packages/core/src/kinship-write.ts` (`AddRelativeInput` ~line 25; `addRelative` body ~line 192-275)
- Test: `packages/core/test/kinship-write.test.ts`

- [ ] **Step 1: Write failing tests for the anchor**

Add to `packages/core/test/kinship-write.test.ts` (follow the existing PGlite harness in that file — reuse its `setup`/seed helpers for a family with two members `me` and `other`):

```ts
it("anchors a parent on the given anchorPersonId, not the viewer", async () => {
  const { db, ctx, familyId, otherPersonId } = await seedTwoMemberFamily();
  const res = await addRelative(db, ctx, {
    familyId,
    relation: "parent",
    displayName: "Grandpa",
    anchorPersonId: otherPersonId,
  });
  expect(res.allowed).toBe(true);
  const proj = await resolveKinshipProjection(db, ctx, familyId);
  // The new person must be a PARENT of `other`, not of the viewer.
  const edge = proj.edges.find(
    (e) => e.edgeType === "parent_of" && e.personBId === otherPersonId && e.personAId === res.createdPersonId,
  );
  expect(edge).toBeDefined();
});

it("defaults the anchor to the viewer when anchorPersonId is omitted", async () => {
  const { db, ctx, familyId, mePersonId } = await seedTwoMemberFamily();
  const res = await addRelative(db, ctx, { familyId, relation: "child", displayName: "Kid" });
  const proj = await resolveKinshipProjection(db, ctx, familyId);
  const edge = proj.edges.find(
    (e) => e.edgeType === "parent_of" && e.personAId === mePersonId && e.personBId === res.createdPersonId,
  );
  expect(edge).toBeDefined();
});

it("a sibling anchored on X shares X's parent", async () => {
  const { db, ctx, familyId, otherPersonId } = await seedTwoMemberFamily();
  await addRelative(db, ctx, { familyId, relation: "parent", displayName: "P", anchorPersonId: otherPersonId });
  const sib = await addRelative(db, ctx, { familyId, relation: "sibling", displayName: "S", anchorPersonId: otherPersonId });
  const proj = await resolveKinshipProjection(db, ctx, familyId);
  const parentsOfOther = proj.edges.filter((e) => e.edgeType === "parent_of" && e.personBId === otherPersonId).map((e) => e.personAId);
  const parentsOfSib = proj.edges.filter((e) => e.edgeType === "parent_of" && e.personBId === sib.createdPersonId).map((e) => e.personAId);
  expect(parentsOfSib.some((p) => parentsOfOther.includes(p))).toBe(true);
});
```

Add a `seedTwoMemberFamily()` helper in the test if one doesn't already exist, mirroring the file's existing setup (create a family, two `self` persons both with active memberships, return `{db, ctx (me), familyId, mePersonId, otherPersonId}`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chronicle/core exec vitest run test/kinship-write.test.ts -t "anchor"`
Expected: FAIL (`anchorPersonId` not in type / anchored on viewer).

- [ ] **Step 3: Add `anchorPersonId` to the input type**

In `kinship-write.ts`, add to `AddRelativeInput` (after `relation`):

```ts
  /**
   * ADR-0016 tree renderer (panel Add-relative): the person the relative attaches TO. Defaults to the
   * viewer. The viewer (actor) must be an active family member; the anchor must be a person already
   * visible in this family's projection. Assertions are first-asserter-wins, so anchoring on another
   * visible person grants no new authority — it only records a relationship that isn't about the actor.
   */
  anchorPersonId?: string;
```

- [ ] **Step 4: Anchor the switch on `anchorPersonId`**

In `addRelative`, after `const me = ctx.personId;` and the membership check, resolve the anchor and validate it is visible in the family:

```ts
  const anchor = input.anchorPersonId ?? me;
  if (anchor !== me) {
    // The anchor must be an endpoint of one of this family's visible edges (or the viewer). Reuse the
    // projection the read side already exposes so we never hydrate a stranger.
    const { edges } = await resolveKinshipProjection(db, ctx, input.familyId);
    const visible = new Set<string>();
    for (const e of edges) { visible.add(e.personAId); visible.add(e.personBId); }
    if (!visible.has(anchor)) {
      return { allowed: false, reason: "anchor person is not in this family" };
    }
  }
```

Then in the `switch (input.relation)` body, replace every anchoring use of `me` with `anchor` **but keep `me` as the `actorPersonId`** (the `insertParentOf`/`insertPartneredWith`/`currentParentIdsOf` calls take `actorPersonId` = `me` separately). Concretely: `parent` → `insertParentOf(tx, familyId, me, createdPersonId, anchor, nature)`; `child` → `insertParentOf(tx, familyId, me, anchor, createdPersonId, nature)`; `partner` → `insertPartneredWith(tx, familyId, me, anchor, createdPersonId)`; `grandparent`/`sibling` → `currentParentIdsOf(tx, familyId, anchor)` and the bridge edges use `anchor` in place of the old `me` child/target. (Import `resolveKinshipProjection` at the top — it lives in `kinship-repository.ts`, same package.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @chronicle/core exec vitest run test/kinship-write.test.ts`
Expected: PASS (all, including the existing viewer-anchored cases).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/kinship-write.ts packages/core/test/kinship-write.test.ts
git commit -m "feat(kinship): addRelative accepts an optional anchorPersonId (default viewer)"
```

---

## Task 2: Per-box caret redesign (pure layout)

**Files:**
- Modify: `apps/web/app/hub/tree/tree-layout.ts` (`ExpansionState` ~16-29, `EMPTY_EXPANSION` ~25, `Affordance` ~54-66, affordance section ~501-575, collapse-generation removal)
- Test: `apps/web/app/hub/tree/tree-layout.test.ts`

- [ ] **Step 1: Rewrite the layout test file to the new model**

Replace the caret/affordance and collapse tests in `tree-layout.test.ts` with the new contract (keep the file's node/edge builder helpers). Core cases:

```ts
// Family: gp -> parent -> root; root partnered with spouse; root+spouse -> child.
// (parent has a partner "gpB" so gp is a couple; root+spouse a couple; child is a lone leaf.)

it("emits an ancestor caret on the TOP of a node that has parents, expanded when parents are drawn", () => {
  const layout = computeTreeLayout(fixtureThreeGen());
  const root = placedOf(layout, "root");
  const anc = layout.affordances.find((a) => a.kind === "ancestors" && a.targetId === "root");
  expect(anc).toBeTruthy();
  expect(anc!.expanded).toBe(true);            // parent is drawn ⇒ collapsible
  expect(anc!.y).toBeCloseTo(root.y - NODE_H / 2); // top edge
});

it("collapsing a node's ancestors removes the ancestor subtree and flips the caret to collapsed", () => {
  const layout = computeTreeLayout({ ...fixtureThreeGen(), expansion: collapseAncestors("root") });
  expect(layout.placed.find((p) => p.personId === "parent")).toBeUndefined();
  expect(layout.placed.find((p) => p.personId === "gp")).toBeUndefined();
  const anc = layout.affordances.find((a) => a.kind === "ancestors" && a.targetId === "root");
  expect(anc!.expanded).toBe(false);           // collapsed ⇒ expandable
});

it("emits exactly ONE descendant caret for a couple, on the union edge", () => {
  const layout = computeTreeLayout(fixtureCoupleWithChild()); // root + spouse -> child
  const desc = layout.affordances.filter((a) => a.kind === "descendants");
  expect(desc).toHaveLength(1);
  const union = layout.unions.find((u) => sameCouple(u, "root", "spouse"))!;
  expect(desc[0]!.x).toBeCloseTo(union.x);       // centered on the union
  expect(desc[0]!.y).toBeGreaterThan(union.y);   // below the couple row
});

it("emits the descendant caret on the node when there is no drawn partner", () => {
  const layout = computeTreeLayout(fixtureLoneParentWithChild());
  const desc = layout.affordances.filter((a) => a.kind === "descendants");
  expect(desc).toHaveLength(1);
  expect(desc[0]!.targetId).toBe("root");
});

it("a boundary node (hasHiddenChildren) emits a collapsed descendant caret needing a fetch", () => {
  const layout = computeTreeLayout(fixtureBoundaryChildren()); // leaf node with hasHiddenChildren
  const desc = layout.affordances.find((a) => a.kind === "descendants" && a.fetchPersonId === "leaf")!;
  expect(desc.expanded).toBe(false);
  expect(desc.requiresFetch).toBe(true);
});

it("emits NO collapse-generation affordances", () => {
  const layout = computeTreeLayout(fixtureThreeGen());
  expect(layout.affordances.some((a) => (a as { kind: string }).kind === "collapse-generation")).toBe(false);
});
```

Add small fixture builders (`fixtureThreeGen`, `fixtureCoupleWithChild`, `fixtureLoneParentWithChild`, `fixtureBoundaryChildren`, `collapseAncestors`, `placedOf`, `sameCouple`) at the top of the test using the existing node/edge helpers.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/tree-layout.test.ts`
Expected: FAIL (old `expand-parents`/`collapse-generation` model).

- [ ] **Step 3: Replace the types**

In `tree-layout.ts`:

```ts
export interface ExpansionState {
  /** Boundary parents/children revealed via fetch (persist so re-renders keep them shown). */
  expandedParents: ReadonlySet<string>;
  expandedChildren: ReadonlySet<string>;
  /** Nodes whose ANCESTOR subtree the user collapsed (keyed by the node's personId). */
  collapsedAncestors: ReadonlySet<string>;
  /** Couples/lone-parents whose DESCENDANT subtree the user collapsed (keyed by coupleKey). */
  collapsedDescendants: ReadonlySet<string>;
}

export const EMPTY_EXPANSION: ExpansionState = {
  expandedParents: new Set(),
  expandedChildren: new Set(),
  collapsedAncestors: new Set(),
  collapsedDescendants: new Set(),
};

/** Canonical key for a descendant-toggle target: a normalized couple pair, or a lone person id. */
export function coupleKey(a: string, b?: string): string {
  if (!b) return a;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface Affordance {
  kind: "ancestors" | "descendants";
  /** For ancestors: the person's id. For descendants: the coupleKey. Added/removed from the collapsed set. */
  targetId: string;
  /** The person to fetch from when EXPANDING a boundary (kin not loaded). */
  fetchPersonId: string;
  x: number;
  y: number;
  /** True ⇒ the subtree is currently drawn (chevron points toward collapse). */
  expanded: boolean;
  /** True ⇒ expanding requires a server fetch (boundary node). */
  requiresFetch: boolean;
}
```

- [ ] **Step 4: Apply collapse cuts in `drawable`, then rewrite the affordance section**

In `computeTreeLayout`, after the base `drawable` set is computed (the ±2 window + `expandedParents`/`expandedChildren` fixpoint) and BEFORE grouping by generation, prune subtrees cut by collapses. Remove the `collapsedGenerations` block entirely and replace with a reachability re-walk from root that refuses to cross a cut:

```ts
  // Apply per-node subtree collapses. Re-walk from root over the DRAWN adjacency, but do not step
  // upward past a node whose ancestors are collapsed, nor downward past a couple whose descendants are
  // collapsed. Anything no longer reachable is removed (a node reachable another way survives).
  {
    const cutUp = expansion.collapsedAncestors;
    const cutDown = expansion.collapsedDescendants;
    const keep = new Set<string>();
    const stack: string[] = nodeById.has(rootPersonId) ? [rootPersonId] : [];
    while (stack.length) {
      const cur = stack.pop()!;
      if (keep.has(cur) || !drawable.has(cur)) continue;
      keep.add(cur);
      // Up (parents) unless this node's ancestors are collapsed.
      if (!cutUp.has(cur)) for (const p of parentsOf.get(cur) ?? []) if (drawable.has(p)) stack.push(p);
      // Partners are same-gen, always kept adjacent.
      for (const s of partnersOf.get(cur) ?? []) if (drawable.has(s)) stack.push(s);
      // Down (children) unless this node's (or its partner's) couple descendants are collapsed.
      const partners = partnersOf.get(cur) ?? [];
      const myCoupleKeys = [coupleKey(cur), ...partners.map((s) => coupleKey(cur, s))];
      const downCollapsed = myCoupleKeys.some((k) => cutDown.has(k));
      if (!downCollapsed) for (const c of childrenOf.get(cur) ?? []) if (drawable.has(c)) stack.push(c);
    }
    for (const id of [...drawable]) if (!keep.has(id)) drawable.delete(id);
  }
```

Then replace the whole affordance section (the `expand-parents`/`expand-children` per-node loop AND the `collapse-generation` loop) with:

```ts
  const affordances: Affordance[] = [];
  const posOfPlaced = new Map(placed.map((p) => [p.personId, p]));
  const handledDescendant = new Set<string>();

  for (const p of placed) {
    const id = p.personId;
    // --- Ancestor caret (top) ---
    const hasParents = (parentsOf.get(id) ?? []).length > 0 || p.node.hasHiddenParents;
    if (hasParents) {
      const anyParentDrawn = (parentsOf.get(id) ?? []).some((pp) => drawable.has(pp));
      const requiresFetch = !anyParentDrawn && p.node.hasHiddenParents;
      affordances.push({
        kind: "ancestors",
        targetId: id,
        fetchPersonId: id,
        x: p.x,
        y: p.y - NODE_H / 2,
        expanded: anyParentDrawn,
        requiresFetch,
      });
    }
    // --- Descendant caret (bottom, one per couple) ---
    if (handledDescendant.has(id)) continue;
    const drawnPartner = (partnersOf.get(id) ?? []).find((s) => posOfPlaced.has(s));
    const groupIds = drawnPartner ? [id, drawnPartner] : [id];
    const hasChildren = groupIds.some(
      (g) => (childrenOf.get(g) ?? []).length > 0 || (nodeById.get(g)?.hasHiddenChildren ?? false),
    );
    if (hasChildren) {
      groupIds.forEach((g) => handledDescendant.add(g));
      const anyChildDrawn = groupIds.some((g) => (childrenOf.get(g) ?? []).some((c) => drawable.has(c)));
      const boundaryG = groupIds.find((g) => nodeById.get(g)?.hasHiddenChildren) ?? id;
      const cx = drawnPartner
        ? (posOfPlaced.get(id)!.x + posOfPlaced.get(drawnPartner)!.x) / 2
        : p.x;
      affordances.push({
        kind: "descendants",
        targetId: drawnPartner ? coupleKey(id, drawnPartner) : coupleKey(id),
        fetchPersonId: boundaryG,
        x: cx,
        y: p.y + NODE_H / 2,
        expanded: anyChildDrawn,
        requiresFetch: !anyChildDrawn && groupIds.some((g) => nodeById.get(g)?.hasHiddenChildren),
      });
    }
  }
  affordances.sort((a, b) =>
    a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0,
  );
```

Also remove `collapsedButPopulated` bookkeeping and any `yForGen`-for-collapsed-row logic that only served generation collapse. Keep the bounds pass (it already encloses affordance glyphs).

- [ ] **Step 5: Run layout tests to green**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/tree-layout.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/hub/tree/tree-layout.ts apps/web/app/hub/tree/tree-layout.test.ts
git commit -m "feat(tree): per-box expand/collapse carets (top ancestors, bottom couple-edge descendants)"
```

---

## Task 3: `relabelToRoot` helper

**Files:**
- Create: `apps/web/app/hub/tree/relabel.ts`
- Test: `apps/web/app/hub/tree/relabel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, it } from "vitest";
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";
import { relabelToRoot } from "@/app/hub/tree/relabel";

const node = (id: string, rel: TreeNode["relationToRoot"] = null): TreeNode => ({
  personId: id, displayName: id, identified: true, lifeStatus: "living",
  birthYear: null, deathYear: null, relationToRoot: rel, hasHiddenParents: false, hasHiddenChildren: false,
});
const parentOf = (a: string, b: string): ResolvedKinshipEdge => ({
  edgeType: "parent_of", personAId: a, personBId: b, nature: "biological",
  state: "asserted", assertedBy: a, assertedAt: new Date(0), updatedAt: new Date(0),
});

it("relabels every node's relationToRoot relative to the given root; root is 'self'", () => {
  const nodes = [node("gp", "grandparent"), node("parent", "parent"), node("root", "self"), node("kid", "child")];
  const edges = [parentOf("gp", "parent"), parentOf("parent", "root"), parentOf("root", "kid")];
  const out = relabelToRoot(nodes, edges, "parent"); // re-root on the parent
  const rel = Object.fromEntries(out.map((n) => [n.personId, n.relationToRoot]));
  expect(rel.parent).toBe("self");
  expect(rel.gp).toBe("parent");     // gp is now the root's parent
  expect(rel.root).toBe("child");    // old root is now a child
  expect(rel.kid).toBe(null);        // grandchild is beyond deriveKin's coverage from "parent"
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/relabel.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { deriveKin, type KinRelation, type ResolvedKinshipEdge, type TreeNode } from "@chronicle/core";

/**
 * Return `nodes` with each `relationToRoot` recomputed relative to `rootPersonId` from `edges`. The
 * root is "self"; anyone `deriveKin` can label gets that relation; everyone else gets `null` (rather
 * than a stale or wrong-root relation). Pure — used on re-root and could back the initial render too.
 */
export function relabelToRoot(
  nodes: readonly TreeNode[],
  edges: readonly ResolvedKinshipEdge[],
  rootPersonId: string,
): TreeNode[] {
  const rel = new Map<string, KinRelation>(deriveKin([...edges], rootPersonId).map((k) => [k.personId, k.relation]));
  return nodes.map((n) => ({
    ...n,
    relationToRoot: n.personId === rootPersonId ? "self" : (rel.get(n.personId) ?? null),
  }));
}
```

- [ ] **Step 4: Run to green**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/relabel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/tree/relabel.ts apps/web/app/hub/tree/relabel.test.ts
git commit -m "feat(tree): relabelToRoot helper for client-side re-rooting"
```

---

## Task 4: "You" = viewer, not root

**Files:**
- Modify: `apps/web/app/hub/tree/person-node.tsx` (`relationToRootLabel` ~27-32; `PersonNode` props/usage)
- Modify: `apps/web/app/hub/tree/page.tsx` (pass `viewerPersonId`)
- Test: `apps/web/app/hub/tree/tree-person-node.test.tsx`

- [ ] **Step 1: Write failing tests**

```ts
it("labels the viewer's own node 'You' even when it is not the root", () => {
  const n = makeNode({ personId: "viewer", relationToRoot: "parent" });
  expect(relationToRootLabel(n, /*isRoot*/ false, /*viewerPersonId*/ "viewer")).toBe(hub.tree.you);
});
it("labels a re-rooted non-viewer by relation, not 'You'", () => {
  const n = makeNode({ personId: "marco", relationToRoot: "self" }); // root but not viewer
  expect(relationToRootLabel(n, true, "viewer")).toBe(""); // focal root, not viewer ⇒ no relation line
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/tree-person-node.test.tsx`
Expected: FAIL (signature mismatch / old "You" logic).

- [ ] **Step 3: Update `relationToRootLabel` and `PersonNode`**

```ts
export function relationToRootLabel(node: TreeNode, isRoot: boolean, viewerPersonId: string | null): string {
  if (viewerPersonId != null && node.personId === viewerPersonId) return hub.tree.you;
  if (isRoot || node.relationToRoot === "self") return ""; // focal root that isn't the viewer: no relation line
  if (node.relationToRoot === null) return "";
  return RELATION_LABEL[node.relationToRoot];
}
```

Add `viewerPersonId?: string | null` to `PersonNodeProps` and thread it into the `relationToRootLabel` call in `PersonNode`. Update `person-panel.tsx`'s `relationToRootLabel` call site (Task 6) accordingly.

- [ ] **Step 4: Pass `viewerPersonId` from the page**

In `tree/page.tsx`, the viewer is `ctx.personId` (guarded to `account` above). Pass it into `<TreeCanvas viewerPersonId={ctx.personId} … />` (prop added in Task 5).

- [ ] **Step 5: Run to green**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/tree-person-node.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/hub/tree/person-node.tsx apps/web/app/hub/tree/page.tsx apps/web/app/hub/tree/tree-person-node.test.tsx
git commit -m "feat(tree): 'You' labels the viewer's own node, not the current root"
```

---

## Task 5: TreeCanvas — tap detection, select→center, smooth re-root, new carets

**Files:**
- Modify: `apps/web/app/hub/tree/tree-canvas.tsx`
- Test: `apps/web/app/hub/tree/tree-canvas-expand.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Extend `tree-canvas-expand.test.tsx` (it already renders `TreeCanvas` with an injected `fetchSubtree`). Use `@testing-library/react` + `user-event`:

```ts
it("first click selects (opens panel); second click on the same node re-roots", async () => {
  const fetchSubtree = vi.fn(async (_f, id) => ({ ok: true, data: subtreeFor(id) }));
  render(<TreeCanvas familyId="F" rootPersonId="root" viewerPersonId="root" initial={initialData} fetchSubtree={fetchSubtree} />);
  const marco = screen.getByTestId("tree-node-marco");
  await userEvent.click(marco);
  expect(screen.getByTestId("tree-person-panel")).toBeInTheDocument(); // selected ⇒ panel
  expect(fetchSubtree).not.toHaveBeenCalled();
  await userEvent.click(screen.getByTestId("tree-node-marco"));
  expect(fetchSubtree).toHaveBeenCalledWith("F", "marco"); // second click re-roots
});

it("a drag on a node does not select it", async () => {
  render(<TreeCanvas … viewerPersonId="root" />);
  const node = screen.getByTestId("tree-node-marco");
  fireEvent.pointerDown(node, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(node, { clientX: 40, clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(node, { clientX: 40, clientY: 0, pointerId: 1 });
  expect(screen.queryByTestId("tree-person-panel")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/tree-canvas-expand.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the interaction changes**

In `tree-canvas.tsx`:

1. **Props:** add `viewerPersonId: string`. Make root state:
```ts
const [rootPersonId, setRootPersonId] = useState(initialRootPersonId);
```
(rename the prop to `initialRootPersonId` / `initialRoot`; keep `initial` for data).

2. **Reliable tap:** track press start on the node's pointerdown and compute travel at pointerup; treat as a tap when travel ≤ 6px. Replace `onNodeTap`/`draggingRef` gating with:
```ts
const tapRef = useRef<{ id: string; x: number; y: number } | null>(null);
const onNodePointerDown = (id: string, e: React.PointerEvent) => { tapRef.current = { id, x: e.clientX, y: e.clientY }; };
const onNodePointerUp = (id: string, e: React.PointerEvent) => {
  const t = tapRef.current; tapRef.current = null;
  if (!t || t.id !== id) return;
  if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 6) return; // it was a drag
  if (selected === id) void recenterOn(id);   // second tap ⇒ re-root
  else setSelected(id);                        // first tap ⇒ select + panel
};
```
Wire these to each `PersonNode` wrapper (stopPropagation so the viewport pan handler doesn't also treat it as a pan-start), and pass `viewerPersonId` to `PersonNode`.

3. **Smooth re-root:**
```ts
const [animating, setAnimating] = useState(false);
const recenterOn = useCallback(async (id: string) => {
  setPending(true); setLoadError(null);
  try {
    const res = await fetchSubtree(familyId, id);
    if (!res.ok) { setLoadError(hub.tree.loadFailed); return; }
    const mergedNodes = relabelToRoot(mergeNodes(nodes, res.data.nodes), mergeEdges(edges, res.data.edges), id);
    const mergedEdges = mergeEdges(edges, res.data.edges);
    setEdges(mergedEdges);
    setNodes(mergedNodes);
    setExpansion(EMPTY_EXPANSION);
    setRootPersonId(id);
    setSelected(id);
    // URL sync (shallow) so refresh/back + deep-links stay consistent.
    const url = new URL(window.location.href);
    url.searchParams.set("root", id);
    window.history.replaceState(null, "", url.toString());
    // fitToRoot runs via the rootPersonId effect; enable the pan transition briefly.
    setAnimating(true); setTimeout(() => setAnimating(false), 300);
  } catch { setLoadError(hub.tree.loadFailed); }
  finally { setPending(false); }
}, [familyId, fetchSubtree, nodes, edges]);
```
Add a CSS transition on the pan layer transform while `animating` (`transition: animating ? "transform 280ms var(--ease-quiet)" : "none"`).

4. **New carets:** render `layout.affordances` (now `kind: "ancestors" | "descendants"`) as chevron buttons at `(a.x, a.y)`. Chevron direction: `ancestors` → `expanded ? "down" : "up"`; `descendants` → `expanded ? "up" : "down"`. On click:
```ts
const onCaret = (a: Affordance) => {
  if (a.kind === "ancestors") {
    if (a.expanded) setExpansion((e) => ({ ...e, collapsedAncestors: toggle(e.collapsedAncestors, a.targetId) }));
    else if (a.requiresFetch) void revealFetch("parents", a.fetchPersonId);
    else setExpansion((e) => ({ ...e, collapsedAncestors: toggle(e.collapsedAncestors, a.targetId), expandedParents: add(e.expandedParents, a.fetchPersonId) }));
  } else {
    if (a.expanded) setExpansion((e) => ({ ...e, collapsedDescendants: toggle(e.collapsedDescendants, a.targetId) }));
    else if (a.requiresFetch) void revealFetch("children", a.fetchPersonId);
    else setExpansion((e) => ({ ...e, collapsedDescendants: toggle(e.collapsedDescendants, a.targetId), expandedChildren: add(e.expandedChildren, a.fetchPersonId) }));
  }
};
```
`revealFetch` mirrors the existing boundary fetch (merge + relabel against the CURRENT root + set expandedParents/Children), factored out. `add`/`toggle` are set helpers. Give each caret an aria-label from copy: expand vs hide × parents vs children.

5. **fitToRoot / effect:** the existing `useEffect([rootPersonId])` already re-fits on root change — keep it; it now fires on client re-root too.

- [ ] **Step 4: Run interaction tests to green**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/tree-canvas-expand.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/tree/tree-canvas.tsx apps/web/app/hub/tree/tree-canvas-expand.test.tsx
git commit -m "feat(tree): reliable tap, first-click panel / second-click smooth re-root, new caret rendering"
```

---

## Task 6: Panel — drop "Center", add parent/child/sibling

**Files:**
- Modify: `apps/web/app/hub/tree/person-panel.tsx`
- Modify: `apps/web/app/_copy/hub.ts` (tree copy: add `panelAddParent/Child/Sibling`)
- Test: `apps/web/app/hub/tree/tree-person-panel.test.tsx`

- [ ] **Step 1: Add copy strings**

In `hub.ts` `tree` block, add:
```ts
    panelAddParent: "Add parent",
    panelAddChild: "Add child",
    panelAddSibling: "Add sibling",
```

- [ ] **Step 2: Write failing panel tests**

```ts
it("shows Add parent/child/sibling and no 'Center tree here'", () => {
  render(<PersonPanel node={makeNode({ personId: "x" })} isRoot={false} familyId="F" viewerPersonId="v" onClose={() => {}} />);
  expect(screen.queryByText(hub.tree.panelCenterHere)).not.toBeInTheDocument();
  expect(screen.getByText(hub.tree.panelAddParent).closest("a")!.getAttribute("href")).toBe("/hub/kin?scope=F&anchor=x&relation=parent");
  expect(screen.getByText(hub.tree.panelAddChild)).toBeInTheDocument();
  expect(screen.getByText(hub.tree.panelAddSibling)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/tree-person-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

Remove the `centerHref`/"Center tree here" `<Link>`. Add three add-links after "Stories about them":
```tsx
const addHref = (relation: string) => `/hub/kin?scope=${familyId}&anchor=${node.personId}&relation=${relation}`;
// …
<Link href={addHref("parent")} data-testid="tree-panel-addparent" style={{ textDecoration: "none" }}>
  <KindredButton variant="secondary" size="small" fullWidth type="button">{hub.tree.panelAddParent}</KindredButton>
</Link>
// child, sibling similarly …
```
Keep "Manage kin". Thread `viewerPersonId` through if the panel uses `relationToRootLabel` (Task 4 signature change).

- [ ] **Step 5: Run to green**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/tree/tree-person-panel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/hub/tree/person-panel.tsx apps/web/app/_copy/hub.ts apps/web/app/hub/tree/tree-person-panel.test.tsx
git commit -m "feat(tree): panel drops Center, adds Add parent/child/sibling targeting the selected person"
```

---

## Task 7: `/hub/kin` add form honors `?anchor=` / `?relation=`

**Files:**
- Modify: `apps/web/app/hub/kin/actions.ts` (`addRelativeAction`)
- Modify: `apps/web/app/hub/kin/add-relative-form.tsx`
- Modify: `apps/web/app/hub/kin/page.tsx`
- Test: `apps/web/app/hub/kin/kin-add.test.tsx` (or the existing kin form test)

- [ ] **Step 1: Failing test — the action forwards anchorPersonId**

Unit-test `addRelativeAction` with a mocked runtime/core (mirror the existing kin action test pattern in the repo). Assert that a form containing `anchorPersonId` results in `addRelative` being called with that `anchorPersonId`, and that omitting it calls with `anchorPersonId: undefined`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/kin`
Expected: FAIL.

- [ ] **Step 3: Parse the anchor in the action**

In `addRelativeAction`, after computing `familyId`, read + validate the anchor (any non-empty string; core re-validates it is in the family):
```ts
const rawAnchor = formData.get("anchorPersonId");
const anchorPersonId = typeof rawAnchor === "string" && rawAnchor.trim() ? rawAnchor.trim() : undefined;
```
Add `...(anchorPersonId ? { anchorPersonId } : {})` to the `input` object.

- [ ] **Step 4: Form accepts anchor + preset relation**

`add-relative-form.tsx`: add optional props `anchorPersonId?: string` and `initialRelation?: AddRelativeRelation`. Render a hidden `<input type="hidden" name="anchorPersonId" value={anchorPersonId} />` when present, and default the relation `<select>` to `initialRelation`. In `kin/page.tsx`, read `searchParams.anchor` / `searchParams.relation`, validate `relation` against the five allowed values, and pass them to the form.

- [ ] **Step 5: Run to green + a PGlite end-to-end check**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/kin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/hub/kin/actions.ts apps/web/app/hub/kin/add-relative-form.tsx apps/web/app/hub/kin/page.tsx apps/web/app/hub/kin/*.test.tsx
git commit -m "feat(kin): add-relative form + action honor ?anchor= and ?relation= (targeted add)"
```

---

## Task 8: "Family tree" hub tab

**Files:**
- Modify: `apps/web/app/hub/page.tsx` (tab list + active resolution)
- Modify: `apps/web/app/hub/HubTabsNav.tsx` (a link tab navigates to `/hub/tree`, not `/hub?tab=`)
- Modify: `apps/web/app/_copy/hub.ts` (tab label if not reusing `hub.tree.heading`)
- Test: `apps/web/app/hub/hub-tabs.test.tsx` (or nearest hub tab test)

- [ ] **Step 1: Failing test**

Assert the hub renders a tab labeled "Family tree" whose activation navigates to `/hub/tree?scope=<scope>`. Because `HubTabs.onChange` currently pushes `/hub?tab=…`, the Tree tab needs a distinct route. Simplest: in `HubTabsNav.onChange`, special-case the tree key:
```ts
onChange={(key) => router.push(key === "tree" ? `/hub/tree?scope=${encodeURIComponent(scope)}` : `/hub?tab=${key}&scope=${encodeURIComponent(scope)}`)}
```
Test that clicking the "Family tree" tab calls `router.push` with `/hub/tree?scope=<scope>` (mock `next/navigation`'s `useRouter`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/hub-tabs.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- In `hub/page.tsx`, append `{ key: "tree", label: hub.tree.openTree }` to the `tabs` array passed to `HubTabsNav` (reuse `hub.tree.openTree = "View family tree"`, or add `hub.shell.treeTab = "Family tree"`).
- In `HubTabsNav.tsx`, apply the `onChange` special-case above.
- The tree tab is never the `active` value on `/hub` (it lives on its own route), so no active-state wiring is needed on `/hub`; active styling shows only while on `/hub/tree` (that page renders its own header, not the hub tab bar) — acceptable for v1.

- [ ] **Step 4: Run to green**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/hub-tabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/page.tsx apps/web/app/hub/HubTabsNav.tsx apps/web/app/_copy/hub.ts apps/web/app/hub/hub-tabs.test.tsx
git commit -m "feat(hub): Family tree tab routes to /hub/tree with scope preserved"
```

---

## Task 9: Story detail → "View in family tree"

**Files:**
- Modify: `apps/web/app/hub/stories/[id]/page.tsx` (compute `authorTreeHref`, pass to client)
- Modify: `apps/web/app/hub/stories/[id]/StoryDetailClient.tsx` (render the link near the byline)
- Modify: `apps/web/app/_copy/hub.ts` (`tree.openInTree = "View in family tree"`)
- Test: `apps/web/app/hub/stories/story-detail-tree-link.test.tsx`

- [ ] **Step 1: Failing test**

Render `StoryDetailClient` with an `authorTreeHref` prop and assert a link "View in family tree" with that href appears near the narrator name.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/stories/story-detail-tree-link.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `stories/[id]/page.tsx`, compute the scope (prefer a family the author is in — the first story target family, else the current `scope`):
```ts
const treeScope = targets[0]?.id ?? backScope ?? viewerFamilies[0]?.id;
const authorTreeHref = treeScope
  ? `/hub/tree?scope=${treeScope}&root=${story.ownerPersonId}`
  : null;
```
Pass `authorTreeHref={authorTreeHref}` into `<StoryDetailClient …>`. In `StoryDetailClient.tsx`, where `narratorName` renders, add (when `authorTreeHref` is set) a small `<Link href={authorTreeHref}>{hub.tree.openInTree}</Link>` next to the byline.

- [ ] **Step 4: Run to green**

Run: `pnpm --filter @chronicle/web exec vitest run app/hub/stories/story-detail-tree-link.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/stories/[id]/page.tsx apps/web/app/hub/stories/[id]/StoryDetailClient.tsx apps/web/app/_copy/hub.ts apps/web/app/hub/stories/story-detail-tree-link.test.tsx
git commit -m "feat(stories): 'View in family tree' link opens the tree rooted on the author"
```

---

## Task 10: Full-suite green + browser re-verify

- [ ] **Step 1: Run the affected packages**

```bash
pnpm --filter @chronicle/core exec vitest run
pnpm --filter @chronicle/web exec vitest run
```
Expected: all PASS. Fix any fallout in the older tree tests (`tree-page.test.tsx`, `tree-merge.test.ts`) from the type/prop changes.

- [ ] **Step 2: Typecheck + build**

```bash
pnpm -r typecheck && pnpm --filter @chronicle/web build
```
Expected: clean.

- [ ] **Step 3: Browser re-verify against the dev-seed fixture**

`pnpm --filter @chronicle/web dev`; `POST /api/dev/seed`; sign in as Sofia. Confirm: Family tree tab opens the tree; a story's "View in family tree" opens rooted on the author; first tap opens the panel (Stories / Manage kin / Add parent/child/sibling, no Center); second tap on the selected node smoothly re-centers; the viewer node reads "You" and a re-rooted relative does not; one descendant caret sits between Sofia & Diego (not one each), top carets collapse/expand ancestors, bottom carets collapse/expand descendants with correct chevron direction; Add parent from Odette's panel lands on the add form anchored to Odette. Capture screenshots.

- [ ] **Step 4: Final commit if any fixups**

```bash
git add -A && git commit -m "test(tree): reconcile older suites with the new interaction model"
```
