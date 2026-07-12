# Issue #32 — Kinship: add & view a relative (manual edge, first-asserter-wins)

Branch: `worktree-issue-32-add-view-relative`, stacked on #31 (`97f218f`). Master is behind; **do not rebase onto master**. No new DB migration (kinship + persons tables already exist from #30/#31 migrations 0008/0009). Additive code only.

Verifiable goal: "I add Grandma Eleanor (and an implicit unknown parent) and immediately see her in my kin list, labeled grandparent." Full relation set in v1: **parent, child, partner, grandparent, sibling**.

## The frozen shared contract

### A. Core write path — NEW file `packages/core/src/kinship-write.ts`
Must be added to `KINSHIP_ALLOWLIST` (and its canary list) in `packages/core/test/architecture.test.ts` because it imports guarded `@chronicle/db/kinship`.

```ts
export type AddRelativeRelation = "parent" | "child" | "partner" | "grandparent" | "sibling";

export interface AddRelativeInput {
  familyId: string;
  relation: AddRelativeRelation;
  displayName?: string | null;   // trimmed non-empty => identified mention; empty/absent => anonymous bridge relative (identified=false)
  birthDate?: string | null;     // optional calendar date "YYYY-MM-DD"
  birthYear?: number | null;
  lifeStatus?: "living" | "deceased"; // default "living"
  nature?: KinshipNature;        // for parent_of edges; default "unknown"
}

export interface AddRelativeResult {
  allowed: boolean;
  reason?: string;
  createdPersonId?: string;   // the relative
  bridgePersonId?: string;    // implicit anonymous middle node, when created
  edgeIds?: string[];         // ids of appended kinshipAssertions rows
}

export async function addRelative(db: Database, ctx: AuthContext, input: AddRelativeInput): Promise<AddRelativeResult>;
```

Behavior (re-resolve everything server-side; never trust the client):
1. Auth: `ctx.kind === "account"` else `{ allowed:false, reason:"not signed in" }`. Let `me = ctx.personId`.
2. Membership: `me` MUST have an ACTIVE membership in `input.familyId`, else `{ allowed:false, reason:"not a member of this family" }`. (Reuse the same active-membership check the kinship read/story paths use.)
3. Create the relative Person `R`: `origin="mention"`. `identified = displayName?.trim() ? true : false`. If identified set `displayName` + `spokenName` (first whitespace-delimited word); else both null. Carry `birthDate`/`birthYear`/`lifeStatus`. Check #30 for an existing mention-person creator and reuse it; otherwise create one small helper.
4. Build edges (all: `state="asserted"`, `actorPersonId=me`, `familyId`, `parent_of` nature = `input.nature ?? "unknown"`; `partnered_with` nature = null). ALWAYS pass endpoints through `normalizeEdgeEndpoints` before insert.
   - **parent**: `parent_of(R, me)`.
   - **child**: `parent_of(me, R)`.
   - **partner**: `partnered_with(me, R)`.
   - **grandparent**: needs a middle parent node. If `me` already has ≥1 recorded parent in this family, attach R as parent of each existing parent (`parent_of(R, P)` for each P). Otherwise create one anonymous bridge Person `B` (mention, identified=false, no name) and append `parent_of(B, me)` then `parent_of(R, B)`. Return `bridgePersonId` when created.
   - **sibling**: siblings share a parent. If `me` already has recorded parent(s) `P…`, append `parent_of(P, R)` for each. Otherwise create one anonymous bridge parent `B`, append `parent_of(B, me)` + `parent_of(B, R)`. Return `bridgePersonId` when created.
5. Return created ids. First-asserter-wins: no confirmation, edge is immediately family-visible.

"existing parent(s) of me" = read current parent_of edges where child==me in this family (via the existing read surface / a private query in the allowlisted file).

### B. Core read composition — add to existing `packages/core/src/kinship-repository.ts`
```ts
export interface KinListEntry {
  personId: string;
  relation: KinRelation;      // from deriveKin
  displayName: string | null; // null when the person is an unidentified placeholder
  identified: boolean;
  lifeStatus: "living" | "deceased";
}
export async function listMyKin(db: Database, ctx: AuthContext, familyId: string): Promise<KinListEntry[]>;
```
Composition: `resolveKinshipProjection(db, ctx, familyId)` → `deriveKin(edges, ctx.personId)` → look up each `personId`'s `displayName/identified/lifeStatus` from `persons`. Requires `ctx.kind==="account"` and active membership (resolveKinshipProjection already enforces). Sort stable (e.g. by relation closeness then name).

Export `addRelative`, `AddRelative*` types, `listMyKin`, `KinListEntry` from `packages/core/src/index.ts`.

### C. Web slice — `apps/web/app/hub/kin/`
- `page.tsx` (server component): resolve auth via `getRuntime()` + `auth.getCurrentAuthContext()`; resolve current family from `?scope=` (fall back to the person's first active family via the existing family-list helper); call `listMyKin`; render the kin list with **derived-label display strings** (parent→"Parent", grandparent→"Grandparent", partner→"Partner", sibling→"Sibling", child→"Child", plus the other KinRelation values) and the person's name — for unidentified placeholders render a relation-based fallback like "Unknown parent" / "Unknown relative". Include the add-relative form.
- `actions.ts`: `"use server"`; `addRelativeAction(formData)` → `beginLogContext()`, `getRuntime()`, auth check, parse relation/name/dob/lifeStatus, call `addRelative`, on `!allowed` return `{ error }`, else `revalidatePath("/hub/kin")`. Follow the existing `apps/web/app/hub/stories/[id]/actions.ts` pattern (plog/plogError, ActionResult shape).
- Add-relative form component (client): relation `<select>` (parent/child/partner/grandparent/sibling), name text input (optional — empty = anonymous bridge relative), optional DOB + life-status. "One-tap add grandparent" = relation=grandparent; the bridge is created server-side, the user never authors it. Use the Kindred design system conventions already present in apps/web.

## Tests (must be green before hand-back)
- `packages/core/test/kinship-write.test.ts` (PGlite via `createTestDatabase`): add identified parent → deriveKin(me) labels it `parent`; add child; add partner; **add grandparent from a parentless `me` → asserts a bridge Person exists with `identified=false` and two `parent_of` edges, and deriveKin(me) labels the relative `grandparent`**; add grandparent when a parent already exists → reuses it (no new bridge); add sibling (bridge + reuse cases) → labeled `sibling`; **family-wide visibility**: a second active member of the same family sees the edge via `resolveKinshipProjection`; **auth denial**: non-member gets `allowed:false`.
- `packages/core/test/kinship-repository.test.ts`: add `listMyKin` cases (identified name present; placeholder name null).
- `architecture.test.ts`: KINSHIP_ALLOWLIST + canary updated to include `kinship-write.ts` (kept sorted).
- Regression test companion for any bug found during build (project rule).

## Gates
`pnpm --filter @chronicle/core test`, `pnpm --filter @chronicle/core typecheck`, then `pnpm -r typecheck && pnpm -r test && pnpm -r lint`. HITL: human PR sign-off (like #30/#31); do not merge to master.
