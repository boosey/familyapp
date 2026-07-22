# Notification stream prefs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and resolve a Person’s Notification stream frequencies (get/set + defaults), with no hub UI and no change to story-shared email recipients yet.

**Architecture:** Add public (non-content) domain enums + a Person×stream unique table in `@chronicle/db`, then a small audited get/set repository in `@chronicle/core` that resolves absent rows to `every_item`. Update `CONTEXT.md` so the glossary matches (`off` first-class; all three streams default every item). Do **not** touch `listStorySharedPingRecipients` or hub settings — those are #279 / #280.

**Tech Stack:** Drizzle + Postgres enums (PGlite in tests), TypeScript, Vitest, `@chronicle/db` / `@chronicle/core`.

**Issue:** [#278](https://github.com/boosey/familyapp/issues/278) (parent decisions: closed #272 / `.scratch/issue-272-spec.md` on main checkout).

---

## File structure

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema.ts` | `notificationStreamEnum`, `notificationFrequencyEnum`, `notificationStreamPrefs` table |
| `packages/db/src/schema-public.ts` | Re-export new table + enums on the open schema surface |
| `packages/db/src/index.ts` | Re-export inferred types |
| `packages/db/drizzle/*` | Generated snapshot + migration via `db:generate` |
| `packages/core/src/notification-prefs.ts` | get/set + default resolution |
| `packages/core/src/index.ts` | Public exports |
| `packages/core/test/notification-prefs.test.ts` | Behavior tests |
| `CONTEXT.md` | Glossary: `off` + all defaults every item |

---

### Task 1: Schema — enums, table, exports, migration

**Files:**
- Modify: `packages/db/src/schema.ts` (add enums + table near other Person-scoped prefs; add types at bottom)
- Modify: `packages/db/src/schema-public.ts`
- Modify: `packages/db/src/index.ts`
- Generate: `packages/db/drizzle/schema.sql`, `packages/db/drizzle/migrations/NNNN_*.sql`, meta

- [ ] **Step 1: Add enums + table to `schema.ts`**

Place after the `intakeOriginEnum` / `intakeAnswers` block (or immediately after intake revisions), before the next major section. Use snake_case enum values (repo convention: `story_audio`, `approved_for_sharing`).

```ts
/** Notification stream categories a Person can set a frequency for independently. */
export const notificationStreamEnum = pgEnum("notification_stream", [
  "questions_for_me",
  "answers_to_my_asks",
  "family_activity",
]);

/**
 * Per-stream delivery frequency. `daily_digest` / `weekly_digest` are in the vocabulary for
 * forward compatibility (#277); prefs UI v1 (#280) only offers every_item | off.
 */
export const notificationFrequencyEnum = pgEnum("notification_frequency", [
  "every_item",
  "daily_digest",
  "weekly_digest",
  "off",
]);

/**
 * Person-global Notification stream preference (not per-Family). Absent row ⇒ every_item
 * (resolved in @chronicle/core, not via a DB default on a missing row).
 */
export const notificationStreamPrefs = pgTable(
  "notification_stream_prefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    stream: notificationStreamEnum("stream").notNull(),
    frequency: notificationFrequencyEnum("frequency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_stream_prefs_person_idx").on(t.personId),
    uniqueIndex("notification_stream_prefs_person_stream_uq").on(t.personId, t.stream),
  ],
);
```

At the bottom of `schema.ts` with the other type aliases:

```ts
export type NotificationStream = (typeof notificationStreamEnum.enumValues)[number];
export type NotificationFrequency = (typeof notificationFrequencyEnum.enumValues)[number];
export type NotificationStreamPref = typeof notificationStreamPrefs.$inferSelect;
export type NewNotificationStreamPref = typeof notificationStreamPrefs.$inferInsert;
```

- [ ] **Step 2: Export from `schema-public.ts`**

Add `notificationStreamPrefs` to the table export list, and `notificationStreamEnum`, `notificationFrequencyEnum` to the enum export list.

- [ ] **Step 3: Export types from `packages/db/src/index.ts`**

Add to the `export type { ... } from "./schema"` block:

```ts
NotificationStream,
NotificationFrequency,
NotificationStreamPref,
NewNotificationStreamPref,
```

- [ ] **Step 4: Generate drizzle artifacts**

Run from worktree root:

```bash
pnpm --filter @chronicle/db db:generate
```

Expected: updates `drizzle/schema.sql`; emits a new `drizzle/migrations/NNNN_*.sql` creating the enum types + table + indexes. No hand-edit of `invariants.sql` (plain unique index is fully modeled).

- [ ] **Step 5: Verify package typechecks**

```bash
pnpm --filter @chronicle/db typecheck
pnpm --filter @chronicle/db exec vitest run test/migration-drift.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/schema-public.ts packages/db/src/index.ts packages/db/drizzle
git commit -m "$(cat <<'EOF'
feat(db): add notification stream prefs table and enums

Person × stream frequency storage for #278; daily/weekly values included for forward compatibility.
EOF
)"
```

---

### Task 2: Core repository — get/set + default resolution + tests

**Files:**
- Create: `packages/core/src/notification-prefs.ts`
- Create: `packages/core/test/notification-prefs.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/notification-prefs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { persons, notificationStreamPrefs } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import {
  DEFAULT_NOTIFICATION_FREQUENCY,
  NOTIFICATION_STREAMS,
  getNotificationStreamFrequency,
  setNotificationStreamFrequency,
  listNotificationStreamFrequencies,
} from "../src/notification-prefs";

async function seedPerson(db: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [p] = await db
    .insert(persons)
    .values({ spokenName: "Sofia", displayName: "Sofia", lifeStatus: "living" })
    .returning();
  return p!.id;
}

describe("notification-prefs", () => {
  it("resolves absent rows to every_item for each stream", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    for (const stream of NOTIFICATION_STREAMS) {
      expect(await getNotificationStreamFrequency(db, personId, stream)).toBe("every_item");
    }
    expect(await listNotificationStreamFrequencies(db, personId)).toEqual({
      questions_for_me: "every_item",
      answers_to_my_asks: "every_item",
      family_activity: "every_item",
    });
    expect(DEFAULT_NOTIFICATION_FREQUENCY).toBe("every_item");
  });

  it("set then get returns the written frequency, including off and digests", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await setNotificationStreamFrequency(db, personId, "family_activity", "off");
    expect(await getNotificationStreamFrequency(db, personId, "family_activity")).toBe("off");

    await setNotificationStreamFrequency(db, personId, "questions_for_me", "daily_digest");
    await setNotificationStreamFrequency(db, personId, "answers_to_my_asks", "weekly_digest");
    expect(await getNotificationStreamFrequency(db, personId, "questions_for_me")).toBe(
      "daily_digest",
    );
    expect(await getNotificationStreamFrequency(db, personId, "answers_to_my_asks")).toBe(
      "weekly_digest",
    );
  });

  it("set upserts: changing frequency updates the same person×stream row", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await setNotificationStreamFrequency(db, personId, "family_activity", "off");
    await setNotificationStreamFrequency(db, personId, "family_activity", "every_item");
    expect(await getNotificationStreamFrequency(db, personId, "family_activity")).toBe(
      "every_item",
    );
    const rows = await db
      .select()
      .from(notificationStreamPrefs)
      .where(eq(notificationStreamPrefs.personId, personId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.frequency).toBe("every_item");
  });

  it("list merges stored prefs with defaults for unset streams", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await setNotificationStreamFrequency(db, personId, "answers_to_my_asks", "off");
    expect(await listNotificationStreamFrequencies(db, personId)).toEqual({
      questions_for_me: "every_item",
      answers_to_my_asks: "off",
      family_activity: "every_item",
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @chronicle/core exec vitest run test/notification-prefs.test.ts
```

Expected: FAIL (module / exports missing).

- [ ] **Step 3: Implement `packages/core/src/notification-prefs.ts`**

```ts
/**
 * Person-global Notification stream preferences. Channel-agnostic (email/SMS later honor the
 * same frequency). Invites are outside streams. Absent row ⇒ every_item.
 */
import { and, eq } from "drizzle-orm";
import { notificationStreamPrefs } from "@chronicle/db/schema";
import type {
  Database,
  NotificationFrequency,
  NotificationStream,
  NotificationStreamPref,
} from "@chronicle/db";

export const NOTIFICATION_STREAMS = [
  "questions_for_me",
  "answers_to_my_asks",
  "family_activity",
] as const satisfies readonly NotificationStream[];

export const DEFAULT_NOTIFICATION_FREQUENCY: NotificationFrequency = "every_item";

/** Effective frequency for one stream (absent row → every_item). */
export async function getNotificationStreamFrequency(
  db: Database,
  personId: string,
  stream: NotificationStream,
): Promise<NotificationFrequency> {
  const [row] = await db
    .select({ frequency: notificationStreamPrefs.frequency })
    .from(notificationStreamPrefs)
    .where(
      and(
        eq(notificationStreamPrefs.personId, personId),
        eq(notificationStreamPrefs.stream, stream),
      ),
    )
    .limit(1);
  return row?.frequency ?? DEFAULT_NOTIFICATION_FREQUENCY;
}

/** Upsert Person × stream frequency. */
export async function setNotificationStreamFrequency(
  db: Database,
  personId: string,
  stream: NotificationStream,
  frequency: NotificationFrequency,
): Promise<NotificationStreamPref> {
  const [row] = await db
    .insert(notificationStreamPrefs)
    .values({ personId, stream, frequency })
    .onConflictDoUpdate({
      target: [notificationStreamPrefs.personId, notificationStreamPrefs.stream],
      set: { frequency, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

/** All three streams with defaults filled for any missing rows. */
export async function listNotificationStreamFrequencies(
  db: Database,
  personId: string,
): Promise<Record<NotificationStream, NotificationFrequency>> {
  const rows = await db
    .select({
      stream: notificationStreamPrefs.stream,
      frequency: notificationStreamPrefs.frequency,
    })
    .from(notificationStreamPrefs)
    .where(eq(notificationStreamPrefs.personId, personId));

  const result = {
    questions_for_me: DEFAULT_NOTIFICATION_FREQUENCY,
    answers_to_my_asks: DEFAULT_NOTIFICATION_FREQUENCY,
    family_activity: DEFAULT_NOTIFICATION_FREQUENCY,
  } satisfies Record<NotificationStream, NotificationFrequency>;

  for (const row of rows) {
    result[row.stream] = row.frequency;
  }
  return result;
}
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

Add near the story-shared-pings / notifications-adjacent exports:

```ts
export {
  DEFAULT_NOTIFICATION_FREQUENCY,
  NOTIFICATION_STREAMS,
  getNotificationStreamFrequency,
  setNotificationStreamFrequency,
  listNotificationStreamFrequencies,
} from "./notification-prefs";
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter @chronicle/core exec vitest run test/notification-prefs.test.ts
pnpm --filter @chronicle/core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/notification-prefs.ts packages/core/test/notification-prefs.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): get/set notification stream frequencies with defaults

Absent Person × stream rows resolve to every_item; vocabulary includes off and digests.
EOF
)"
```

---

### Task 3: CONTEXT.md glossary alignment

**Files:**
- Modify: `CONTEXT.md` (Notification stream bullet under Engagement & notification)

- [ ] **Step 1: Update the Notification stream definition**

Replace the existing bullet so it matches #278 / #272 decisions:

```markdown
- **Notification stream** — a category of Notification a Person sets a frequency for independently
  (`every item` | `daily digest` | `weekly digest` | `off`). Three streams: **questions-for-me**,
  **answers-to-my-asks**, and **family activity** — all default to `every item` (absent preference
  means every item; `off` is first-class silence for that stream). One event may feed two streams
  (an answered Ask rewards the asker *and* enters everyone else's family-activity digest),
  de-duplicated so no one is told twice.
```

Do **not** change other Engagement bullets unless they contradict (they should not).

- [ ] **Step 2: Commit**

```bash
git add CONTEXT.md
git commit -m "$(cat <<'EOF'
docs: align Notification stream glossary with prefs defaults and off

All three streams default to every item; off is a first-class frequency (#278).
EOF
)"
```

---

## Out of scope (do not implement)

- Filtering `listStorySharedPingRecipients` by prefs (#279)
- Hub settings Notifications UI (#280)
- Digest assembly (#277)
- questions-for-me outbound (#276)
- Per-Family prefs, global mute, invite gating

## Self-review checklist

1. **Spec coverage:** AC1 get/set → Task 2; AC2 absent → default → Task 2 tests; AC3 vocabulary incl. off → Task 1 enums + Task 2 tests; AC4 CONTEXT → Task 3; AC5 tests → Task 2.
2. **No placeholders** in steps.
3. **Type consistency:** `NotificationStream` / `NotificationFrequency` / snake_case enum values used everywhere; glossary keeps human phrasing (`every item`, `questions-for-me`) while code uses snake_case.
