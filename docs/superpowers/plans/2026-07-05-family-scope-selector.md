# Family Scope Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "create a family" and "ask to join a family" permanently available in-app via a hub scope selector (`[ All ▾ ]`), give the hub All + per-family scopes, land pending-only users in the hub, and make asks N-family content.

**Architecture:** Four increments, dependency-ordered. (1) Asks become N-family: new `ask_families` join table + migration + core/authz updates (must land together or the build breaks). (2) Routing: delete Gate C so pending-only users reach `/hub`. (3) The scope selector component + a single server-read `?scope=` param. (4) Per-tab scope filtering (hoist the existing Stories `?scope=` and Album `?family=` into the unified param; compose family-set seeding; steward-tab resolution).

**Tech Stack:** TypeScript ESM monorepo (pnpm workspaces), Drizzle + PGlite (tests) / Neon (prod), Next.js 15 App Router (React 19 server components), Vitest.

**Ground rules:** TS strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`. Run tests with `pnpm --filter <pkg> exec vitest run <file>`. Commit after every green step. Author every commit as `boosey.boudreaux@gmail.com` (Vercel git-author gate). After a bug fix, add a companion regression test.

---

## Increment 1 — Asks become N-family (`ask_families`)

`asks.familyId` (a nullable single FK, currently `null` for all UI-created asks; read server-side by story approval + `eraseAsk`) is replaced by an `ask_families` M2M join table mirroring `story_families`. Schema + migration + every core reader change together so the build stays green.

### Task 1.1: Add the `askFamilies` table to the schema

**Files:**
- Modify: `packages/db/src/schema.ts` (asks table region ~688-721; types region ~1150-1163)

- [ ] **Step 1: Add the `askFamilies` table** immediately after the `asks` table definition (after line 721). Mirror `storyFamilies` exactly (surrogate `id` PK, unique pair, two indexes):

```ts
export const askFamilies = pgTable(
  "ask_families",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    askId: uuid("ask_id")
      .notNull()
      .references(() => asks.id),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // An ask is targeted to a given family at most once.
    uniqueIndex("ask_families_ask_family_uq").on(t.askId, t.familyId),
    index("ask_families_ask_idx").on(t.askId),
    index("ask_families_family_idx").on(t.familyId),
  ],
);
```

- [ ] **Step 2: Remove the `familyId` column from `asks`.** Delete these lines from the `asks` table (currently 698-700):

```ts
    /** The family context the ask was raised in (for routing/notification). Nullable. */
    familyId: uuid("family_id").references(() => families.id),
```

- [ ] **Step 3: Add inferred types** next to `StoryFamily` (after line 1163):

```ts
export type AskFamily = typeof askFamilies.$inferSelect;
export type NewAskFamily = typeof askFamilies.$inferInsert;
```

- [ ] **Step 4: Export the table object** — add `askFamilies` to the alphabetical export list in `packages/db/src/schema-public.ts` (after `asks`, before `askSubjectPhotos`):

```ts
  asks,
  askFamilies,
  askSubjectPhotos,
```

- [ ] **Step 5: Export the types** — add to the `export type { ... }` block in `packages/db/src/index.ts` next to `StoryFamily`/`NewStoryFamily`:

```ts
  AskFamily,
  NewAskFamily,
```

- [ ] **Step 6: Typecheck the db package**

Run: `pnpm --filter @chronicle/db typecheck`
Expected: FAIL — every `asks.familyId` reader in `@chronicle/core` won't be caught here (different package), but `@chronicle/db` itself compiles. If db fails, it's a typo in the table def. Fix and re-run until db typechecks clean.

### Task 1.2: Regenerate the snapshot + author the migration

**Files:**
- Modify: `packages/db/drizzle/schema.sql` (via `db:generate`)
- Create: `packages/db/drizzle/migrations/0003_<name>.sql`
- Modify: `packages/db/drizzle/migrations/meta/*` (via `drizzle-kit generate`)

- [ ] **Step 1: Regenerate the snapshot**

Run: `pnpm --filter @chronicle/db db:generate`
Expected: `drizzle/schema.sql` now contains `CREATE TABLE "ask_families"` and no longer contains the `"family_id"` column inside `CREATE TABLE "asks"`, nor the `asks_family_id_families_id_fk` constraint.

- [ ] **Step 2: Generate the migration diff**

Run: `pnpm --filter @chronicle/db exec drizzle-kit generate`
Expected: a new `drizzle/migrations/0003_*.sql` is written containing `CREATE TABLE "ask_families"`, its FK/index statements, `ALTER TABLE "asks" DROP CONSTRAINT "asks_family_id_families_id_fk"`, and `ALTER TABLE "asks" DROP COLUMN "family_id"`.

- [ ] **Step 3: Hand-carry the backfill.** drizzle-kit does NOT copy data. Edit the generated `0003_*.sql` so the order is: create table + constraints/indexes FIRST, then **backfill**, then drop the FK, then drop the column. The backfill INSERT goes immediately before the `DROP CONSTRAINT`. Final file must read (adjust the auto-generated constraint/index statements to match, keeping `--> statement-breakpoint` between every statement):

```sql
CREATE TABLE "ask_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ask_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_families" ADD CONSTRAINT "ask_families_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_families" ADD CONSTRAINT "ask_families_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ask_families_ask_family_uq" ON "ask_families" USING btree ("ask_id","family_id");--> statement-breakpoint
CREATE INDEX "ask_families_ask_idx" ON "ask_families" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "ask_families_family_idx" ON "ask_families" USING btree ("family_id");--> statement-breakpoint
-- Backfill: every ask that carried a family context becomes one ask_families row before the column drops.
INSERT INTO "ask_families" ("ask_id", "family_id")
SELECT "id", "family_id" FROM "asks" WHERE "family_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "asks" DROP CONSTRAINT "asks_family_id_families_id_fk";--> statement-breakpoint
ALTER TABLE "asks" DROP COLUMN "family_id";
```

- [ ] **Step 4: Run the drift-guard test** (bonds snapshot ↔ chain)

Run: `pnpm --filter @chronicle/db exec vitest run test/migration-drift.test.ts`
Expected: PASS — "snapshot and migration chain produce identical schemas". If it fails, the snapshot (`schema.sql`) and the migration disagree on `ask_families`; reconcile the DDL (column order, index names) until identical.

- [ ] **Step 5: Run the full db test suite**

Run: `pnpm --filter @chronicle/db test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git -c user.name=boosey -c user.email=boosey.boudreaux@gmail.com commit -m "feat(db): ask_families join table + 0003 migration (retire asks.familyId)"
```

### Task 1.3: `createAsk` writes a family SET

**Files:**
- Modify: `packages/core/src/asks.ts` (`CreateAskInput` ~29-44; validation ~144-150; INSERT ~167-176)
- Test: `packages/core/test/asks.test.ts:48`

- [ ] **Step 1: Update the failing test first.** In `packages/core/test/asks.test.ts`, replace the `expect(ask.familyId).toBe(fam.id)` assertion (line 48) and change the create call to pass `familyIds`. The new expectation reads the join table. Add near the existing ask test:

```ts
import { askFamilies } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
// ...
const ask = await createAsk(db, account(asker), {
  targetPersonId: target,
  familyIds: [fam.id],
  questionText: "What was your first job?",
});
const links = await db
  .select({ familyId: askFamilies.familyId })
  .from(askFamilies)
  .where(eq(askFamilies.askId, ask.id));
expect(links.map((l) => l.familyId)).toEqual([fam.id]);
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @chronicle/core exec vitest run test/asks.test.ts`
Expected: FAIL — `familyIds` not a known property / `ask.familyId` gone.

- [ ] **Step 3: Change `CreateAskInput`** — replace the `familyId?: string` field (line 32) with:

```ts
  /** The family contexts the ask is raised in (optional). Each must be one the asker is an active member of. */
  familyIds?: string[];
```

- [ ] **Step 4: Change validation** (lines 144-150) to validate the set:

```ts
  // Each supplied family context must be one the asker is actually in. Defense in depth against a
  // hand-crafted form submission picking an arbitrary family id.
  const familyIds = [...new Set(input.familyIds ?? [])];
  for (const fid of familyIds) {
    if (!askerFamilies.has(fid)) {
      throw new AuthorizationError(
        "supplied familyId is not one the asker is an active member of",
      );
    }
  }
```

- [ ] **Step 5: Change the INSERT** (lines 167-176) — drop `familyId` from the ask row and insert join rows in the same transaction:

```ts
    const [row] = await tx
      .insert(asks)
      .values({
        askerPersonId: asker,
        targetPersonId: input.targetPersonId,
        questionText: question,
        status: "queued",
      })
      .returning();
    if (familyIds.length > 0) {
      await tx
        .insert(askFamilies)
        .values(familyIds.map((familyId) => ({ askId: row.id, familyId })));
    }
```

Add `askFamilies` to the `@chronicle/db/schema` import at the top of `asks.ts`.

- [ ] **Step 6: Run the test, expect PASS**

Run: `pnpm --filter @chronicle/core exec vitest run test/asks.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/asks.ts packages/core/test/asks.test.ts
git -c user.name=boosey -c user.email=boosey.boudreaux@gmail.com commit -m "feat(core): createAsk writes ask_families set"
```

### Task 1.4: Story approval reads the ask's family SET

**Files:**
- Modify: `packages/core/src/story-repository.ts` (approval tx ~586-604 and the step-6 default-targeting that consumes `askFamilyId`)
- Test: `packages/core/test/story-repository*.test.ts` (add a regression test)

- [ ] **Step 1: Write a regression test** asserting that approving a story answered from an ask targeted to families A+B seeds `story_families` with both. Add to the story-repository approval test file:

```ts
it("approval seeds story_families from the ask's family set", async () => {
  // ...arrange: family A + B, an ask to both, a draft story answering it...
  await approveStory(db, ctx, { storyId });
  const targets = await db
    .select({ familyId: storyFamilies.familyId })
    .from(storyFamilies)
    .where(eq(storyFamilies.storyId, storyId));
  expect(new Set(targets.map((t) => t.familyId))).toEqual(new Set([famA.id, famB.id]));
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @chronicle/core exec vitest run -t "approval seeds story_families from the ask"`
Expected: FAIL — currently reads a single `askFamilyId`.

- [ ] **Step 3: Replace the single-family read** (lines 586-604). Change `let askFamilyId: string | null = null;` to a set, and replace the `asks.familyId` select with an `askFamilies` read:

```ts
    let answeredAsk: Ask | null = null;
    // The ask's families (if any) are a secondary originating signal for default targeting (step 6).
    let askFamilyIds: string[] = [];
    if (current.askId !== null) {
      const [askCurrent] = await tx
        .select({ status: asks.status, storyId: asks.storyId })
        .from(asks)
        .where(eq(asks.id, current.askId))
        .limit(1);
      if (!askCurrent) {
        throw new InvariantViolation(
          `story ${input.storyId} references missing ask ${current.askId}`,
        );
      }
      const askFams = await tx
        .select({ familyId: askFamilies.familyId })
        .from(askFamilies)
        .where(eq(askFamilies.askId, current.askId));
      askFamilyIds = askFams.map((r) => r.familyId);
      // ...existing status/storyId handling of askCurrent stays...
```

- [ ] **Step 4: Update step-6 default targeting** to union `askFamilyIds` (a set) into the `story_families` seed instead of the single `askFamilyId`. Find where `askFamilyId` was consumed and change it to spread `askFamilyIds` into the family-id set being written. Add `askFamilies` to the imports.

- [ ] **Step 5: Run the test, expect PASS**

Run: `pnpm --filter @chronicle/core exec vitest run -t "approval seeds story_families from the ask"`
Expected: PASS.

- [ ] **Step 6: Run the whole core suite**

Run: `pnpm --filter @chronicle/core test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/test
git -c user.name=boosey -c user.email=boosey.boudreaux@gmail.com commit -m "feat(core): story approval targets the ask's full family set"
```

### Task 1.5: `eraseAsk` unions stewards across the ask's families

**Files:**
- Modify: `packages/core/src/erasure-repository.ts` (`eraseAsk` ~208-237)
- Test: `packages/core/test/erasure*.test.ts` (regression test)

- [ ] **Step 1: Write a regression test** — a steward of ANY family the ask targets may moderate-delete it:

```ts
it("eraseAsk lets the steward of any targeted family delete it", async () => {
  // family A (steward SA) + family B (steward SB); ask targets both; asker is neither steward
  const res = await eraseAsk(db, account(stewardB), { askId });
  expect(res.allowed).toBe(true);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @chronicle/core exec vitest run -t "eraseAsk lets the steward of any targeted family"`
Expected: FAIL — only the single `ask.familyId` steward is consulted.

- [ ] **Step 3: Replace the family read + steward collection** (lines 218-237). Drop `familyId` from the ask select; gather stewards from all `ask_families`:

```ts
  const [ask] = await db
    .select({
      id: asks.id,
      askerPersonId: asks.askerPersonId,
      recordingMediaId: asks.recordingMediaId,
    })
    .from(asks)
    .where(eq(asks.id, input.askId))
    .limit(1);
  if (!ask) return { allowed: false, reason: `ask ${input.askId} not found` };

  // The steward of ANY family the ask is addressed to may moderate-delete it.
  const famRows = await db
    .select({ stewardPersonId: families.stewardPersonId })
    .from(askFamilies)
    .innerJoin(families, eq(families.id, askFamilies.familyId))
    .where(eq(askFamilies.askId, input.askId));
  const stewardIds: (string | null)[] = famRows.map((f) => f.stewardPersonId);
  const decision = decideManage(viewer, ask.askerPersonId, stewardIds);
  if (!decision.allowed) return { allowed: false, reason: decision.reason };
```

Add `askFamilies` to the imports. If `eraseAsk` cascades `ask_families` rows on delete, delete them inside the erase transaction before deleting the ask row (FK has no `onDelete cascade`).

- [ ] **Step 4: Run the test, expect PASS**

Run: `pnpm --filter @chronicle/core exec vitest run -t "eraseAsk lets the steward of any targeted family"`
Expected: PASS.

- [ ] **Step 5: Update the compose server action + seed + web tests to the new API.** `apps/web/app/hub/tabs/AskTab.tsx` `submitAsk` and `apps/web/lib/dev-seed.ts` `createAsk(...)` calls, and `apps/web/__tests__/story-imagery-compose.server.test.ts:215,255` — change any `familyId: x` to `familyIds: [x]` (or omit). (The compose UI family-set selector itself lands in Task 4.4; here just keep the build green.)

- [ ] **Step 6: Full monorepo green**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS across all packages. This is the gate that Increment 1 is complete.

- [ ] **Step 7: Commit**

```bash
git add packages/core apps/web
git -c user.name=boosey -c user.email=boosey.boudreaux@gmail.com commit -m "feat(core): eraseAsk unions stewards across ask_families; wire callers"
```

---

## Increment 2 — Routing: pending-only users land in the hub

### Task 2.1: Delete Gate C

**Files:**
- Modify: `apps/web/lib/post-auth-route.ts` (Gate C, lines 43-45)
- Test: `apps/web/__tests__/post-auth-route*.test.ts` (create if absent)

- [ ] **Step 1: Write the regression test** for the new behavior:

```ts
it("routes an onboarded, pending-only user to /hub (Gate C deleted)", async () => {
  // person: onboarded, no active membership, one pending join request
  const dest = await resolvePostAuthRoute(db, personId);
  expect(dest).toBe("/hub");
});
it("still routes a zero-relationship user to /families/start", async () => {
  const dest = await resolvePostAuthRoute(db, freshPersonId);
  expect(dest).toBe("/families/start");
});
```

- [ ] **Step 2: Run it, expect FAIL** on the first case (currently `/families/find`).

Run: `pnpm --filter @chronicle/web exec vitest run post-auth-route`
Expected: FAIL.

- [ ] **Step 3: Delete Gate C** (lines 43-45 + its comment) from `resolvePostAuthRoute`. The function now falls through from Gate B to `return "/hub"`. Also update the top-of-file docstring to drop the Gate C line.

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm --filter @chronicle/web exec vitest run post-auth-route`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/post-auth-route.ts apps/web/__tests__
git -c user.name=boosey -c user.email=boosey.boudreaux@gmail.com commit -m "feat(web): pending-only users land in the hub (delete routing Gate C)"
```

*(The `/hub` guard needs no change — it admits anyone `resolvePostAuthRoute` returns `/hub` for, which now includes pending-only.)*

---

## Increment 3 — The scope selector + unified `?scope=` param

### Task 3.1: Server-read the hub scope param + selector data

**Files:**
- Modify: `apps/web/app/hub/page.tsx` (searchParams ~51-55, 78-80; header ~211-266; account items ~177-183)
- Create: `apps/web/app/hub/HubScopeSelector.tsx`

- [ ] **Step 1: Add a scope resolver** near the tab parse in `page.tsx` (after line 80). Reuse `listActiveFamiliesForPerson` (already imported for `loadViewerFamilies`) and `listJoinRequestsByRequester`:

```tsx
  const { tab: tabParam, family: familyParam, scope: scopeParam } = await searchParams;
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  const requesterRequests = await listJoinRequestsByRequester(db, ctx.personId);
  const pendingScopeRows = requesterRequests.filter((r) => r.status === "pending");
  // Validate ?scope against the viewer's OWN active families; never trust the client. Default "all".
  const scope =
    scopeParam && activeFamilies.some((f) => f.familyId === scopeParam) ? scopeParam : "all";
```

Add `scope?: string` to the `searchParams` Promise type (line 54).

- [ ] **Step 2: Build the selector component** `HubScopeSelector.tsx` — a client dropdown mirroring the Album switcher semantics. Rows: `All` + each active family (clickable → `router.push` preserving `tab`), a divider, muted pending rows (non-clickable), a divider, then `+ Create a family` (→ `/families/new`) and `🔍 Find a family to join` (→ `/families/find`). Props:

```tsx
"use client";
import { useRouter } from "next/navigation";

export interface ScopeFamily { familyId: string; familyName: string }
export interface PendingScope { familyName: string; stewardName: string }
interface Props {
  scope: string;              // "all" | familyId
  tab: string;                // preserve on switch
  families: ScopeFamily[];
  pending: PendingScope[];
}
export function HubScopeSelector({ scope, tab, families, pending }: Props) {
  const router = useRouter();
  const go = (s: string) => router.push(`/hub?tab=${encodeURIComponent(tab)}&scope=${encodeURIComponent(s)}`);
  // closed label: "All" | family name | "No family yet" (families.length === 0)
  // ...dropdown with the row structure above; style like AlbumSurface's switcher pills...
}
```

- [ ] **Step 3: Mount it in the header** title-row flex `<div>` (line 220), replacing the crest `<span>` (221-240): render `<HubScopeSelector scope={scope} tab={activeTab} families={activeFamilies} pending={pendingScopeRows.map(r => ({ familyName: r.familyName, stewardName: r.stewardName }))} />` in place of the letter placeholder. Keep the `<h1>` family title.

- [ ] **Step 4: Remove the `manage-family` account item** — delete line 180 of `page.tsx` (`{ key: "manage-family", ... }`).

- [ ] **Step 5: Fix `HubTabsNav` to preserve scope** — it currently pushes `/hub?tab=${key}`, dropping `scope`. Thread the current scope through:

```tsx
// HubTabsNav.tsx — accept `scope` prop, push `/hub?tab=${key}&scope=${scope}`
```
And pass `scope={scope}` from `page.tsx` (line ~264).

- [ ] **Step 6: Typecheck + run web tests**

Run: `pnpm --filter @chronicle/web typecheck && pnpm --filter @chronicle/web exec vitest run hub`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/hub
git -c user.name=boosey -c user.email=boosey.boudreaux@gmail.com commit -m "feat(web): hub scope selector + unified server-read ?scope= param"
```

---

## Increment 4 — Per-tab scope filtering

The selected `scope` (from Task 3.1) is now threaded into each tab so `All` shows a deduped union and a family scopes the view. Reads: filter/union. Writes: seed the family set. Steward tabs: resolve/aggregate.

### Task 4.1: Stories tab honors server scope (dedup union in All)

**Files:**
- Modify: `apps/web/app/hub/page.tsx` (StoriesTab props), `apps/web/app/hub/tabs/StoriesTab.tsx`, `apps/web/app/hub/tabs/StoryBrowse.tsx`

- [ ] **Step 1: Regression test** — a story targeting families A+B appears once in `All` and appears when scoped to A and to B; a story only in A does not appear when scoped to B. Add to the stories-tab / story-browse test.
- [ ] **Step 2: Run, expect FAIL.** `pnpm --filter @chronicle/web exec vitest run StoryBrowse`
- [ ] **Step 3: Drive the scope from the server param.** Pass `scope` into `StoriesTab` → `StoryBrowse` as the initial/authoritative scope instead of `StoryBrowse` reading its own `?scope=` from `useSearchParams`. Keep `StoryBrowse`'s existing per-family narrowing logic (`items.filter((it) => it.families.some((f) => f.id === scope))`) but source `scope` from props; `All` returns the already-deduped `items`. Ensure `items` is deduped by story id (the feed union may repeat a story shared to two of the viewer's families).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(web): stories tab honors hub scope, dedup union in All`).

### Task 4.2: Album tab uses unified `?scope=`

**Files:**
- Modify: `apps/web/app/hub/page.tsx` (AlbumSurface props), `apps/web/app/hub/album/AlbumSurface.tsx`

- [ ] **Step 1: Regression test** — album scoped to family A shows A's photos; `All` shows the deduped union across the viewer's families. (Today the album always scopes to one family and defaults to the first; the change is: `All` → union, a family → that family.)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3:** Replace the `requestedFamily` (`?family=`) input with the hub `scope`. When `scope === "all"`, list photos across all active families (`listAlbumPhotos` per family, dedup by photo id) and hide the internal album switcher (the hub selector owns scope now); when `scope` is a family id, keep today's single-family behavior. Update the `familyHref` builder to `/hub?tab=album&scope=${id}`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(web): album tab honors hub scope`).

### Task 4.3: Asks list filters by `ask_families`

**Files:**
- Modify: `packages/core/src/asks.ts` (`listAsksByAsker` — add optional `familyId` filter via `ask_families`), `apps/web/app/hub/tabs/AsksTab.tsx`

- [ ] **Step 1: Regression test** (core) — `listAsksByAsker(db, ctx, { familyId })` returns only asks linked to that family; no filter returns all (deduped).
- [ ] **Step 2: Run, expect FAIL.** `pnpm --filter @chronicle/core exec vitest run asks`
- [ ] **Step 3:** Add an optional `{ familyId?: string }` arg to `listAsksByAsker`; when set, `innerJoin ask_families` on `askId` filtered to `familyId` (distinct on ask id). Pass `scope` from `AsksTab` (read the hub scope param in the tab or thread from `page.tsx`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(core): listAsksByAsker family filter; asks tab honors scope`).

### Task 4.4: Compose (Ask + Tell) seed the family set from scope

**Files:**
- Modify: `apps/web/app/hub/tabs/AskTab.tsx` (add family-set selector + pass `familyIds`), the Tell/story compose family picker (already ADR-0010 multi-target — seed default from scope)

- [ ] **Step 1:** In `AskTab`, render the viewer's active families (already loaded at lines 54-58) as a multi-select; when hub `scope` is a family, pre-check it; when `All` with exactly one family, pre-check it; when `All` with several, require ≥1 selection (client-validate). Submit `familyIds` in `submitAsk` → `createAsk(..., { familyIds })`.
- [ ] **Step 2:** For story compose (Tell), seed the existing ADR-0010 multi-target picker's default selection from the hub `scope` (family → pre-checked; else unchecked/required per existing rules). No new picker — just the default seed.
- [ ] **Step 3: Regression test** — composing an ask in scope=familyA writes an `ask_families` row for A; composing in `All` with two families requires a selection.
- [ ] **Step 4: Run, expect PASS.** `pnpm --filter @chronicle/web exec vitest run Ask`
- [ ] **Step 5: Commit** (`feat(web): compose seeds family set from hub scope`).

### Task 4.5: Invite + Requests tabs resolve scope

**Files:**
- Modify: `apps/web/app/hub/page.tsx` (Invite/Requests visibility + props), `apps/web/app/hub/tabs/InviteTab.tsx`, `apps/web/app/hub/tabs/RequestsTab.tsx`

- [ ] **Step 1:** Invite tab: when `scope` is a family, target that family; when `All` with >1 family, show a family picker as step zero; hide the Invite tab entirely for a member of no family (pending-only). Requests tab: when `scope` is a family, show that family's pending requests; in `All`, aggregate across all families the viewer stewards, each row labeled with its family (it already loads `listPendingJoinRequestsForSteward` across the steward's families — just add the family label to each row).
- [ ] **Step 2: Regression test** — a multi-family steward in `All` sees pending requests from every family they steward, each labeled; a pending-only user sees no Invite/Requests tab.
- [ ] **Step 3: Run, expect PASS.**
- [ ] **Step 4: Commit** (`feat(web): invite/requests tabs resolve hub scope`).

### Task 4.6: Pending-only empty hub

**Files:**
- Modify: `apps/web/app/hub/page.tsx` (empty-state copy), tab components as needed

- [ ] **Step 1: Regression test** — a pending-only user: `All` read tabs render empty-state copy ("Nothing here yet — you'll see stories once you're part of a family"); Invite + Requests tabs are absent; the selector shows the pending row + Create/Find.
- [ ] **Step 2: Run, expect FAIL, then implement** the empty-state copy where `feed`/photos/asks are empty and `activeFamilies.length === 0`.
- [ ] **Step 3: Run, expect PASS.**
- [ ] **Step 4: Commit** (`feat(web): pending-only empty hub state`).

---

## Final verification (gate before push)

- [ ] **Full green:** `pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm -r lint` — all 13 packages exit 0, drift-guard green.
- [ ] **Manual doc trues:** update `docs/DECISIONS.md` (Gate C removed; asks N-family; unified `?scope=`) and `docs/PROGRESS.md`; add an ADR note that asks joined the N-family content model (ADR-0010 lineage). Commit.
- [ ] **Push:** `git push origin master` — triggers Vercel build → `db:migrate` applies `0003` to prod Neon (backfill-then-drop) + parity gate → prod deploy. Confirm the deploy is READY and the migration applied before declaring done.

---

## Self-review notes (coverage vs. spec)

- Spec §1 selector → Task 3.1. Spec §2 routing → Task 2.1. Spec §3 per-tab semantics → Tasks 4.1–4.6 (reads union/dedup; writes seed set; Invite single-family; Requests aggregate; pending-only empty). Spec §4 asks N-family → Increment 1. Spec §5 plumbing (`?scope=` server-read, leak-safe validate) → Task 3.1. Spec §6 testing → regression tests in every task + final gate.
- **Deviation from spec:** the spec named a fresh `?scope=` param; research found an existing client-side `?scope=` (Stories) and `?family=` (Album). Plan **unifies** onto one server-read `?scope=` and retires the Album `?family=` — a strictly cleaner realization of the same intent. Recorded here so it isn't mistaken for scope creep.
- **Out of scope (unchanged):** Profile/Settings pages, steward console, LLM family search, crest imagery.
