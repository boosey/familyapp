# Plan — pedigree `/hub/tree` + `Person.sex`

Executes `docs/superpowers/specs/2026-07-12-kinship-tree-pedigree-nav-design.md`.
Subagent-driven (coder + fresh adversarial reviewer per task, per CLAUDE.md).

## Task DAG

- **F (foundation + contract)** — BLOCKING, lands first.
- **L (layout)** ∥ **W (write + profile sex)** — parallel after F.
- **U (canvas UI)** — after L (consumes `TreeLayout`) and F (`TreeNode.sex`).

Each task ends green (`pnpm --filter <pkg> test` + `typecheck` for touched packages).
Final integration pass runs `pnpm -r typecheck` + `pnpm -r test` and loads `/hub/tree`.

---

## SHARED CONTRACT (frozen by F before L/W/U start)

### A. Person sex — `@chronicle/db`
- `personSexEnum = pgEnum("person_sex", ["male", "female", "unknown"])` (near `lifeStatusEnum`).
- `persons.sex = personSexEnum("sex").default("unknown")` — **nullable** (no `.notNull()`); null
  and `'unknown'` are treated identically downstream.
- `export type PersonSex = (typeof personSexEnum.enumValues)[number];`
- `db:generate` → migration `0012_*.sql` + snapshot `schema.sql`; drift-guard test stays green.
  Additive (new enum + nullable column), no invariant change.
- Core barrel: `export type { PersonSex } from "@chronicle/db";` (mirrors line-82 `StoryRecording`).

### B. `TreeNode.sex` — `@chronicle/core/kinship-repository.ts`
- `TreeNode` gains `sex: PersonSex;` (import `PersonSex` from `@chronicle/db`).
- `resolveKinshipTree` selects `persons.sex`, maps `sex: r.sex ?? "unknown"`. Bridge/unidentified
  nodes surface `'unknown'`. Metadata-safe; passes the subject-hide overlay unchanged.

### C. Layout contract — `apps/web/app/hub/tree/tree-layout.ts` (owned by L, consumed by U)
```ts
interface ExpansionState { expandedParents: ReadonlySet<string>; expandedChildren: ReadonlySet<string>; }
// collapsedAncestors / collapsedDescendants REMOVED entirely.
interface FrontierChevron { direction: "ancestors" | "descendants"; personId: string; x: number; y: number; }
interface EmptyParentSlot { personId: string; x: number; y: number; }
interface TreeLayout {
  placed: PlacedNode[]; unions: PlacedUnion[]; connectors: Connector[];
  chevrons: FrontierChevron[]; emptyParentSlots: EmptyParentSlot[];
  bounds: { width: number; height: number };
}
```
- Retain `PlacedNode`, `PlacedUnion`, `Connector`, `coupleKey`, `NODE_W`, `NODE_H`,
  `layoutFromTreeData`, `EMPTY_EXPANSION` (updated), determinism discipline, node/edge dedup, BFS
  gen assignment, ±2 window + fixpoint reveal, union clustering.
- **Axis transpose:** `x = -generation * COL_STEP` (ancestors gen<0 → +x = right; descendants
  gen>0 → −x = left; focus x=0). Within-column (same generation) stacking on **y** by birthYear
  (nulls last, id tiebreak), union clusters kept contiguous.
- **Chevron:** one per node with `hasHiddenParents` (ancestor/right edge, `direction:"ancestors"`)
  or `hasHiddenChildren` (descendant/left edge, `direction:"descendants"`).
- **EmptyParentSlot:** one per drawn node with zero drawn parent edges AND `hasHiddenParents===false`
  (ancestor/right edge). Carries anchor `personId`.
- Connectors re-derived for the horizontal axis (parent right-edge → child left-edge; partner link
  vertical between adjacent same-generation cards). Bounds enclose cards + chevrons + slots.

### D. Add-relative + profile sex — `@chronicle/core` + `/hub/kin` + `/hub/profile` (owned by W)
- `AddRelativeInput.sex?: PersonSex` (default `'unknown'` when omitted); `addRelative` persists it on
  the created person; `insertMentionPerson` accepts/persists `sex`.
- `/hub/kin/add-relative-form.tsx`: optional Sex `<select>` (Male / Female / Prefer not to say →
  `unknown`); support `relation=partner` (add to accepted relations / preselect from `?relation=`).
- `/hub/kin/actions.ts`: thread `sex` through to `addRelative`.
- Profile (`/hub/profile/ProfileForm.tsx` + `actions.ts`): Sex control writing `persons.sex` via the
  existing person-update path.

### E. Canvas UI — `apps/web/app/hub/tree/*` (owned by U)
- `tree-canvas.tsx`: remove second-tap re-root + `TAP_SLOP`-reroot + collapse `onCaret` logic. Name
  click → select → `PersonPanel`. Render `chevrons` (→ `revealFetch(dir==="ancestors"?"parents":
  "children", personId)`) and `emptyParentSlots` (→ `/hub/kin?scope&anchor&relation=parent`). Toolbar
  **global ⋮** (`KebabMenu` targeting `rootPersonId`). Compute `parentCount`/`partnerCount` per node
  from `edges`. Keep drag-pan + Fit.
- `person-panel.tsx`: primary **"Center tree here"** button (hidden when `isRoot`) → `onRecenter(id)`;
  add **"Add partner"** link (`relation=partner`).
- `kebab-menu.tsx` (NEW, shared): props `{ node, familyId, parentCount, partnerCount }`. Add child /
  Add sibling always; Add parent when `parentCount < 2`; Add partner when `partnerCount === 0`. Each
  links to `/hub/kin?scope=<family>&anchor=<node.personId>&relation=<r>`.
- `person-node.tsx`: left-edge **sex color bar** from `node.sex` (`--sex-male` / `--sex-female`;
  unknown/null incl. bridge → neutral/no bar); root/You accent still wins. Optional per-card ⋮ opening
  the `KebabMenu`. New tokens `--sex-male: #5C7A97`, `--sex-female: #B57F73` in `_kindred/tokens.css`.

### F-pre. Copy strings (F adds all; L/W/U only reference) — `apps/web/app/_copy/hub.ts`
- `tree.centerHere`, `tree.addPartner`, `tree.kebabAddChild/Sibling/Parent/Partner`,
  `tree.addParentSlot` (empty-slot label), `tree.showEarlier` / `tree.showDescendants` (chevron aria).
- `kin.sexFieldLabel`, `kin.sexMale`, `kin.sexFemale`, `kin.sexUnknown` (add form).
- Profile sex label(s) under the existing profile copy block.
- Obsolete caret labels (`showParents`/`hideParents`/`showChildren`/`hideChildren`) may be removed by U
  once unreferenced.

## Non-goals (v1): multiple partners/remarriage, gendered relation labels, zoom-to-fit-all.
## HITL: do not merge; `kinship-integration` awaits human release.
