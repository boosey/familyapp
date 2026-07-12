# Kinship visual tree — interaction upgrades (hub tab, story deep-link, click-to-center, caret redesign)

**Date:** 2026-07-12
**Branch:** `worktree-kinship-integration`
**Supersedes parts of:** `docs/superpowers/specs/2026-07-12-kinship-tree-viz-design.md` §7 (tap → panel) and §8 (per-generation collapse carets). Those sections are amended by this document; the rest of the viz spec still holds.
**Depends on (already landed on this branch, uncommitted):** the fetch-on-expand relation-relabel fix in `merge.ts` and the multi-generation dev-seed fixture from the 2026-07-12 browser-verify session.

## Motivation

Browser verification of `/hub/tree` surfaced four gaps between the built tree and the intended interaction model:

1. The tree is reachable only via a link buried in `/hub/kin`; it should be a first-class hub destination.
2. There is no path from a story to "show me this person in the tree."
3. Tapping a node is unreliable (pointer-capture + a 3 px drag threshold swallow the tap on trackpads), and even when it works the intended model is select-then-center, not a static panel.
4. The expand/collapse carets don't match the intended per-box toggle model: the down-caret is a "reveal hidden children" control that disappears after use rather than a collapse toggle, it is emitted on *both* partners of a couple, and there is no per-box collapse of a subtree (collapse lives only on a separate per-generation left-margin control).

## Scope

Four independent-ish workstreams on `worktree-kinship-integration`. #3 and #4 share a small relation-relabel helper (already added for the merge fix) and both touch `TreeCanvas` + `tree-layout.ts`.

Out of scope: photos on nodes, gendered relation labels, cousin/great-grandparent derivation beyond what `deriveKin` already covers, the human-gated Stage-3 release.

---

## 1. Tree as a hub tab

**Behavior.** Add a **"Family tree"** tab to the hub's top tab bar (the same bar that holds Stories / Album / To answer / Ask a question / Your asks / Invite / Requests). Selecting it navigates to `/hub/tree`, carrying the current `?scope=` so the tree opens on the family the hub is scoped to. The tab shows an active/selected state when the current route is `/hub/tree`.

**Notes.**
- This is a link tab (a real route), not an in-page panel like the feed tabs — `/hub/tree` is already its own page with its own `?scope`/`?root` handling.
- The existing "View family tree" link on `/hub/kin` stays (harmless secondary path).

**Testing.** Component/route test: the hub renders a "Family tree" tab whose href is `/hub/tree?scope=<currentScope>`; it is marked active on that route.

---

## 2. Story → tree with the author centered

**Behavior.** On the **story detail page only**, add an affordance near the author/byline — label e.g. **"View in family tree"** — linking to:

```
/hub/tree?scope=<family>&root=<story.ownerPersonId>
```

`root` is the story's narrator/owner (`ownerPersonId`). `scope` is the family the story is being viewed under (the current scope context). The tree page already validates `root` against that family's visible edges and falls back to the viewer's self-root if the author isn't reachable there (the `35a6ada` cross-family guard), so a bad pairing degrades safely rather than leaking.

**Testing.** Story-detail render test: the link is present and points at `/hub/tree?scope=…&root=<ownerPersonId>`.

---

## 3. Click behavior: select → center, and the action panel

### 3a. Reliable tap detection

The current tap is lost when the viewport captures the pointer and any ~3 px of travel flips `draggingRef` true (`tree-canvas.tsx` `onNodeTap`). Replace with robust tap-vs-drag discrimination:

- A **tap** is a press and release on the *same node* whose total pointer travel is below a small threshold (e.g. ≤ 6 px). A tap always selects.
- A **pan** is pointer travel at/above the threshold; it moves the viewport and does **not** select.
- Pointer capture on the viewport must not prevent a node tap from registering.

**Regression test:** a simulated press→small-move(<threshold)→release on a node selects it; a press→large-move→release (a drag) does not.

### 3b. First click selects; second click centers

- **First click** on a person → mark it **selected** (visible highlight on the node) and open its **panel** (§3d).
- **Second click** on the **already-selected** person → **re-root** the tree on them with a smooth transition (§3c).
- Clicking a *different* person just moves the selection there (first-click semantics again). Clicking empty canvas / a pan clears nothing (selection persists until another node is selected or the panel is closed).

### 3c. Smooth client-side re-root

Re-rooting today is a full page navigation (`?root=` → server re-render → `TreeCanvas` remounts). Replace the *in-tree* re-root with a client transition:

- `rootPersonId` becomes **canvas state** (initialized from the server prop).
- On re-root to person `P`:
  1. Fetch `P`'s bounded neighborhood via the existing `fetchSubtreeAction(familyId, P)` (or reuse loaded data if `P`'s full ±2 window is already present).
  2. Replace/merge nodes + edges, then **relabel `relationToRoot` against the new root** using the shared relabel helper (same rule as the merge fix: relations are always relative to the *current* root; nodes with no expressible relation get `null`).
  3. Reset expansion state to the default window for the new root.
  4. **Animate the pan** so `P` slides to viewport center (CSS transition on the pan transform).
  5. Sync the URL `?root=P` via a shallow router replace so refresh/back and external deep-links (item #2) stay consistent.
- On failure, show the existing `loadFailed` message and keep the prior root.

### 3d. The panel and the "You" label

- **"You" is the viewer, not the root.** Today `relationToRootLabel` returns "You" for any root (`isRoot || rel === "self"`), so re-rooting on a relative mislabels them "You". Fix: pass the **viewer's own `personId`** into the canvas; a node reads **"You"** iff `node.personId === viewerPersonId`. The focal root, when it is *not* the viewer, shows its name + life line with **no relation line** (it is the center, not a relative). The viewer's own node shows "You" wherever it sits in the tree.
- **Panel actions** (read-only nav + quick-adds; **no "Center tree here"** — the second click does that):
  - **Stories about them** → `/hub/about/<personId>` (existing)
  - **Manage kin** → `/hub/kin?scope=<family>` (existing)
  - **Add parent**, **Add child**, **Add sibling** → open the add-relative form targeted at the **selected** person (see §5), i.e. `/hub/kin` add-relative with the anchor person and relation preset.
- The panel is dismissible (existing close control). Opening a panel for an anonymous bridge / nameless person behaves as today.

**Testing.** First-click selects + opens panel (with the five actions, no "center"); second-click on the selected node re-roots (root state changes, relations recompute, URL updates); the viewer's node is the only one labeled "You" after re-rooting on a relative.

---

## 4. Caret redesign — per-box expand/collapse toggles

Replace the per-generation left-margin `collapse-generation` carets **entirely** with **per-box toggle carets**. A caret is a medium-weight up/down chevron whose direction encodes the current state.

### 4a. Which carets exist

For each drawn node:

- **Ancestor caret (top of the box)** — emitted iff the node **has any parents** in the graph (drawn, collapsed, or hidden/boundary).
  - **Expanded** (its parents are currently drawn) → chevron **down** → click **collapses** the ancestor subtree above this node.
  - **Collapsed** (parents exist but are not drawn — user-collapsed, or a boundary node whose parents aren't loaded) → chevron **up** → click **expands** (revealing loaded parents, or fetching when `hasHiddenParents`).

- **Descendant caret (bottom)** — emitted iff the node **has any children** in the graph.
  - **Placement:** if the node has a **known partner drawn adjacent** (a union), the couple gets **one** caret centered on the **partner-link edge** between the two boxes. If there is no known/drawn partner, the caret sits on the **node's bottom**. A couple never shows two descendant carets.
  - **Expanded** (children drawn) → chevron **up** → click **collapses** the descendant subtree below.
  - **Collapsed** (children exist but not drawn) → chevron **down** → click **expands** (reveal loaded / fetch when `hasHiddenChildren`).

### 4b. Collapse semantics + expansion state

`ExpansionState` is reshaped from per-generation to per-anchor:

- Drop `collapsedGenerations`.
- Keep/repurpose `expandedParents` / `expandedChildren` (boundary reveals that required a fetch) and add **`collapsedAncestors: Set<anchorKey>`** and **`collapsedDescendants: Set<anchorKey>`**.
- **Ancestor collapse:** collapsing node `N` hides everything reachable *only* upward through `N`'s parents (the ancestor subtree). `N` stays; its top caret flips to "collapsed/up".
- **Descendant collapse:** collapsing a couple/node hides everything reachable *only* downward through their children. For a couple the caret toggles the shared descendant subtree (both partners), keyed by a canonical couple key (e.g. the normalized partner pair; a lone parent keys by personId).
- The layout's `drawable` computation applies these cuts: a node's parents are not drawn if the node's ancestor-collapse is set; a node's children are not drawn if the parent's/couple's descendant-collapse is set — removing, recursively, anything reachable only through the cut.

### 4c. Default state

On initial load (and after a re-root), everything in the ±2 window is **expanded** (drawn), so in-window nodes show collapse-direction carets; **boundary** nodes (`hasHiddenParents` / `hasHiddenChildren`) show expand-direction carets that fetch on click. This is the model the browser session already half-showed; the redesign makes both halves (reveal *and* collapse) a single per-box toggle.

### 4d. Rendering

- The chevron is drawn by `TreeCanvas` as an SVG/host glyph positioned at the affordance's `(x, y)`; `tree-layout.ts` supplies position, direction (from state), and the toggle target. Node cards remain the 120×72 box; the ancestor caret sits centered on the top edge, the descendant caret centered on the bottom edge or on the union midpoint edge.
- Accessible: each caret is a real button with an aria-label reflecting its action and target ("Show parents of Odette" / "Hide Odette's parents" / "Show children" / "Hide children").

**Testing (pure layout — fast, no DB):**
- A node with drawn parents emits one top caret in "collapse/down" state; collapsing it removes the ancestor subtree and flips the caret to "expand/up".
- A couple that shares children emits exactly **one** descendant caret on the union edge (not one per partner); a lone parent emits it on the node.
- A boundary node (`hasHiddenChildren`) emits a descendant caret in the **collapsed/down** (expand) state whose toggle requires a fetch.
- No `collapse-generation` affordances are emitted.

---

## 5. `addRelative` gains an optional anchor (backend)

`addRelative` (`packages/core/src/kinship-write.ts`) today anchors implicitly to the viewer. Extend `AddRelativeInput` with an optional **`anchorPersonId`** (default = the viewer's own person). Semantics:

- The relative is attached to `anchorPersonId` instead of the viewer (e.g. "add a parent of Odette" asserts `parent_of(newPerson, Odette)`).
- **Authorization unchanged in spirit:** the actor (viewer) must be an active member of the family; the anchor must be a person visible in that family's kinship projection. Kinship assertions are already first-asserter-wins (any member may assert), so anchoring on another visible person grants no new authority — it only lets a member record a relationship that isn't about themselves. The write still records the viewer as `actorPersonId` (audit).
- Grandparent bridging and sibling-via-shared-parent logic operate relative to the anchor.

**UI wiring.** The `/hub/kin` add-relative form accepts an anchor person + preset relation (from the panel's Add parent/child/sibling links) and passes `anchorPersonId` through to `addRelative`. When no anchor is supplied it behaves exactly as today (adds a relative of the viewer).

**Testing (PGlite):** adding a parent with `anchorPersonId = X` creates the `parent_of(new, X)` edge; omitting it anchors to the viewer (unchanged); a non-member actor is still rejected; a "sibling" anchored on X shares X's parent.

---

## Testing summary

- Pure/unit: tap-vs-drag discrimination; `tree-layout` caret model (top/bottom, couple-edge dedup, direction-by-state, collapse removes subtree, no generation carets); the "You"=viewer label rule; relation relabel on re-root.
- PGlite: `addRelative` anchor variants.
- Component: hub Tree tab; story-detail tree link; panel actions (five, no center); first-click-panel / second-click-recenter.
- Browser re-verify (manual, against the dev-seed fixture): tab → tree, story → author-centered tree, tap reliability, second-tap smooth re-center, per-box caret toggles including one-per-couple descendant caret and real collapse.

## Sequencing

Land as separate builder+reviewer units on `worktree-kinship-integration`, in an order that front-loads the shared contract:

1. **Backend:** `addRelative` `anchorPersonId` (self-contained, unblocks the panel).
2. **Caret redesign** (`tree-layout.ts` + `ExpansionState` + caret rendering) — the largest unit.
3. **Click/panel** (tap detection, select→center, smooth re-root, "You" fix, panel actions wired to #1).
4. **Hub tab** + **story deep-link** (small, independent UI).

Each unit ships with its tests green; a final browser re-verify pass covers the integrated flow.
