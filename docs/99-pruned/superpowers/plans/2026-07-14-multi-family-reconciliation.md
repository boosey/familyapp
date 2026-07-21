# Multi-Family Person Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize the same real person across multiple families as a soft-linked identity cluster (never a physical merge), with dual-member confirmation, append-only governance, precision-tuned match-on-add, proactive join-time reconciliation, tree bridge badges, and combined-view dedupe.

**Architecture:** A new **guarded, append-only** `person_identity_links` ledger records `same_as` between two `persons` rows; a parallel `person_identity_link_denials` ledger holds subject-veto + per-family "deny". "One person" is never stored — it is a **per-viewer, render-time union-find cluster** scoped to families the viewer belongs to. A pure matcher scores candidates within the adder's own families. The core surface is parallel to kinship (its own allowlist entry) and **never grants content access**.

**Tech Stack:** TypeScript ESM, pnpm workspaces, Drizzle ORM, PGlite (tests), Vitest, Next.js 15 / React 19 (web). Follows ADR-0016 kinship patterns verbatim.

**Decision record:** `docs/adr/0019-cross-family-person-identity-is-a-soft-link-cluster.md`
**Spec:** `docs/superpowers/specs/2026-07-14-multi-family-reconciliation-design.md`

## File map

| File | Responsibility | Create/Modify |
| --- | --- | --- |
| `packages/db/src/schema.ts` | enums + `person_identity_links` + `person_identity_link_denials` tables + inferred types | Modify |
| `packages/db/drizzle/invariants.sql` | append-only triggers for the two ledgers | Modify |
| `packages/db/drizzle/migrations/0014_*.sql` | generated migration + hand-carried triggers | Create (via `db:generate`) |
| `packages/db/src/identity.ts` | guarded `@chronicle/db/identity` subpath | Create |
| `packages/db/package.json` | wire `./identity` export | Modify |
| `packages/db/src/index.ts` | re-export the new domain types | Modify |
| `packages/core/src/identity-cluster.ts` | pure union-find resolver (no DB) | Create |
| `packages/core/src/person-identity-links.ts` | DB write/read surface (assert/challenge/deny/veto/resolve/pending) | Create |
| `packages/core/src/person-match.ts` | pure `scoreMatch` + DB `findMatchCandidates` | Create |
| `packages/core/src/index.ts` | barrel exports | Modify |
| `packages/core/test/architecture.test.ts` | add both new files to `KINSHIP_ALLOWLIST` | Modify |
| `apps/web/app/...` | add-relative hint, join offer, tree badges, combined dedupe | Modify (Tasks 8–11) |

---

## Task 1: Schema — identity-link enums, tables, and inferred types

**Files:**
- Modify: `packages/db/src/schema.ts` (add near the kinship tables, ~line 1600)
- Test: `packages/db/test/identity-links-schema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/test/identity-links-schema.test.ts
import { createTestDatabase, type Database } from "../src/index";
import { personIdentityLinks, personIdentityLinkDenials } from "../src/identity";
import { beforeEach, describe, expect, it } from "vitest";
import { makePerson, makeFamily } from "../../core/test/helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("person_identity_links schema", () => {
  it("accepts an id-ordered same_as row and defaults state to 'suggested'", async () => {
    const a = await makePerson(db, "Eleanor A");
    const b = await makePerson(db, "Eleanor B");
    const fam = await makeFamily(db, "Boudreaux", a.id);
    const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const [row] = await db
      .insert(personIdentityLinks)
      .values({
        personLowId: lo,
        personHighId: hi,
        familyAId: fam.id,
        familyBId: fam.id,
        actorPersonId: a.id,
      })
      .returning();
    expect(row!.relation).toBe("same_as");
    expect(row!.state).toBe("suggested");
    expect(typeof row!.seq).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/db exec vitest run test/identity-links-schema.test.ts`
Expected: FAIL — `Cannot find module '../src/identity'` (subpath created in Task 3) and `personIdentityLinks` undefined.

- [ ] **Step 3: Add enums, tables, and types to `schema.ts`**

Add after the kinship tables (mirror their column style exactly — `bigserial` seq, `defaultRandom` id, timezone timestamps):

```typescript
// ── Cross-family person identity (ADR-0019) ──────────────────────────────────
// `same_as` soft-links two `persons` rows the same real human. NEVER a physical merge; "one person"
// is a per-viewer render-time cluster. Append-only (supersede via a new row), guarded like kinship.
export const identityRelationEnum = pgEnum("identity_relation", ["same_as"]);

// Lifecycle of a logical link (the pair). Latest row BY seq wins: `suggested` = system/deferred
// proposal awaiting confirmation; `asserted` = a dual-member confirmed; `challenged` = a dual-member
// retracted it. Only a latest-state `asserted` link (and not denied/vetoed) collapses a cluster.
export const identityLinkStateEnum = pgEnum("identity_link_state", [
  "suggested",
  "asserted",
  "challenged",
]);

export const personIdentityLinks = pgTable(
  "person_identity_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    // Endpoints stored id-ordered (low < high) so a pair has ONE canonical orientation.
    personLowId: uuid("person_low_id")
      .notNull()
      .references(() => persons.id),
    personHighId: uuid("person_high_id")
      .notNull()
      .references(() => persons.id),
    relation: identityRelationEnum("relation").notNull().default("same_as"),
    state: identityLinkStateEnum("state").notNull().default("suggested"),
    // The family pair this link bridges — drives per-family "deny" scoping and the viewer-visibility
    // rule (a viewer honors the link only if an active member of BOTH families). May be equal when a
    // duplicate is caught inside one family.
    familyAId: uuid("family_a_id")
      .notNull()
      .references(() => families.id),
    familyBId: uuid("family_b_id")
      .notNull()
      .references(() => families.id),
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => persons.id),
    supersedesId: uuid("supersedes_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("person_identity_links_pair_idx").on(t.personLowId, t.personHighId),
    index("person_identity_links_low_idx").on(t.personLowId),
    index("person_identity_links_high_idx").on(t.personHighId),
    check(
      "person_identity_links_ordered_ck",
      sql`${t.personLowId} < ${t.personHighId}`,
    ),
  ],
);

// Subject veto (family_id NULL ⇒ global, subject outranks everyone) + Steward "deny for my family"
// (family_id set). Parallel to kinship_subject_hides. Latest row BY seq per (pair, family_id) wins.
export const personIdentityLinkDenials = pgTable(
  "person_identity_link_denials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    personLowId: uuid("person_low_id")
      .notNull()
      .references(() => persons.id),
    personHighId: uuid("person_high_id")
      .notNull()
      .references(() => persons.id),
    // NULL = subject veto (global, everywhere). Non-null = a Steward denying for that one family.
    familyId: uuid("family_id").references(() => families.id),
    subjectPersonId: uuid("subject_person_id").references(() => persons.id),
    denied: boolean("denied").notNull(),
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("person_identity_link_denials_pair_idx").on(
      t.personLowId,
      t.personHighId,
    ),
  ],
);
```

Add the inferred types next to the kinship type exports (~line 1696):

```typescript
export type PersonIdentityLink = typeof personIdentityLinks.$inferSelect;
export type NewPersonIdentityLink = typeof personIdentityLinks.$inferInsert;
export type PersonIdentityLinkDenial = typeof personIdentityLinkDenials.$inferSelect;
export type NewPersonIdentityLinkDenial = typeof personIdentityLinkDenials.$inferInsert;
export type IdentityRelation = (typeof identityRelationEnum.enumValues)[number];
export type IdentityLinkState = (typeof identityLinkStateEnum.enumValues)[number];
```

Confirm `check`, `sql`, `bigserial`, `index`, `boolean` are already imported at the top of `schema.ts` (they are — used by kinship). No new imports needed.

- [ ] **Step 4: Create the guarded subpath so the test can import (see Task 3 for full file); minimal version now**

Create `packages/db/src/identity.ts`:

```typescript
/**
 * GUARDED identity-link tables (ADR-0019) — cross-family `same_as` soft-links + their denials.
 * Reachable ONLY through this subpath, exactly like `@chronicle/db/kinship`. The architecture test
 * fails CI if any production file outside the identity allowlist imports it. All reads/writes go
 * through `@chronicle/core`'s person-identity-links surface. Identity linkage NEVER grants content
 * access — a distinct data category, not the Story front door.
 */
export {
  personIdentityLinks,
  personIdentityLinkDenials,
  identityRelationEnum,
  identityLinkStateEnum,
} from "./schema";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/db exec vitest run test/identity-links-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/identity.ts packages/db/test/identity-links-schema.test.ts
git commit -m "feat(db): person_identity_links + denials tables (ADR-0019)"
```

---

## Task 2: Append-only triggers for both ledgers

**Files:**
- Modify: `packages/db/drizzle/invariants.sql` (add after the kinship triggers, ~line 348)
- Test: `packages/db/test/identity-links-append-only.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/test/identity-links-append-only.test.ts
import { createTestDatabase, type Database } from "../src/index";
import { personIdentityLinks } from "../src/identity";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { makePerson, makeFamily } from "../../core/test/helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function seedLink() {
  const a = await makePerson(db, "A");
  const b = await makePerson(db, "B");
  const fam = await makeFamily(db, "Fam", a.id);
  const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  const [row] = await db
    .insert(personIdentityLinks)
    .values({ personLowId: lo, personHighId: hi, familyAId: fam.id, familyBId: fam.id, actorPersonId: a.id })
    .returning();
  return row!;
}

describe("person_identity_links is append-only", () => {
  it("rejects UPDATE", async () => {
    const row = await seedLink();
    await expect(
      db.update(personIdentityLinks).set({ state: "asserted" }).where(eq(personIdentityLinks.id, row.id)),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE", async () => {
    const row = await seedLink();
    await expect(
      db.delete(personIdentityLinks).where(eq(personIdentityLinks.id, row.id)),
    ).rejects.toThrow(/append-only/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/db exec vitest run test/identity-links-append-only.test.ts`
Expected: FAIL — the UPDATE/DELETE succeed (no trigger yet), so `rejects.toThrow` fails.

- [ ] **Step 3: Add the triggers to `invariants.sql`**

Reuse the existing shared guard `chronicle_forbid_mutation()` (already defined at the top of the file):

```sql
-- (6) Identity-link ledgers are append-only (ADR-0019). A same_as assertion, a challenge, a subject
--     veto, and a Steward per-family deny all SUPERSEDE with a new row; the current state is the
--     latest row per logical pair (and per (pair, family) for denials). Fully append-only. No
--     person-erasure carve-out yet (rows FK persons with no cascade) — deferred, exactly as kinship.
CREATE TRIGGER person_identity_links_append_only
  BEFORE UPDATE OR DELETE ON person_identity_links
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();

CREATE TRIGGER person_identity_link_denials_append_only
  BEFORE UPDATE OR DELETE ON person_identity_link_denials
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chronicle/db exec vitest run test/identity-links-append-only.test.ts`
Expected: PASS. (`createTestDatabase` applies `invariants.sql`, so the triggers are live in PGlite.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/invariants.sql packages/db/test/identity-links-append-only.test.ts
git commit -m "feat(db): append-only triggers for identity-link ledgers"
```

---

## Task 3: Generate migration 0014 + hand-carry triggers; wire subpath exports

**Files:**
- Create: `packages/db/drizzle/migrations/0014_*.sql` (via `db:generate`)
- Modify: `packages/db/drizzle/migrations/0014_*.sql` (hand-carry the two triggers)
- Modify: `packages/db/package.json` (add `./identity` export)
- Modify: `packages/db/src/index.ts` (re-export new types)
- Test: `packages/db/test/migration-drift.test.ts` (existing — must stay green)

- [ ] **Step 1: Generate the snapshot + migration**

Run: `pnpm --filter @chronicle/db db:generate`
Expected: writes updated `drizzle/schema.sql`, and a new `drizzle/migrations/0014_<slug>.sql` containing the two `CREATE TABLE` statements + FKs + indexes + checks. (drizzle-kit does NOT emit trigger DDL — that lives only in `invariants.sql`.)

- [ ] **Step 2: Hand-carry the triggers into `0014_<slug>.sql`**

Append to the generated migration (durable Neon applies migrations, not `invariants.sql`, so the triggers MUST be in the migration or they never reach prod — this is the documented hand-carry step):

```sql
--> statement-breakpoint
CREATE TRIGGER person_identity_links_append_only
  BEFORE UPDATE OR DELETE ON person_identity_links
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER person_identity_link_denials_append_only
  BEFORE UPDATE OR DELETE ON person_identity_link_denials
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();
```

- [ ] **Step 3: Add the `./identity` export to `package.json`**

```json
"exports": {
  ".": "./src/index.ts",
  "./schema": "./src/schema-public.ts",
  "./content": "./src/content.ts",
  "./kinship": "./src/kinship.ts",
  "./identity": "./src/identity.ts",
  "./testing": "./src/testing.ts"
},
```

- [ ] **Step 4: Re-export the new domain types from `index.ts`**

Add to the `export type { ... } from "./schema";` block (next to the Kinship* types):

```typescript
  PersonIdentityLink,
  NewPersonIdentityLink,
  PersonIdentityLinkDenial,
  NewPersonIdentityLinkDenial,
  IdentityRelation,
  IdentityLinkState,
```

- [ ] **Step 5: Run the drift-guard + full db suite**

Run: `pnpm --filter @chronicle/db test`
Expected: PASS, including `migration-drift.test.ts` (snapshot ↔ migration-chain bond holds).

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle packages/db/package.json packages/db/src/index.ts
git commit -m "feat(db): migration 0014 identity links + hand-carried triggers + subpath export"
```

---

## Task 4: Pure cluster resolver (`identity-cluster.ts`)

The client-safe half — pure union-find, no DB, no auth. Groups person ids by their `same_as` links; deterministic ordering; a removed link cannot silently keep two real clusters fused.

**Files:**
- Create: `packages/core/src/identity-cluster.ts`
- Test: `packages/core/test/identity-cluster.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/identity-cluster.test.ts
import { describe, expect, it } from "vitest";
import { clusterByLinks, type IdentityLink } from "../src/identity-cluster";

const link = (a: string, b: string): IdentityLink => ({ personLowId: a < b ? a : b, personHighId: a < b ? b : a });

describe("clusterByLinks", () => {
  it("returns singletons when there are no links", () => {
    expect(clusterByLinks(["p1", "p2"], [])).toEqual([["p1"], ["p2"]]);
  });

  it("groups a linked pair", () => {
    const groups = clusterByLinks(["a", "b", "c"], [link("a", "b")]);
    expect(groups).toContainEqual(["a", "b"]);
    expect(groups).toContainEqual(["c"]);
  });

  it("is transitive: a=b, b=c ⇒ {a,b,c}", () => {
    const groups = clusterByLinks(["a", "b", "c"], [link("a", "b"), link("b", "c")]);
    expect(groups).toHaveLength(1);
    expect([...groups[0]!].sort()).toEqual(["a", "b", "c"]);
  });

  it("cutting one edge splits the cluster (no silent fusion)", () => {
    // a-b and b-c present ⇒ one cluster; drop b-c ⇒ {a,b} and {c}
    const groups = clusterByLinks(["a", "b", "c"], [link("a", "b")]);
    expect(groups.map((g) => [...g].sort())).toContainEqual(["a", "b"]);
    expect(groups.map((g) => [...g].sort())).toContainEqual(["c"]);
  });

  it("ignores links whose endpoints are outside the id set (scoping guard)", () => {
    const groups = clusterByLinks(["a"], [link("a", "z")]);
    expect(groups).toEqual([["a"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/identity-cluster.test.ts`
Expected: FAIL — `Cannot find module '../src/identity-cluster'`.

- [ ] **Step 3: Implement the pure resolver**

```typescript
// packages/core/src/identity-cluster.ts
// Pure identity clustering — the client-safe half of the reconciliation read model. No DB, no auth.
// "One real person" is a union-find closure over active `same_as` links, scoped to a given id set.

export interface IdentityLink {
  personLowId: string;
  personHighId: string;
}

/**
 * Partition `personIds` into clusters joined by `links`. Only links whose BOTH endpoints are in
 * `personIds` participate (the caller pre-scopes links to the viewer's families; this is a second
 * guard). Deterministic: clusters and members are returned id-sorted. Because the grouping is
 * recomputed from the given link set, removing a link (challenge/veto/deny upstream) cannot leave two
 * real clusters silently fused.
 */
export function clusterByLinks(personIds: string[], links: IdentityLink[]): string[][] {
  const parent = new Map<string, string>();
  for (const id of personIds) parent.set(id, id);

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // path-compress
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // deterministic: smaller id becomes root
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  for (const l of links) {
    if (parent.has(l.personLowId) && parent.has(l.personHighId)) {
      union(l.personLowId, l.personHighId);
    }
  }

  const byRoot = new Map<string, string[]>();
  for (const id of personIds) {
    const root = find(id);
    const g = byRoot.get(root);
    if (g) g.push(id);
    else byRoot.set(root, [id]);
  }
  const groups = [...byRoot.values()].map((g) => g.sort());
  // sort clusters by their smallest member for stable output
  return groups.sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chronicle/core exec vitest run test/identity-cluster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/identity-cluster.ts packages/core/test/identity-cluster.test.ts
git commit -m "feat(core): pure union-find identity cluster resolver"
```

---

## Task 5: Core write surface — `assertSameAs` (dual-member auth)

**Files:**
- Create: `packages/core/src/person-identity-links.ts`
- Modify: `packages/core/test/architecture.test.ts` (add to `KINSHIP_ALLOWLIST`)
- Modify: `packages/core/src/index.ts` (barrel)
- Test: `packages/core/test/person-identity-links.test.ts`

- [ ] **Step 1: Add the new file to the architecture allowlist FIRST (so the arch test stays green once the import lands)**

In `packages/core/test/architecture.test.ts`, extend `KINSHIP_ALLOWLIST`:

```typescript
const KINSHIP_ALLOWLIST = new Set<string>([
  "packages/core/src/kinship-repository.ts",
  "packages/core/src/kinship-write.ts",
  "packages/core/src/person-identity-links.ts", // ADR-0019 identity-link surface (imports @chronicle/db/identity)
]);
```

Also extend the guarded-import scan to cover the new subpath. Find the kinship scan block and change its regex constant, or add a sibling scan. Simplest: broaden the kinship regex:

```typescript
const KINSHIP_IMPORT = /@chronicle\/db\/(kinship|identity)/;
```

(Identity is governed by the same allowlist since it is the same "distinct data category, never content" guarantee.)

- [ ] **Step 2: Write the failing test**

```typescript
// packages/core/test/person-identity-links.test.ts
import { createTestDatabase, type Database } from "@chronicle/db";
import { personIdentityLinks } from "@chronicle/db/identity";
import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addMembership, assertSameAs, type AuthContext } from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});
const account = (personId: string): AuthContext => ({ kind: "account", personId });

/** Eleanor mentioned separately in two families; `bridge` is a member of BOTH. */
async function twoFamiliesWithDuplicate() {
  const bridge = await makePerson(db, "Bridge");
  const famA = await makeFamily(db, "Boudreaux", bridge.id);
  const famB = await makeFamily(db, "Carney", bridge.id);
  await addMembership(db, { personId: bridge.id, familyId: famA.id, role: "member" });
  await addMembership(db, { personId: bridge.id, familyId: famB.id, role: "member" });
  const elA = await makePerson(db, "Eleanor Vance"); // depicted in A
  const elB = await makePerson(db, "Eleanor Vance"); // depicted in B
  return { bridge, famA, famB, elA, elB };
}

describe("assertSameAs", () => {
  it("a dual-member appends an `asserted` same_as row (id-ordered)", async () => {
    const { bridge, famA, famB, elA, elB } = await twoFamiliesWithDuplicate();
    const res = await assertSameAs(db, account(bridge.id), {
      personAId: elA.id,
      familyAId: famA.id,
      personBId: elB.id,
      familyBId: famB.id,
    });
    expect(res.allowed).toBe(true);

    const rows = await db.select().from(personIdentityLinks).orderBy(asc(personIdentityLinks.seq));
    expect(rows).toHaveLength(1);
    const [lo, hi] = elA.id < elB.id ? [elA.id, elB.id] : [elB.id, elA.id];
    expect(rows[0]!.personLowId).toBe(lo);
    expect(rows[0]!.personHighId).toBe(hi);
    expect(rows[0]!.state).toBe("asserted");
    expect(rows[0]!.actorPersonId).toBe(bridge.id);
  });

  it("rejects an actor who is not a member of BOTH families", async () => {
    const { famA, famB, elA, elB } = await twoFamiliesWithDuplicate();
    const outsider = await makePerson(db, "Outsider");
    await addMembership(db, { personId: outsider.id, familyId: famA.id, role: "member" }); // only A
    const res = await assertSameAs(db, account(outsider.id), {
      personAId: elA.id, familyAId: famA.id, personBId: elB.id, familyBId: famB.id,
    });
    expect(res.allowed).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/person-identity-links.test.ts`
Expected: FAIL — `assertSameAs` not exported.

- [ ] **Step 4: Implement `assertSameAs` in `person-identity-links.ts`**

```typescript
// packages/core/src/person-identity-links.ts
/**
 * Cross-family person-identity surface (ADR-0019). Parallel to (NOT part of) the Story front door
 * and the kinship surface: identity linkage is a distinct data category and NEVER grants content
 * access. The guarded `@chronicle/db/identity` tables are reachable only from here (identity
 * allowlist). Soft-link only — rows supersede, never merge `persons`.
 */
import { and, asc, eq, or } from "drizzle-orm";
import {
  personIdentityLinks,
  personIdentityLinkDenials,
} from "@chronicle/db/identity";
import type { Database } from "@chronicle/db";
import type { AuthContext } from "./authorization";
import { isActiveMember } from "./memberships";

/** id-order a pair so a logical link has one canonical orientation. */
function orderPair(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

export interface AssertSameAsInput {
  personAId: string;
  familyAId: string;
  personBId: string;
  familyBId: string;
  note?: string | null;
}
export type IdentityLinkActionResult =
  | { allowed: true; linkId: string }
  | { allowed: false; reason: string };

/**
 * A dual-member confirms two persons are the same real human. Re-resolves auth + BOTH memberships
 * server-side (never trusts the client). Appends an `asserted` row. No physical merge.
 */
export async function assertSameAs(
  db: Database,
  ctx: AuthContext,
  input: AssertSameAsInput,
): Promise<IdentityLinkActionResult> {
  if (ctx.kind !== "account") return { allowed: false, reason: "not signed in" };
  const me = ctx.personId;
  if (input.personAId === input.personBId) {
    return { allowed: false, reason: "cannot link a person to themselves" };
  }
  const [inA, inB] = await Promise.all([
    isActiveMember(db, me, input.familyAId),
    isActiveMember(db, me, input.familyBId),
  ]);
  if (!inA || !inB) {
    return { allowed: false, reason: "actor must be an active member of both families" };
  }
  const { low, high } = orderPair(input.personAId, input.personBId);
  const [row] = await db
    .insert(personIdentityLinks)
    .values({
      personLowId: low,
      personHighId: high,
      familyAId: input.familyAId,
      familyBId: input.familyBId,
      actorPersonId: me,
      state: "asserted",
      note: input.note ?? null,
    })
    .returning({ id: personIdentityLinks.id });
  return { allowed: true, linkId: row!.id };
}
```

- [ ] **Step 5: Add barrel exports to `packages/core/src/index.ts`**

```typescript
export {
  assertSameAs,
  type AssertSameAsInput,
  type IdentityLinkActionResult,
} from "./person-identity-links";
export { clusterByLinks, type IdentityLink } from "./identity-cluster";
```

- [ ] **Step 6: Run tests (targeted + architecture)**

Run: `pnpm --filter @chronicle/core exec vitest run test/person-identity-links.test.ts test/architecture.test.ts`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/person-identity-links.ts packages/core/src/index.ts packages/core/test/architecture.test.ts packages/core/test/person-identity-links.test.ts
git commit -m "feat(core): assertSameAs dual-member identity linking (ADR-0019)"
```

---

## Task 6: Governance — `challengeSameAs`, `denyForFamily`, `subjectVeto`

**Files:**
- Modify: `packages/core/src/person-identity-links.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/person-identity-links-governance.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/person-identity-links-governance.test.ts
import { createTestDatabase, type Database } from "@chronicle/db";
import { personIdentityLinkDenials } from "@chronicle/db/identity";
import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership, assertSameAs, challengeSameAs, denyForFamily, subjectVeto,
  type AuthContext,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => { db = await createTestDatabase(); });
const account = (personId: string): AuthContext => ({ kind: "account", personId });

async function linkedPair() {
  const steward = await makePerson(db, "Steward");
  const famA = await makeFamily(db, "Boudreaux", steward.id); // makeFamily makes creator a steward
  const famB = await makeFamily(db, "Carney", steward.id);
  await addMembership(db, { personId: steward.id, familyId: famA.id, role: "steward" });
  await addMembership(db, { personId: steward.id, familyId: famB.id, role: "steward" });
  const elA = await makePerson(db, "Eleanor");
  const elB = await makePerson(db, "Eleanor");
  await assertSameAs(db, account(steward.id), { personAId: elA.id, familyAId: famA.id, personBId: elB.id, familyBId: famB.id });
  return { steward, famA, famB, elA, elB };
}

describe("identity-link governance", () => {
  it("challengeSameAs appends a `challenged` link row", async () => {
    const { steward, elA, elB } = await linkedPair();
    const res = await challengeSameAs(db, account(steward.id), { personAId: elA.id, personBId: elB.id });
    expect(res.allowed).toBe(true);
  });

  it("denyForFamily records a family-scoped denial", async () => {
    const { steward, famA, elA, elB } = await linkedPair();
    const res = await denyForFamily(db, account(steward.id), { personAId: elA.id, personBId: elB.id, familyId: famA.id });
    expect(res.allowed).toBe(true);
    const rows = await db.select().from(personIdentityLinkDenials).orderBy(asc(personIdentityLinkDenials.seq));
    expect(rows[0]!.familyId).toBe(famA.id);
    expect(rows[0]!.denied).toBe(true);
  });

  it("subjectVeto records a global (family_id NULL) denial by the subject", async () => {
    const { elA, elB } = await linkedPair();
    // Give elA an account so they can act as the subject.
    const res = await subjectVeto(db, account(elA.id), { personAId: elA.id, personBId: elB.id });
    expect(res.allowed).toBe(true);
    const rows = await db.select().from(personIdentityLinkDenials).orderBy(asc(personIdentityLinkDenials.seq));
    expect(rows[0]!.familyId).toBeNull();
    expect(rows[0]!.subjectPersonId).toBe(elA.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/person-identity-links-governance.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the three governance functions in `person-identity-links.ts`**

```typescript
import { isStewardOf } from "./memberships"; // add to existing imports if not present

export interface LinkRef { personAId: string; personBId: string }

/** A dual-member (or the subject) retracts a link: appends a `challenged` row (latest-state wins). */
export async function challengeSameAs(
  db: Database, ctx: AuthContext, ref: LinkRef,
): Promise<IdentityLinkActionResult> {
  if (ctx.kind !== "account") return { allowed: false, reason: "not signed in" };
  const { low, high } = orderPair(ref.personAId, ref.personBId);
  // Find the latest link row for this pair to copy its family context + verify it exists.
  const [latest] = await db
    .select()
    .from(personIdentityLinks)
    .where(and(eq(personIdentityLinks.personLowId, low), eq(personIdentityLinks.personHighId, high)))
    .orderBy(asc(personIdentityLinks.seq));
  if (!latest) return { allowed: false, reason: "no such link" };
  const [inA, inB] = await Promise.all([
    isActiveMember(db, ctx.personId, latest.familyAId),
    isActiveMember(db, ctx.personId, latest.familyBId),
  ]);
  const isSubject = ctx.personId === low || ctx.personId === high;
  if (!isSubject && !(inA && inB)) {
    return { allowed: false, reason: "must be a dual-member or the subject" };
  }
  const [row] = await db
    .insert(personIdentityLinks)
    .values({
      personLowId: low, personHighId: high,
      familyAId: latest.familyAId, familyBId: latest.familyBId,
      actorPersonId: ctx.personId, state: "challenged",
    })
    .returning({ id: personIdentityLinks.id });
  return { allowed: true, linkId: row!.id };
}

/** A Steward declines to honor a link in ONE of their families (link persists elsewhere). */
export async function denyForFamily(
  db: Database, ctx: AuthContext, ref: LinkRef & { familyId: string },
): Promise<IdentityLinkActionResult> {
  if (ctx.kind !== "account") return { allowed: false, reason: "not signed in" };
  if (!(await isStewardOf(db, ctx.personId, ref.familyId))) {
    return { allowed: false, reason: "must be the Steward of this family" };
  }
  const { low, high } = orderPair(ref.personAId, ref.personBId);
  const [row] = await db
    .insert(personIdentityLinkDenials)
    .values({
      personLowId: low, personHighId: high,
      familyId: ref.familyId, denied: true, actorPersonId: ctx.personId,
    })
    .returning({ id: personIdentityLinkDenials.id });
  return { allowed: true, linkId: row!.id };
}

/** The subject (an account that is one endpoint) suppresses the link everywhere — outranks Stewards. */
export async function subjectVeto(
  db: Database, ctx: AuthContext, ref: LinkRef,
): Promise<IdentityLinkActionResult> {
  if (ctx.kind !== "account") return { allowed: false, reason: "not signed in" };
  const { low, high } = orderPair(ref.personAId, ref.personBId);
  if (ctx.personId !== low && ctx.personId !== high) {
    return { allowed: false, reason: "only the subject may veto" };
  }
  const [row] = await db
    .insert(personIdentityLinkDenials)
    .values({
      personLowId: low, personHighId: high,
      familyId: null, subjectPersonId: ctx.personId, denied: true, actorPersonId: ctx.personId,
    })
    .returning({ id: personIdentityLinkDenials.id });
  return { allowed: true, linkId: row!.id };
}
```

Note: `isStewardOf(db, personId, familyId)` — if it does not already exist in `memberships.ts`, add it there as a small query mirroring `isActiveMember` but filtering `role = 'steward'`. Verify against `packages/core/src/memberships.ts` before implementing; reuse if present.

- [ ] **Step 4: Add barrel exports**

```typescript
export {
  assertSameAs, challengeSameAs, denyForFamily, subjectVeto,
  type AssertSameAsInput, type LinkRef, type IdentityLinkActionResult,
} from "./person-identity-links";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/core exec vitest run test/person-identity-links-governance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/person-identity-links.ts packages/core/src/index.ts packages/core/src/memberships.ts packages/core/test/person-identity-links-governance.test.ts
git commit -m "feat(core): identity-link governance (challenge/deny-for-family/subject-veto)"
```

---

## Task 7: Render-time resolver — `resolveIdentityCluster` (viewer-scoped, honor rules)

Loads active links, applies the viewer-visibility rule (viewer must be an active member of BOTH bridged families), removes challenged links + denied/vetoed pairs, then calls the pure `clusterByLinks`. Picks a canonical representative per cluster (prefer a `self`/account row, else lowest id).

**Files:**
- Modify: `packages/core/src/person-identity-links.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/resolve-identity-cluster.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/resolve-identity-cluster.test.ts
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership, assertSameAs, resolveIdentityCluster, subjectVeto, type AuthContext,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => { db = await createTestDatabase(); });
const account = (personId: string): AuthContext => ({ kind: "account", personId });

async function dualMemberLinked() {
  const bridge = await makePerson(db, "Bridge");
  const famA = await makeFamily(db, "Boudreaux", bridge.id);
  const famB = await makeFamily(db, "Carney", bridge.id);
  await addMembership(db, { personId: bridge.id, familyId: famA.id, role: "member" });
  await addMembership(db, { personId: bridge.id, familyId: famB.id, role: "member" });
  const elA = await makePerson(db, "Eleanor");
  const elB = await makePerson(db, "Eleanor");
  await assertSameAs(db, account(bridge.id), { personAId: elA.id, familyAId: famA.id, personBId: elB.id, familyBId: famB.id });
  return { bridge, famA, famB, elA, elB };
}

describe("resolveIdentityCluster", () => {
  it("dual-member viewer sees the two Eleanors collapsed to one cluster", async () => {
    const { bridge, elA, elB } = await dualMemberLinked();
    const map = await resolveIdentityCluster(db, account(bridge.id), [elA.id, elB.id]);
    expect(map.get(elA.id)).toBe(map.get(elB.id)); // same representative
  });

  it("single-family viewer sees singletons (no cross-family leak)", async () => {
    const { famA, elA, elB } = await dualMemberLinked();
    const soloA = await makePerson(db, "SoloA");
    await addMembership(db, { personId: soloA.id, familyId: famA.id, role: "member" });
    const map = await resolveIdentityCluster(db, account(soloA.id), [elA.id, elB.id]);
    expect(map.get(elA.id)).not.toBe(map.get(elB.id)); // link dormant for a non-dual-member
  });

  it("subject veto dissolves the cluster even for a dual-member", async () => {
    const { bridge, elA, elB } = await dualMemberLinked();
    await subjectVeto(db, account(elA.id), { personAId: elA.id, personBId: elB.id });
    const map = await resolveIdentityCluster(db, account(bridge.id), [elA.id, elB.id]);
    expect(map.get(elA.id)).not.toBe(map.get(elB.id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/resolve-identity-cluster.test.ts`
Expected: FAIL — `resolveIdentityCluster` not exported.

- [ ] **Step 3: Implement `resolveIdentityCluster`**

```typescript
import { persons, memberships } from "@chronicle/db/schema";
import { clusterByLinks, type IdentityLink } from "./identity-cluster";

/**
 * Resolve `personIds` into a map person → canonical-representative-id, scoped to `ctx`'s viewer:
 *   - only `asserted` (latest-state) links participate;
 *   - a link is HONORED only if the viewer is an active member of BOTH bridged families
 *     (the leakage bound — a single-family viewer never learns cross-family sameness);
 *   - a link is dropped if the subject vetoed it (global denial) or either bridged family denied it;
 *   - representative prefers a `self`/account row, else the lowest id (deterministic).
 * Persons not linked map to themselves. Never widens content authorization.
 */
export async function resolveIdentityCluster(
  db: Database,
  ctx: AuthContext,
  personIds: string[],
): Promise<Map<string, string>> {
  const self = new Map(personIds.map((id) => [id, id] as const));
  if (ctx.kind !== "account" || personIds.length === 0) return self;
  const viewer = ctx.personId;

  // Families the viewer is an active member of.
  const memRows = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(and(eq(memberships.personId, viewer), eq(memberships.status, "active")));
  const viewerFamilies = new Set(memRows.map((m) => m.familyId));
  if (viewerFamilies.size === 0) return self;

  const idSet = new Set(personIds);

  // Latest link row per pair (BY seq) whose both endpoints are in the id set.
  const linkRows = await db
    .select()
    .from(personIdentityLinks)
    .orderBy(asc(personIdentityLinks.seq));
  const latestByPair = new Map<string, (typeof linkRows)[number]>();
  for (const r of linkRows) {
    if (!idSet.has(r.personLowId) || !idSet.has(r.personHighId)) continue;
    latestByPair.set(`${r.personLowId}|${r.personHighId}`, r); // last write wins = latest seq
  }

  // Latest denial per (pair, familyId|SUBJECT) BY seq.
  const denialRows = await db
    .select()
    .from(personIdentityLinkDenials)
    .orderBy(asc(personIdentityLinkDenials.seq));
  const globalVeto = new Set<string>(); // pairKey
  const familyDeny = new Set<string>(); // `${pairKey}|${familyId}`
  const latestDenial = new Map<string, boolean>();
  for (const d of denialRows) {
    const pairKey = `${d.personLowId}|${d.personHighId}`;
    const scope = d.familyId === null ? "GLOBAL" : d.familyId;
    latestDenial.set(`${pairKey}|${scope}`, d.denied);
  }
  for (const [key, denied] of latestDenial) {
    if (!denied) continue;
    const [low, high, scope] = key.split("|");
    const pairKey = `${low}|${high}`;
    if (scope === "GLOBAL") globalVeto.add(pairKey);
    else familyDeny.add(`${pairKey}|${scope}`);
  }

  const honored: IdentityLink[] = [];
  for (const [pairKey, r] of latestByPair) {
    if (r.state !== "asserted") continue; // challenged/suggested don't collapse
    // viewer must be a dual-member of the bridged families
    if (!viewerFamilies.has(r.familyAId) || !viewerFamilies.has(r.familyBId)) continue;
    if (globalVeto.has(pairKey)) continue; // subject outranks
    if (familyDeny.has(`${pairKey}|${r.familyAId}`) || familyDeny.has(`${pairKey}|${r.familyBId}`)) continue;
    honored.push({ personLowId: r.personLowId, personHighId: r.personHighId });
  }

  const groups = clusterByLinks(personIds, honored);

  // Pick a representative per cluster: a `self`-origin/account row if any, else lowest id.
  const meta = await db
    .select({ id: persons.id, origin: persons.origin, accountId: persons.accountId })
    .from(persons)
    .where(inArray(persons.id, personIds));
  const isSelf = new Map(meta.map((m) => [m.id, m.origin === "self" || m.accountId !== null] as const));

  const rep = new Map<string, string>();
  for (const group of groups) {
    const chosen = group.find((id) => isSelf.get(id)) ?? group[0]!;
    for (const id of group) rep.set(id, chosen);
  }
  return rep;
}
```

Add `inArray` to the drizzle import at the top of the file: `import { and, asc, eq, inArray, or } from "drizzle-orm";`

- [ ] **Step 4: Add barrel export**

```typescript
export { resolveIdentityCluster } from "./person-identity-links";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/core exec vitest run test/resolve-identity-cluster.test.ts`
Expected: PASS (all three cases: collapse, single-family singleton, veto dissolve).

- [ ] **Step 6: Run the front-door invariant regression + full core suite**

Run: `pnpm --filter @chronicle/core test`
Expected: PASS — including `architecture.test.ts` (identity file allowlisted; content scan unaffected — identity links grant no content read).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/person-identity-links.ts packages/core/src/index.ts packages/core/test/resolve-identity-cluster.test.ts
git commit -m "feat(core): viewer-scoped identity cluster resolver with honor/deny/veto rules"
```

---

## Task 8: Matcher — pure `scoreMatch` + DB `findMatchCandidates` (scope b, precision-tuned)

**Files:**
- Create: `packages/core/src/person-match.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/person-match.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/person-match.test.ts
import { describe, expect, it } from "vitest";
import { scoreMatch, MATCH_THRESHOLD } from "../src/person-match";

const cand = (o: Partial<Parameters<typeof scoreMatch>[0]>) => ({
  displayName: "Eleanor Vance", birthYear: 1938, sharedKinCount: 0, ...o,
});
const target = (o: Partial<Parameters<typeof scoreMatch>[1]>) => ({
  displayName: "Eleanor Vance", birthYear: 1938, sharedKinCount: 0, ...o,
});

describe("scoreMatch (precision-tuned)", () => {
  it("name-only collision (no birth year, no shared kin) stays BELOW threshold", () => {
    const s = scoreMatch(cand({ birthYear: null }), target({ birthYear: null }));
    expect(s).toBeLessThan(MATCH_THRESHOLD);
  });

  it("name + matching birth year + a shared relative clears the threshold", () => {
    const s = scoreMatch(cand({ sharedKinCount: 1 }), target({ sharedKinCount: 1 }));
    expect(s).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("different birth years pull the score down", () => {
    const near = scoreMatch(cand({ birthYear: 1938 }), target({ birthYear: 1938 }));
    const far = scoreMatch(cand({ birthYear: 1938 }), target({ birthYear: 1975 }));
    expect(far).toBeLessThan(near);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/person-match.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `person-match.ts`**

```typescript
// packages/core/src/person-match.ts
// Pure person-matching for cross-family dedup (ADR-0019). Precision-tuned: err toward FEWER hints —
// a name-only collision must NOT fire; corroboration (birth year + shared derived kin) is required.
import { and, eq, inArray, ne } from "drizzle-orm";
import { persons, memberships } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import type { AuthContext } from "./authorization";

export interface MatchFeatures {
  displayName: string | null;
  birthYear: number | null;
  sharedKinCount: number;
}

/** Normalize a name for comparison: lowercase, collapse whitespace, drop punctuation. */
function normName(n: string | null): string {
  return (n ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Score in [0,1]. Weights chosen so name-alone < threshold and name + (birthYear match OR shared kin)
 * >= threshold. Tune against seed data; keep the threshold high (fewer, high-confidence hints).
 */
export function scoreMatch(candidate: MatchFeatures, target: MatchFeatures): number {
  const nameEq = normName(candidate.displayName) !== "" && normName(candidate.displayName) === normName(target.displayName);
  if (!nameEq) return 0; // name is a hard gate — never hint on a name mismatch

  let score = 0.5; // exact-name base (deliberately below threshold on its own)
  if (candidate.birthYear !== null && target.birthYear !== null) {
    const diff = Math.abs(candidate.birthYear - target.birthYear);
    if (diff === 0) score += 0.3;
    else if (diff <= 2) score += 0.15;
    else score -= 0.2; // clearly different person
  }
  if (candidate.sharedKinCount > 0) score += 0.25;
  return Math.max(0, Math.min(1, score));
}

export const MATCH_THRESHOLD = 0.75;

export interface MatchCandidate {
  personId: string;
  familyId: string;
  displayName: string | null;
  birthYear: number | null;
  score: number;
}

/**
 * Find likely duplicates of `target` across the UNION of families the adder belongs to (scope b).
 * Never searches outside the adder's families — no stranger disclosure. Returns only candidates at or
 * above MATCH_THRESHOLD, highest first. `sharedKinCount` wiring is left to the caller passing a
 * resolver; v1 may pass 0 (name + birth year still gate precision) and enrich later.
 */
export async function findMatchCandidates(
  db: Database,
  ctx: AuthContext,
  target: MatchFeatures & { excludePersonId?: string },
): Promise<MatchCandidate[]> {
  if (ctx.kind !== "account") return [];
  const myFamilies = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(and(eq(memberships.personId, ctx.personId), eq(memberships.status, "active")));
  const familyIds = myFamilies.map((m) => m.familyId);
  if (familyIds.length === 0) return [];

  // Persons who are members of any of my families (scope b). For a mention-only tree, extend this to
  // persons referenced by those families' kinship edges — deferred; v1 matches members + mentions
  // reachable via membership. Keep the query inside my families.
  const rows = await db
    .select({
      personId: persons.id, familyId: memberships.familyId,
      displayName: persons.displayName, birthYear: persons.birthYear,
    })
    .from(persons)
    .innerJoin(memberships, eq(memberships.personId, persons.id))
    .where(and(inArray(memberships.familyId, familyIds), eq(memberships.status, "active")));

  const out: MatchCandidate[] = [];
  for (const r of rows) {
    if (r.personId === target.excludePersonId) continue;
    const score = scoreMatch(
      { displayName: r.displayName, birthYear: r.birthYear, sharedKinCount: target.sharedKinCount },
      target,
    );
    if (score >= MATCH_THRESHOLD) {
      out.push({ personId: r.personId, familyId: r.familyId, displayName: r.displayName, birthYear: r.birthYear, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 4: Add barrel exports**

```typescript
export {
  scoreMatch, findMatchCandidates, MATCH_THRESHOLD,
  type MatchFeatures, type MatchCandidate,
} from "./person-match";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/core exec vitest run test/person-match.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/person-match.ts packages/core/src/index.ts packages/core/test/person-match.test.ts
git commit -m "feat(core): precision-tuned cross-family person matcher (scope b)"
```

---

## Task 9: Web — add-relative match hint (server action + inline hint UI)

Wire the matcher into the add-relative flow: when the user has typed a name (+ optional birth year), call a server action that returns candidates; render the inline amber hint with Yes / No / Not-sure.

**Files:**
- Locate first: `apps/web/app/hub/**` add-relative form/action (search for `addRelative`), and the tree add-modal from the shipped `/hub/tree` work.
- Create: `apps/web/app/hub/tree/actions/find-matches.ts` (server action) — path to match the existing actions dir.
- Create: `apps/web/app/hub/tree/_components/MatchHint.tsx`
- Test: `apps/web/test/find-matches-action.test.ts`

- [ ] **Step 1: Find the existing add-relative wiring**

Run: `pnpm exec grep -rn "addRelative" apps/web/app`
Expected: the server action + the add-relative modal component. Note their exact paths before writing — follow their `"use server"` / auth-context pattern (how they build `AuthContext` from the session).

- [ ] **Step 2: Write the failing test for the server action**

```typescript
// apps/web/test/find-matches-action.test.ts
import { describe, expect, it, vi } from "vitest";

// Mirror the auth/session mock used by other apps/web action tests (copy that setup).
import { findMatchesForAdd } from "../app/hub/tree/actions/find-matches";

describe("findMatchesForAdd", () => {
  it("returns [] when the typed name is blank", async () => {
    const res = await findMatchesForAdd({ displayName: "", birthYear: null, familyId: "fam" });
    expect(res).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run test/find-matches-action.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement the server action**

```typescript
// apps/web/app/hub/tree/actions/find-matches.ts
"use server";
import { findMatchCandidates } from "@chronicle/core";
// Reuse the project's existing session→AuthContext + db helpers (copy the imports the sibling
// actions in this dir already use, e.g. getDb(), requireAuthContext()).
import { getDb } from "@/lib/db";
import { requireAuthContext } from "@/lib/auth";

export interface FindMatchesInput { displayName: string; birthYear: number | null; familyId: string }

export async function findMatchesForAdd(input: FindMatchesInput) {
  const name = input.displayName.trim();
  if (!name) return [];
  const db = getDb();
  const ctx = await requireAuthContext();
  return findMatchCandidates(db, ctx, {
    displayName: name, birthYear: input.birthYear, sharedKinCount: 0,
  });
}
```

Adjust the `@/lib/...` imports to the actual helpers the neighboring actions use (confirm in Step 1).

- [ ] **Step 5: Implement the inline hint component**

```tsx
// apps/web/app/hub/tree/_components/MatchHint.tsx
"use client";
import type { MatchCandidate } from "@chronicle/core";

export function MatchHint({
  candidate, onLink, onAddNew, onNotSure,
}: {
  candidate: MatchCandidate;
  onLink: () => void;
  onAddNew: () => void;
  onNotSure: () => void;
}) {
  return (
    <div role="status" className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm">
      <p className="font-medium">Is this the same {candidate.displayName}?</p>
      <p className="opacity-75">
        Already in one of your families{candidate.birthYear ? ` · born ${candidate.birthYear}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onLink} className="btn-primary">Yes — same person, link them</button>
        <button type="button" onClick={onAddNew} className="btn-secondary">No — add as new</button>
        <button type="button" onClick={onNotSure} className="btn-ghost">Not sure — add new for now</button>
      </div>
    </div>
  );
}
```

Wire into the add-relative modal (found in Step 1): debounce the name/birth-year inputs, call `findMatchesForAdd`, render `<MatchHint>` for the top candidate. **Yes** → after the relative is created, call an `assertSameAs` server action linking the new person to `candidate.personId` (both families are the adder's, so the dual-member check passes). **No** → proceed normally. **Not sure** → create the relative and record a `suggested` link (a thin server action that inserts state `suggested` for later resolution). Match the modal's existing state/style conventions; use the project's button classes (replace the placeholder `btn-*` with the real ones seen in sibling components).

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm --filter @chronicle/web exec vitest run test/find-matches-action.test.ts && pnpm --filter @chronicle/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/hub/tree apps/web/test/find-matches-action.test.ts
git commit -m "feat(web): add-relative cross-family match hint (link/new/not-sure)"
```

---

## Task 10: Web — proactive join-time reconciliation offer

When a person joins a family, run the matcher against that family's existing people and, if a candidate matches the joiner, surface a gentle "is this you?" invitation that confirms via `assertSameAs`.

**Files:**
- Locate first: the join-acceptance path (`pnpm exec grep -rn "createJoinRequest\|acceptJoin\|join" apps/web/app packages/core/src`).
- Modify: the post-join redirect/landing to surface the offer (a banner/card component).
- Create: `apps/web/app/hub/_components/ReconcileOnJoin.tsx`
- Test: `apps/web/test/reconcile-on-join.test.ts` (server action returning the candidate, or `[]`).

- [ ] **Step 1: Find the join flow**

Run: `pnpm exec grep -rn "join" apps/web/app packages/core/src/index.ts`
Expected: the membership-creation point. Identify where control lands right after a membership becomes `active`.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/web/test/reconcile-on-join.test.ts
import { describe, expect, it } from "vitest";
import { findMyDepictionsInFamily } from "../app/hub/actions/reconcile-on-join";

describe("findMyDepictionsInFamily", () => {
  it("returns [] when the family has no matching mention of the joiner", async () => {
    const res = await findMyDepictionsInFamily({ familyId: "fam-with-no-match" });
    expect(res).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run test/reconcile-on-join.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement the server action**

```typescript
// apps/web/app/hub/actions/reconcile-on-join.ts
"use server";
import { findMatchCandidates } from "@chronicle/core";
import { getDb } from "@/lib/db";
import { requireAuthContext } from "@/lib/auth";
import { getPersonSelf } from "@/lib/person"; // the signed-in person's display name + birth year

/** After joining `familyId`, find people in it that look like ME (a proactive, gentle offer). */
export async function findMyDepictionsInFamily(input: { familyId: string }) {
  const db = getDb();
  const ctx = await requireAuthContext();
  const me = await getPersonSelf(ctx); // { id, displayName, birthYear }
  const candidates = await findMatchCandidates(db, ctx, {
    displayName: me.displayName, birthYear: me.birthYear, sharedKinCount: 0, excludePersonId: me.id,
  });
  // Only surface candidates that live in the just-joined family.
  return candidates.filter((c) => c.familyId === input.familyId);
}
```

Adjust `@/lib/*` helpers to the real ones. `getPersonSelf` may already exist under another name — reuse.

- [ ] **Step 5: Implement the gentle offer component**

```tsx
// apps/web/app/hub/_components/ReconcileOnJoin.tsx
"use client";
import type { MatchCandidate } from "@chronicle/core";

export function ReconcileOnJoin({
  candidate, familyName, onYes, onDismiss,
}: {
  candidate: MatchCandidate; familyName: string; onYes: () => void; onDismiss: () => void;
}) {
  return (
    <div role="status" className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="font-medium">Welcome to {familyName}.</p>
      <p className="mt-1 text-sm opacity-80">
        Their tree already includes someone who might be you{candidate.birthYear ? ` (born ${candidate.birthYear})` : ""}.
        Is this you?
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onYes} className="btn-primary">Yes, that’s me</button>
        <button type="button" onClick={onDismiss} className="btn-ghost">Not me</button>
      </div>
    </div>
  );
}
```

Render it once on the post-join hub landing when `findMyDepictionsInFamily` returns a candidate. **Yes** → `assertSameAs` linking my `self` person to `candidate.personId` (I am now a member of the joined family and remain a member of my own — dual-member check passes). Never block the join; it is an invitation, dismissible.

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm --filter @chronicle/web exec vitest run test/reconcile-on-join.test.ts && pnpm --filter @chronicle/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/hub apps/web/test/reconcile-on-join.test.ts
git commit -m "feat(web): proactive gentle join-time reconciliation offer"
```

---

## Task 11: Tree bridge badges (Option C) + combined-view story/avatar dedupe

Two consumers of `resolveIdentityCluster`, both **narrowing only** (never grant a story/edge the viewer couldn't already see).

**Files:**
- Locate first: the `/hub/tree` read (`resolveKinshipTree`) and `TreeCanvas`, and the stories-about read (`listStoriesAboutPerson`), and the combined/"All" scope hub feed.
- Modify: the tree read to attach an `alsoInFamilies` overlay per node from the cluster; `TreeCanvas` to render the "also in …" badge + tap-to-hop.
- Modify: the combined-scope stories-about + people/avatar reads to fold clusters (dedupe by representative).
- Test: `packages/core/test/stories-about-dedupe.test.ts` (pure fold), and a tree-overlay unit test.

- [ ] **Step 1: Write the failing test for combined stories-about dedupe (pure fold)**

```typescript
// packages/core/test/stories-about-dedupe.test.ts
import { describe, expect, it } from "vitest";
import { dedupeByCluster } from "../src/person-identity-links";

describe("dedupeByCluster", () => {
  it("collapses rows whose subject persons share a representative; keeps distinct ones", () => {
    const rep = new Map([["elA", "elA"], ["elB", "elA"], ["mary", "mary"]]);
    const rows = [
      { storyId: "s1", subjectPersonId: "elA" },
      { storyId: "s1", subjectPersonId: "elB" }, // same story, duplicated subject → one
      { storyId: "s2", subjectPersonId: "mary" },
    ];
    const out = dedupeByCluster(rows, rep, (r) => r.subjectPersonId, (r) => r.storyId);
    expect(out.map((r) => r.storyId).sort()).toEqual(["s1", "s2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/stories-about-dedupe.test.ts`
Expected: FAIL — `dedupeByCluster` not exported.

- [ ] **Step 3: Implement the pure fold helper in `person-identity-links.ts`**

```typescript
/**
 * Collapse rows so a person appearing under multiple clustered identities is counted once. `keyOf`
 * gives the person id to canonicalize; `dedupeKey` gives the row's dedupe identity (e.g. storyId).
 * Narrowing only — never adds rows the caller did not already fetch under authorization.
 */
export function dedupeByCluster<T>(
  rows: T[],
  representative: Map<string, string>,
  keyOf: (row: T) => string,
  dedupeKey: (row: T) => string,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const rep = representative.get(keyOf(row)) ?? keyOf(row);
    const k = `${dedupeKey(row)}|${rep}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}
```

Add `dedupeByCluster` to the barrel exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chronicle/core exec vitest run test/stories-about-dedupe.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the tree overlay**

In the `/hub/tree` read (after `resolveKinshipTree` builds the node set), call `resolveIdentityCluster(db, ctx, nodeIds)`; for each node whose representative cluster spans a family other than the currently-viewed one, attach `alsoInFamilies: string[]` (the other bridged families the viewer belongs to). In `TreeCanvas`, render an "also in {family} →" badge on such nodes; clicking navigates to that family's tree (set the scope + re-root on the clustered person). Keep the layout engine (`computeTreeLayout`) unchanged — the badge is an overlay only.

Add a focused unit test asserting the read attaches `alsoInFamilies` for a dual-member viewer and omits it for a single-family viewer (mirror the `resolve-identity-cluster` fixtures).

- [ ] **Step 6: Wire the combined-scope reads**

In the "All"/multi-family stories-about read and the people/avatar list used by combined scope: gather the subject person ids, call `resolveIdentityCluster`, then `dedupeByCluster` on the fetched rows and render the cluster representative's name/avatar. Single-family scope is unaffected (singletons). Confirm the story rows were already fetched under the existing authorized predicate — this step only removes duplicates, never adds.

- [ ] **Step 7: Run the full suite + typecheck across packages**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: PASS across all packages.

- [ ] **Step 8: Commit**

```bash
git add packages/core apps/web
git commit -m "feat: tree bridge badges + combined-view story/avatar dedupe (narrowing only)"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** table + triggers (T1–T3), guard subpath/allowlist (T3, T5), core surface assert/challenge/deny/veto/resolve (T5–T7), matcher scope-b precision (T8), add-hint UI (T9), proactive join offer (T10), tree Option-C badges + combined story/avatar dedupe (T11). Deferred items (Option B super-tree, deceased physical merge, GEDCOM import, `not_same_as`) are intentionally NOT tasks.
- **Open decisions to resolve in-flight:** (a) whether per-family "deny" reuses kinship governance or the dedicated `person_identity_link_denials` table — this plan chose the **dedicated table** (cleaner audit, no overload of kinship rows); (b) exact `scoreMatch` weights/threshold — start at `MATCH_THRESHOLD = 0.75` and tune against seed data; (c) enriching `sharedKinCount` in `findMatchCandidates` (v1 passes 0; name+birthYear still gate precision).
- **Type consistency:** `assertSameAs`/`challengeSameAs`/`denyForFamily`/`subjectVeto`/`resolveIdentityCluster`/`dedupeByCluster`/`clusterByLinks`/`scoreMatch`/`findMatchCandidates` names are used identically across tasks and barrel exports. `IdentityLink` (pure) vs `PersonIdentityLink` (db row) are distinct on purpose.
- **Invariant regressions to keep green:** append-only triggers (T2), architecture test with identity allowlist (T5), and the front-door "identity grants no content" guarantee (covered by the existing content scan staying unchanged — identity files import `@chronicle/db/identity`, never `@chronicle/db/content`).
