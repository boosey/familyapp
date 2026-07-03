# Direct Story Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person create a Story on their own initiative ("tell a story" without being asked), by voice or typed text, with an AI-generated-then-editable title — reusing the existing answer flow as one generalized composer.

**Architecture:** Implements the already-Accepted ADR-0007 (stories are origin-typed `voice | text`; audio is canonical only when present). Typed text is treated exactly like a transcript and goes through the same `render_story` stage; text stories skip only `transcribe`. The `/hub/answer/[askId]` capture/review UI is generalized into a `StoryComposer` parameterized by an optional ask, and a new `/hub/tell` route renders it with no ask. The AI-polish seam (from `95f0014`) folds into the shared review editor for both origins.

**Tech Stack:** TypeScript ESM monorepo (pnpm workspaces), Drizzle + PGlite (in-process Postgres for tests), Vitest, Next.js 15 / React 19. Schema uses the reseed workflow (no incremental migrations): edit `schema.ts` → `db:generate` regenerates `drizzle/schema.sql`; CHECK constraints/triggers are hand-maintained in `drizzle/invariants.sql`; the PGlite test helper applies both.

**Spec:** `docs/superpowers/specs/2026-07-02-direct-story-creation-design.md`

**Conventions for every task below:**
- TDD: write the failing test, run it red, implement minimal, run it green, commit.
- Run a single package's tests with `pnpm --filter <pkg> exec vitest run <path>` and a single test with `-t "<name>"`.
- Commit messages end with the repo's `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer (omitted from the snippets below for brevity — add it).
- Per the repo rule, any bug found mid-implementation gets a companion regression test.

---

## Phase A — Foundation (shared contract; lands and is green before Phase B)

### Task 1: Schema — `story_kind`, nullable recording pointer, `user_authored` provenance level

**Files:**
- Modify: `packages/db/src/schema.ts` (enums near line 138; `stories` table 381-438)
- Generate: `packages/db/drizzle/schema.sql` (via `db:generate` — do not hand-edit)
- Test: `packages/db/test/story-kind.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/story-kind.test.ts`. Use the existing PGlite test helper (see any file in `packages/db/test/` for the exact import — commonly `createTestDb` from `../src/testing`). This test asserts the column and enum values exist and default correctly.

```ts
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "../src/testing";

describe("stories.kind (ADR-0007)", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => { await teardown?.(); });

  it("has a story_kind enum with 'voice' and 'text'", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const rows = await db.execute(sql`
      SELECT unnest(enum_range(NULL::story_kind))::text AS v ORDER BY v
    `);
    const values = (rows.rows as Array<{ v: string }>).map((r) => r.v);
    expect(values).toEqual(["text", "voice"]);
  });

  it("prose_revision_level includes 'user_authored'", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const rows = await db.execute(sql`
      SELECT unnest(enum_range(NULL::prose_revision_level))::text AS v
    `);
    const values = (rows.rows as Array<{ v: string }>).map((r) => r.v);
    expect(values).toContain("user_authored");
  });
});
```

> If `createTestDb`'s exact name/shape differs, copy the setup from an existing `packages/db/test/*.test.ts` file verbatim — do not invent a new harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/db exec vitest run test/story-kind.test.ts`
Expected: FAIL — `type "story_kind" does not exist` and `user_authored` missing.

- [ ] **Step 3: Edit `schema.ts`**

Add the `story_kind` enum next to the other enums (after `joinRequestStatusEnum`, ~line 132):

```ts
/** ADR-0007: a Story is origin-typed. `voice` has a canonical audio recording; `text` is typed
 * (the words are canonical, no recording). Audio is the source of truth ONLY when present. */
export const storyKindEnum = pgEnum("story_kind", ["voice", "text"]);
```

Add `"user_authored"` to `proseRevisionLevelEnum` (line 138). Order matters for provenance readability (oldest → newest); place it FIRST since a typed story's L1 source predates any AI step:

```ts
export const proseRevisionLevelEnum = pgEnum("prose_revision_level", [
  "user_authored",
  "ai_transcribed",
  "ai_polished",
  "human_corrected",
  "ai_verified",
]);
```

In the `stories` table (line 381), add the `kind` column and make `recordingMediaId` nullable:

```ts
    state: storyStateEnum("state").notNull().default("draft"),
    /** ADR-0007: origin type. voice ⇒ has a canonical recording; text ⇒ typed, no recording. */
    kind: storyKindEnum("kind").notNull().default("voice"),
    audienceTier: audienceTierEnum("audience_tier").notNull().default("private"),
    /**
     * The canonical Recording (original audio). Present iff kind = 'voice' (ADR-0007; enforced by a
     * DB CHECK in invariants.sql). Media is created first, then the Story points at it.
     */
    recordingMediaId: uuid("recording_media_id").references(() => media.id),
```

(Remove the `.notNull()` from `recordingMediaId` — keep the `.references(...)`.)

- [ ] **Step 4: Regenerate the SQL**

Run: `pnpm --filter @chronicle/db db:generate`
Expected: `drizzle/schema.sql` now contains `CREATE TYPE "public"."story_kind"`, `"kind" "story_kind" DEFAULT 'voice' NOT NULL`, `"recording_media_id" uuid` (no `NOT NULL`), and `user_authored` in the `prose_revision_level` enum. Review the diff.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/db exec vitest run test/story-kind.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/schema.sql packages/db/test/story-kind.test.ts
git commit -m "feat(db): add story_kind + user_authored level; recording pointer nullable (ADR-0007)"
```

---

### Task 2: CHECK constraints — kind ⇔ recording pointer invariant

**Files:**
- Modify: `packages/db/drizzle/invariants.sql` (add a CHECK section)
- Test: `packages/db/test/story-kind-check.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "../src/testing";

// A minimal owner Person to satisfy the FK. Copy the person-insert idiom from an existing
// db test if the column set differs.
async function seedPerson(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO persons (display_name) VALUES ('Owner') RETURNING id
  `);
  return (rows.rows[0] as { id: string }).id;
}

describe("stories kind ⇔ recording CHECK (ADR-0007)", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => { await teardown?.(); });

  it("rejects a voice story with no recording", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const owner = await seedPerson(db);
    await expect(
      db.execute(sql`
        INSERT INTO stories (owner_person_id, kind, recording_media_id)
        VALUES (${owner}, 'voice', NULL)
      `),
    ).rejects.toThrow();
  });

  it("rejects a text story that carries a recording", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const owner = await seedPerson(db);
    const media = await db.execute(sql`
      INSERT INTO media (owner_person_id, kind, storage_key, content_type, checksum)
      VALUES (${owner}, 'story_audio', 'k', 'audio/webm', 'sha256:x') RETURNING id
    `);
    const mediaId = (media.rows[0] as { id: string }).id;
    await expect(
      db.execute(sql`
        INSERT INTO stories (owner_person_id, kind, recording_media_id)
        VALUES (${owner}, 'text', ${mediaId})
      `),
    ).rejects.toThrow();
  });

  it("accepts a text story with no recording", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const owner = await seedPerson(db);
    const res = await db.execute(sql`
      INSERT INTO stories (owner_person_id, kind, recording_media_id, transcript)
      VALUES (${owner}, 'text', NULL, 'typed words') RETURNING id
    `);
    expect((res.rows[0] as { id: string }).id).toBeTruthy();
  });
});
```

> If `persons`/`media` insert column names differ, copy the exact insert from an existing db test. The point of the test is the three CHECK outcomes, not the seed idiom.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/db exec vitest run test/story-kind-check.test.ts`
Expected: FAIL — the voice-without-recording and text-with-recording inserts currently succeed (no CHECK yet), so those `rejects.toThrow()` assertions fail.

- [ ] **Step 3: Add the CHECK to `invariants.sql`**

Append after the story-recording pointer trigger block (after line 134), before the section-(2) memberships index:

```sql
-- ---------------------------------------------------------------------------
-- (1e) ADR-0007: a Story is origin-typed. A 'voice' story MUST have a canonical recording; a
--      'text' story MUST NOT. drizzle-kit does not model CHECK constraints, so it lives here.
-- ---------------------------------------------------------------------------
ALTER TABLE stories ADD CONSTRAINT stories_kind_recording_ck CHECK (
  (kind = 'voice' AND recording_media_id IS NOT NULL) OR
  (kind = 'text'  AND recording_media_id IS NULL)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chronicle/db exec vitest run test/story-kind-check.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Run the full db suite (guard the existing invariants)**

Run: `pnpm --filter @chronicle/db test`
Expected: PASS — existing voice-story seeds still insert a recording, so the new CHECK doesn't break them.

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle/invariants.sql packages/db/test/story-kind-check.test.ts
git commit -m "feat(db): CHECK that kind='voice' iff recording present (ADR-0007)"
```

---

### Task 3: Core — `createTextDraft` + `insertDraftRow` refactor

**Files:**
- Modify: `packages/core/src/story-repository.ts` (`persistRecordingAndCreateDraft` 77-119; add `createTextDraft`)
- Modify: `packages/core/src/index.ts` (export `createTextDraft`, `TextDraftInput`)
- Test: `packages/core/test/text-draft.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@chronicle/db/testing";
import { stories, proseRevisions } from "@chronicle/db/content";
import { createTextDraft, InvariantViolation } from "../src/index";
import { seedPerson } from "./helpers"; // reuse the existing core test helper; copy the idiom used elsewhere

describe("createTextDraft (ADR-0007 text origin)", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => { await teardown?.(); });

  it("creates a kind='text' draft with the typed words in transcript, no recording, and a user_authored L1", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const owner = await seedPerson(db);

    const { story } = await createTextDraft(db, {
      ownerPersonId: owner,
      text: "The summer we moved to Naples.",
    });

    expect(story.kind).toBe("text");
    expect(story.recordingMediaId).toBeNull();
    expect(story.state).toBe("draft");
    expect(story.audienceTier).toBe("private");
    expect(story.transcript).toBe("The summer we moved to Naples.");
    expect(story.prose).toBeNull(); // render fills prose, not create

    const revs = await db.select().from(proseRevisions).where(eq(proseRevisions.storyId, story.id));
    expect(revs.map((r) => r.level)).toEqual(["user_authored"]);
    expect(revs[0]!.text).toBe("The summer we moved to Naples.");
  });

  it("rejects empty/whitespace text", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const owner = await seedPerson(db);
    await expect(createTextDraft(db, { ownerPersonId: owner, text: "   " }))
      .rejects.toBeInstanceOf(InvariantViolation);
  });

  it("does NOT seed a story_recordings row for a text story", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const owner = await seedPerson(db);
    const { story } = await createTextDraft(db, { ownerPersonId: owner, text: "hi" });
    const rows = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(rows).toHaveLength(1);
    // story_recordings is queried via the audited path elsewhere; asserting no throw + kind text is enough here.
  });
});
```

> Use the same person-seed helper the other core tests use (grep `packages/core/test` for `seedPerson` or the inline insert). If none is exported, inline the person insert as the sibling tests do.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/text-draft.test.ts`
Expected: FAIL — `createTextDraft` is not exported.

- [ ] **Step 3: Implement `createTextDraft` + refactor the shared insert**

In `packages/core/src/story-repository.ts`, refactor `persistRecordingAndCreateDraft` to share a private insert and add `createTextDraft`. Add after the `DraftStoryInput` interface:

```ts
export interface TextDraftInput {
  ownerPersonId: string;
  /** The typed words — canonical for a text story. Must be non-empty. */
  text: string;
  promptQuestion?: string;
  askId?: string;
  originatingFamilyId?: string;
}

export interface CreatedTextDraft {
  story: Story;
}

/**
 * Create a TEXT-origin draft Story (ADR-0007): the typed words are canonical, there is no
 * recording. The words go into `transcript` (the render stage will produce `prose`/`title` from
 * them, exactly as it does for a voice transcript). A `user_authored` L1 prose-revision records
 * the source text. No `media` row and no `story_recordings` row are created.
 */
export async function createTextDraft(
  db: Database,
  input: TextDraftInput,
): Promise<CreatedTextDraft> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new InvariantViolation("a text story must have non-empty words");
  }
  return db.transaction(async (tx) => {
    const [story] = await tx
      .insert(stories)
      .values({
        ownerPersonId: input.ownerPersonId,
        kind: "text",
        recordingMediaId: null,
        state: "draft",
        audienceTier: "private",
        transcript: text,
        promptQuestion: input.promptQuestion ?? null,
        askId: input.askId ?? null,
        originatingFamilyId: input.originatingFamilyId ?? null,
      })
      .returning();

    // L1 source provenance for a typed story: the human-authored analog of ai_transcribed.
    await tx.insert(proseRevisions).values({
      storyId: story!.id,
      level: "user_authored",
      text,
      modelId: null,
      promptText: null,
      actorPersonId: input.ownerPersonId,
    });

    return { story: story! };
  });
}
```

In `persistRecordingAndCreateDraft`, set `kind: "voice"` explicitly in the `stories` insert values (line 97-105 block):

```ts
      .values({
        ownerPersonId: recording.ownerPersonId,
        kind: "voice",
        recordingMediaId: rec!.id,
        state: "draft",
        audienceTier: "private",
        promptQuestion: draft.promptQuestion ?? null,
        askId: draft.askId ?? null,
        originatingFamilyId: draft.originatingFamilyId ?? null,
      })
```

Ensure `proseRevisions` is imported in this file (it already imports from `@chronicle/db` for `appendProseRevision`; add `proseRevisions` to the content import if `appendProseRevision` uses it — check the existing import block near line 30-41 and match it).

- [ ] **Step 4: Export from the core index**

In `packages/core/src/index.ts`, add `createTextDraft` and the two types to the existing `story-repository` re-export block (near the `listOutstandingAnswerDrafts` export, line ~40).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/core exec vitest run test/text-draft.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the architecture test (allowlist guard)**

Run: `pnpm --filter @chronicle/core exec vitest run test/architecture.test.ts`
Expected: PASS — `story-repository.ts` is already on the allowlist; no new file touches content tables.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/src/index.ts packages/core/test/text-draft.test.ts
git commit -m "feat(core): createTextDraft — text-origin draft with user_authored L1 (ADR-0007)"
```

---

### Task 4: Core — generalize `listOutstandingAnswerDrafts` → `listOutstandingDrafts`

**Files:**
- Modify: `packages/core/src/story-repository.ts` (657-684)
- Modify: `packages/core/src/index.ts` (export the new function + type)
- Test: `packages/core/test/outstanding-answers.test.ts` (extend) and `packages/core/test/outstanding-drafts.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/outstanding-drafts.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@chronicle/db/testing";
import { createTextDraft, listOutstandingDrafts, transitionStoryState } from "../src/index";
import { seedPerson } from "./helpers";

describe("listOutstandingDrafts", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => { await teardown?.(); });

  it("returns self-initiated (askId=null) pending_approval drafts, with kind", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const owner = await seedPerson(db);
    const { story } = await createTextDraft(db, { ownerPersonId: owner, text: "a memory" });
    await transitionStoryState(db, story.id, "pending_approval");

    const drafts = await listOutstandingDrafts(db, owner);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.storyId).toBe(story.id);
    expect(drafts[0]!.askId).toBeNull();
    expect(drafts[0]!.kind).toBe("text");
  });

  it("excludes drafts still in 'draft' state", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const owner = await seedPerson(db);
    await createTextDraft(db, { ownerPersonId: owner, text: "not yet rendered" });
    const drafts = await listOutstandingDrafts(db, owner);
    expect(drafts).toHaveLength(0);
  });
});
```

Add a case to `packages/core/test/outstanding-answers.test.ts` asserting the wrapper still filters to ask-backed only (a self-initiated draft does NOT appear in `listOutstandingAnswerDrafts`):

```ts
it("omits self-initiated (askId=null) drafts", async () => {
  // ... seed a text draft, transition to pending_approval ...
  const results = await listOutstandingAnswerDrafts(db, narrator.id);
  expect(results.find((r) => r.storyId === textStoryId)).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/outstanding-drafts.test.ts`
Expected: FAIL — `listOutstandingDrafts` not exported.

- [ ] **Step 3: Implement the generalization**

Replace the `listOutstandingAnswerDrafts` block (657-684) with a general function + a thin wrapper. Note the `kind` column is now selectable:

```ts
export interface OutstandingDraft {
  storyId: string;
  /** The Ask this answers, or null for a self-initiated telling. */
  askId: string | null;
  kind: "voice" | "text";
  recordedAt: Date;
}

/**
 * All of a person's `pending_approval` drafts — ask-backed AND self-initiated. The Stories tab
 * resumes self-initiated drafts from here; `listOutstandingAnswerDrafts` (below) is the ask-only
 * view the Questions tab uses.
 */
export async function listOutstandingDrafts(
  db: Database,
  personId: string,
): Promise<OutstandingDraft[]> {
  const rows = await db
    .select({
      askId: stories.askId,
      storyId: stories.id,
      kind: stories.kind,
      recordedAt: stories.createdAt,
    })
    .from(stories)
    .where(and(eq(stories.ownerPersonId, personId), eq(stories.state, "pending_approval")));
  return rows
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
    .map((r) => ({ storyId: r.storyId, askId: r.askId, kind: r.kind, recordedAt: r.recordedAt }));
}

export interface OutstandingAnswerDraft {
  askId: string;
  storyId: string;
  recordedAt: Date;
}

/** Ask-backed subset, one draft per ask (latest take). Unchanged behavior for the Questions tab. */
export async function listOutstandingAnswerDrafts(
  db: Database,
  narratorPersonId: string,
): Promise<OutstandingAnswerDraft[]> {
  const all = await listOutstandingDrafts(db, narratorPersonId);
  const byAsk = new Map<string, OutstandingAnswerDraft>();
  for (const r of all) {
    if (r.askId === null) continue;
    if (!byAsk.has(r.askId)) {
      byAsk.set(r.askId, { askId: r.askId, storyId: r.storyId, recordedAt: r.recordedAt });
    }
  }
  return [...byAsk.values()];
}
```

(`all` is already sorted most-recent-first, so "latest take per ask" is preserved. Keep the existing `OutstandingAnswerDraft` interface if it is defined elsewhere — reconcile, don't duplicate.)

- [ ] **Step 4: Export `listOutstandingDrafts` + `OutstandingDraft`**

Add to `packages/core/src/index.ts`.

- [ ] **Step 5: Run both tests green**

Run: `pnpm --filter @chronicle/core exec vitest run test/outstanding-drafts.test.ts test/outstanding-answers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/src/index.ts packages/core/test/outstanding-drafts.test.ts packages/core/test/outstanding-answers.test.ts
git commit -m "feat(core): listOutstandingDrafts (ask-backed + self-initiated); wrapper preserves Questions tab"
```

---

### Task 5: Capture — `ingestTextStory`

**Files:**
- Modify: `packages/capture/src/capture.ts` (add after `ingestRecording`, ~line 113)
- Modify: `packages/capture/src/index.ts` (export)
- Test: `packages/capture/test/ingest-text-story.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@chronicle/db/testing";
import { stories } from "@chronicle/db/content";
import { ingestTextStory } from "../src/index";
import { seedPerson } from "./helpers"; // match the capture-test person-seed idiom

describe("ingestTextStory (account actor)", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => { await teardown?.(); });

  it("creates a text draft owned by the account person, no storage write", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const person = await seedPerson(db);

    const result = await ingestTextStory(db, {
      actor: { kind: "account", personId: person },
      text: "A story I want to tell.",
    });

    const [row] = await db.select().from(stories).where(eq(stories.id, result.storyId));
    expect(row!.kind).toBe("text");
    expect(row!.ownerPersonId).toBe(person);
    expect(row!.recordingMediaId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chronicle/capture exec vitest run test/ingest-text-story.test.ts`
Expected: FAIL — `ingestTextStory` not exported.

- [ ] **Step 3: Implement `ingestTextStory`**

In `packages/capture/src/capture.ts`, add the import and the function. Note it takes NO `storage` arg (no bytes to persist):

```ts
import { createTextDraft, persistRecordingAndCreateDraft, persistTakeRecording } from "@chronicle/core";
```

```ts
export interface IngestTextStoryInput {
  actor: CaptureActor;
  /** The typed words — canonical for a text story. */
  text: string;
  promptQuestion?: string;
  askId?: string;
  now?: Date;
}

export interface IngestTextResult {
  storyId: string;
}

/**
 * Text-origin sibling of `ingestRecording` (ADR-0007). No object storage — there are no audio
 * bytes. Resolves WHO is capturing exactly like the voice path, then writes a text draft via the
 * audited core write. The pipeline (start-at-render for text stories) turns the typed text into
 * prose/title just as it does a voice transcript.
 */
export async function ingestTextStory(
  db: Database,
  input: IngestTextStoryInput,
): Promise<IngestTextResult> {
  const resolved = await resolveCaptureActor(db, input.actor, { now: input.now });
  const { story } = await createTextDraft(db, {
    ownerPersonId: resolved.personId,
    text: input.text,
    ...(input.promptQuestion !== undefined ? { promptQuestion: input.promptQuestion } : {}),
    ...(input.askId !== undefined ? { askId: input.askId } : {}),
    ...(resolved.originatingFamilyId ? { originatingFamilyId: resolved.originatingFamilyId } : {}),
  });
  return { storyId: story.id };
}
```

- [ ] **Step 4: Export**

Add `ingestTextStory` (+ its input/result types) to `packages/capture/src/index.ts`.

- [ ] **Step 5: Run green**

Run: `pnpm --filter @chronicle/capture exec vitest run test/ingest-text-story.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/capture/src/capture.ts packages/capture/src/index.ts packages/capture/test/ingest-text-story.test.ts
git commit -m "feat(capture): ingestTextStory — text-origin story, no storage write (ADR-0007)"
```

---

### Task 6: Pipeline — `start()` routes text stories straight to `render_story`

**Files:**
- Modify: `packages/pipeline/src/orchestrator.ts` (`start` at 286-289; add a kind read)
- Modify: `packages/core/src/pipeline.ts` (the `getStoryAndRecordingForPipeline` view — confirm it exposes `kind`; add if missing) OR add a tiny `getStoryKindForPipeline`
- Test: `packages/pipeline/test/text-story-pipeline.test.ts` (create)

- [ ] **Step 1: Confirm the pipeline view exposes `kind` AND tolerates a null recording**

Read `packages/core/src/pipeline.ts` (the `@chronicle/core/pipeline` subpath, on the allowlist). Two required changes:
1. Add `kind: stories.kind` to the view's select and its return type (both `start()` and the transcribe guard need it).
2. **Critical:** if the view joins `media` via an INNER join, a text story (null `recording_media_id`) returns `null` — the render stage would then log "story gone" and silently skip. Change the join to a **LEFT join** so a text story still returns a view, with `recording` being `null`. The transcribe stage never runs for text (Step 4 guards it), and the render stage does not read `recording`, so a null recording there is fine. Add a pipeline test asserting `getStoryAndRecordingForPipeline` returns a non-null view (with `kind:'text'`, `recording:null`) for a text draft.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@chronicle/db/testing";
import { createTextDraft, getStoryForViewer } from "@chronicle/core";
import { createPipeline } from "../src/orchestrator";
import { MockTranscriber, MockLanguageModel } from "../src/mocks"; // match the exact mock names in mocks.ts
import { InMemoryStorage } from "@chronicle/storage";
import { seedPerson } from "./helpers";

describe("text-origin pipeline", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => { await teardown?.(); });

  it("skips transcribe, renders from typed text, reaches pending_approval — transcriber never called", async () => {
    const { db, close } = await createTestDb();
    teardown = close;
    const owner = await seedPerson(db);
    const { story } = await createTextDraft(db, { ownerPersonId: owner, text: "We drove to the coast." });

    let transcribeCalls = 0;
    const transcriber = new MockTranscriber(() => { transcribeCalls++; return { text: "SHOULD NOT RUN", words: [], modelId: "m" }; });
    const languageModel = new MockLanguageModel(/* returns valid render JSON — copy from pipeline.test.ts */);
    const storage = new InMemoryStorage();

    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await pipeline.start(story.id);
    await pipeline.runToCompletion();

    expect(transcribeCalls).toBe(0);
    const owned = await getStoryForViewerForOwner(db, owner, story.id); // owner can read any state; use the existing helper
    expect(owned!.state).toBe("pending_approval");
    expect(owned!.prose).toBeTruthy();
  });
});
```

> Copy the exact mock construction and the valid render-JSON shape from `packages/pipeline/test/pipeline.test.ts` (it already drives `render_story` with a mock LM). Use whatever owner-scoped read the existing pipeline tests use to assert `state`/`prose`.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @chronicle/pipeline exec vitest run test/text-story-pipeline.test.ts`
Expected: FAIL — `start()` enqueues `transcribe`, which throws `canonical recording missing from storage` for a text story (recording is null).

- [ ] **Step 4: Branch `start()` on kind**

In `orchestrator.ts`, change `start` (286-289) to read the story kind and enqueue the right first stage:

```ts
    async start(storyId: string) {
      const view = await getStoryAndRecordingForPipeline(deps.db, storyId);
      const firstStage: JobName = view?.kind === "text" ? "render_story" : "transcribe";
      plog("pipeline", `start → enqueue ${firstStage}`, { story: storyId, kind: view?.kind });
      await queue.enqueue(firstStage, { storyId });
    },
```

Guard the transcribe stage too (defense in depth): at the top of `runTranscribeStage`, after loading `view`, if `view.kind === "text"` skip to render:

```ts
    if (view.kind === "text") {
      plog("pipeline", "transcribe: skip (text story) → enqueue render_story", { story: view.storyId });
      await queue.enqueue("render_story", { storyId: view.storyId });
      return;
    }
```

The render stage already reads `view.transcript` (the typed text) and produces prose/title → `pending_approval`; no change needed there. `promptQuestion` is null for `/hub/tell` stories and is already optional in `renderStoryFromTranscript`.

- [ ] **Step 5: Run green**

Run: `pnpm --filter @chronicle/pipeline exec vitest run test/text-story-pipeline.test.ts`
Expected: PASS — `transcribeCalls === 0`, `state === "pending_approval"`, prose populated.

- [ ] **Step 6: Run the full pipeline suite (guard voice path)**

Run: `pnpm --filter @chronicle/pipeline test`
Expected: PASS — voice stories still enqueue `transcribe` first.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline/src/orchestrator.ts packages/core/src/pipeline.ts packages/pipeline/test/text-story-pipeline.test.ts
git commit -m "feat(pipeline): text stories skip transcribe, render from typed text (ADR-0007)"
```

---

### Phase A gate

- [ ] Run the whole workspace: `pnpm -r typecheck && pnpm -r test`. Expected: green. Do not start Phase B until this passes — Phase B builds on this shared contract.

---

## Phase B — Web surfaces

### Task 7: Generalized `composeStoryAction` (voice OR text; ask-optional)

**Files:**
- Modify: `apps/web/app/hub/answer/[askId]/actions.ts` (add `composeStoryAction`; keep `recordAnswerAction` as a thin wrapper for now)
- Test: `apps/web/__tests__/compose-story-action.server.test.ts` (create)

**Design:** `composeStoryAction` generalizes `recordAnswerAction`. It reads the account session, then branches on the form payload: an `audio` Blob → voice path (`ingestRecording` + follow-up/dispatch, exactly as `recordAnswerAction`); a `text` string → text path (`ingestTextStory` + `dispatchPipeline`). `askId` is OPTIONAL — when present the Ask target/status validation runs (as today); when absent it's a self-initiated telling. Returns the existing `ThreadStep`.

- [ ] **Step 1: Write the failing test**

Model it on `apps/web/__tests__/answer-follow-up-loop.server.test.ts` (which drives actions against a hand-built runtime). Two cases: (a) a text submission with no `askId` creates a `kind='text'` story and resolves to `{ kind: "ready", storyId }` with the story at `pending_approval`; (b) an empty `text` returns `{ error }` and creates nothing.

```ts
// ... build runtime (db, storage, languageModel, transcriber, dispatchPipeline) as the sibling test does ...
it("text telling with no ask → ready, story is text + pending_approval", async () => {
  const form = new FormData();
  form.set("text", "The day the river froze.");
  const step = await composeStoryAction(form); // relies on the test's auth stub returning an account ctx
  expect("kind" in step && step.kind).toBe("ready");
  // assert the created story is kind='text' and pending_approval via an owner read
});

it("empty text → error, nothing created", async () => {
  const form = new FormData();
  form.set("text", "   ");
  const step = await composeStoryAction(form);
  expect("error" in step).toBe(true);
});
```

> Auth stubbing: match how the sibling server tests inject an account `getCurrentAuthContext`. If they use the real `getRuntime()` singleton with a mock auth env, follow that exact pattern rather than inventing a new seam.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/compose-story-action.server.test.ts`
Expected: FAIL — `composeStoryAction` not exported.

- [ ] **Step 3: Implement `composeStoryAction`**

Add to `actions.ts`. Import `ingestTextStory` from `@chronicle/capture`. Reuse the existing ask-validation and voice ingest logic by extracting the voice body of `recordAnswerAction` — or, minimally, implement the text branch and delegate the voice branch to the existing `recordAnswerAction` internals.

```ts
export async function composeStoryAction(formData: FormData): Promise<ThreadStep> {
  beginLogContext();
  const rt = await getRuntime();
  const { db, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const askIdField = formData.get("askId");
  const askId = typeof askIdField === "string" && askIdField.length > 0 ? askIdField : null;
  const audio = formData.get("audio");
  const text = formData.get("text");

  // TEXT branch (ADR-0007): typed telling, ask-optional.
  if (!(audio instanceof Blob) && typeof text === "string") {
    if (text.trim().length === 0) return { error: hub.actions.invalidInput };
    // If an ask is supplied, validate it targets this person and is answerable (mirror recordAnswerAction).
    if (askId) {
      const ok = await assertAnswerableAsk(db, askId, ctx.personId); // extract this guard from recordAnswerAction
      if (ok !== true) return ok; // ok is a { error } on failure
    }
    let storyId: string;
    try {
      const res = await ingestTextStory(db, {
        actor: { kind: "account", personId: ctx.personId },
        text,
        ...(askId ? { askId } : {}),
      });
      storyId = res.storyId;
    } catch (err) {
      plogError("answer", "composeStory(text): ingest failed", { error: String(err) });
      return { error: hub.actions.saveFailed };
    }
    try {
      await rt.dispatchPipeline(storyId);
    } catch (err) {
      plogError("answer", "composeStory(text): render failed", { story: storyId, error: String(err) });
      return { error: hub.actions.saveFailed };
    }
    return { kind: "ready", storyId };
  }

  // VOICE branch — delegate to the existing, well-tested path (which itself now accepts a null ask).
  return recordAnswerAction(formData);
}
```

Extract the ask target/status check from `recordAnswerAction` (lines 108-127) into a reusable `assertAnswerableAsk(db, askId, personId): Promise<true | { error: string }>` and call it from both. Relax `recordAnswerAction` so a missing `askId` is allowed on the voice path too (self-initiated voice telling): when `askId` is absent, skip the ask validation and call `ingestRecording` without `askId`, and take the one-shot dispatch path (a self-initiated telling has no ask question to seed the follow-up evaluator — pass the empty prompt or skip the mini-loop; simplest correct behavior: when there is no ask, use `dispatchPipeline` + `{ kind: "ready" }`).

- [ ] **Step 4: Run green**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/compose-story-action.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression — the existing answer action tests**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/answer-follow-up-loop.server.test.ts`
Expected: PASS — `recordAnswerAction` behavior for a real ask is unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/hub/answer/[askId]/actions.ts apps/web/__tests__/compose-story-action.server.test.ts
git commit -m "feat(web): composeStoryAction — voice or text, ask-optional (ADR-0007)"
```

---

### Task 8: `shareAnswerAction` persists an edited title

**Files:**
- Modify: `apps/web/app/hub/answer/[askId]/actions.ts` (`shareAnswerAction` 369-467)
- Test: `apps/web/__tests__/share-title.server.test.ts` (create)

- [ ] **Step 1: Write the failing test**

A story at `pending_approval` with derived title "Auto Title"; share with `correctedTitle: "My Title"` → after share the story's `title` is "My Title". Also: no `correctedTitle` field → title unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/share-title.server.test.ts`
Expected: FAIL — the title is not persisted.

- [ ] **Step 3: Implement**

In `shareAnswerAction`, after the `correctedProse` block (line 404-415) and before `approveAndShareStory`, persist an edited title through the audited surface:

```ts
    const correctedTitle = formData.get("correctedTitle");
    if (typeof correctedTitle === "string" && correctedTitle.trim().length > 0) {
      await updateDerivedFields(db, storyId, { title: correctedTitle.trim() });
      plog("answer", "shareAnswer: saved edited title", { story: storyId });
    }
```

Import `updateDerivedFields` from `@chronicle/core` (add to the existing import block).

- [ ] **Step 4: Run green + regression**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/share-title.server.test.ts __tests__/answer-follow-up-loop.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/answer/[askId]/actions.ts apps/web/__tests__/share-title.server.test.ts
git commit -m "feat(web): shareAnswerAction persists an edited title"
```

---

### Task 9: Refactor `AnswerFlow` → `StoryComposer` (mode prop, voice⇄text toggle, title field)

**Files:**
- Rename/rework: `apps/web/app/hub/answer/[askId]/AnswerFlow.tsx` → `apps/web/app/hub/StoryComposer.tsx` (shared location)
- Modify: `apps/web/app/hub/answer/[askId]/page.tsx` (render `StoryComposer mode="answer"`)
- Modify: `apps/web/app/_copy/hub.ts` (add compose/type/title copy)
- Test: `apps/web/__tests__/story-composer.test.tsx` (create; adapt the existing `answer-flow-*.test.tsx`)

**This is a refactor of a shipped 750-line component. Do it in small, verifiable moves — do NOT rewrite from scratch.**

- [ ] **Step 1: Move + rename, no behavior change**

Copy `AnswerFlow.tsx` to `apps/web/app/hub/StoryComposer.tsx`. Rename the component `AnswerFlow` → `StoryComposer` and its props interface `AnswerFlowProps` → `StoryComposerProps`. Change the ask props to an optional group:

```ts
interface StoryComposerProps {
  mode: "answer" | "tell";
  ask?: { id: string; questionText: string; askerName: string } | null;
  draft: DraftInfo | null;
}
```

Replace the three `askId` / `questionText` / `askerName` usages: the follow-up/ingest still needs `ask?.id`; the header uses `ask?.questionText` / `ask?.askerName`. Make `questionHeader` render `null` when `!ask`. Point form submission at `composeStoryAction` (initial capture) instead of `recordAnswerAction`; for the initial telling append `text` OR `audio`, and append `askId` only when `ask` is present.

Update `apps/web/app/hub/answer/[askId]/page.tsx` to import from the new path and render:

```tsx
<StoryComposer mode="answer" ask={{ id: ask.id, questionText: ask.questionText, askerName: askerName }} draft={draft} />
```

Delete the old `AnswerFlow.tsx`. Run the existing (renamed) tests to prove parity.

- [ ] **Step 2: Run the adapted answer tests (parity)**

Adapt `apps/web/__tests__/answer-flow-*.test.tsx` imports/props to `StoryComposer mode="answer"` (they should pass unchanged in behavior). Run:
`pnpm --filter @chronicle/web exec vitest run __tests__/answer-flow-review-seed.test.tsx __tests__/answer-flow-optimistic-transition.test.tsx`
Expected: PASS — pure rename/parameterize, no behavior change.

- [ ] **Step 3: Add the voice⇄text toggle (failing test first)**

Write `__tests__/story-composer.test.tsx`:

```tsx
it("in tell mode with no ask, shows no question header and offers a type toggle", () => {
  render(<StoryComposer mode="tell" ask={null} draft={null} />);
  expect(screen.queryByText(/asked by/i)).toBeNull();
  expect(screen.getByRole("button", { name: /type it/i })).toBeTruthy();
});

it("type mode submits text via composeStoryAction", async () => {
  // mock composeStoryAction; click "Type it", type into the textarea, submit, assert the action got { text }
});
```

Run red: `pnpm --filter @chronicle/web exec vitest run __tests__/story-composer.test.tsx` → FAIL.

- [ ] **Step 4: Implement the toggle + textarea**

In the RECORD-phase branch (the final `return` around line 715), add an input-mode state and a textarea path:

```tsx
const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
const [textDraft, setTextDraft] = useState("");
```

Render a small toggle ("Speak" / "Type it") above the voice button. When `inputMode === "text"`, render a textarea + a "Continue" button that calls a `submitText` handler:

```tsx
const submitText = useCallback(async () => {
  if (textDraft.trim().length === 0) return;
  setLocalTake({ url: "" }); // reuse the pending screen (no audio url for text)
  const form = new FormData();
  form.set("text", textDraft);
  if (ask) form.set("askId", ask.id);
  const step = await composeStoryAction(form);
  await handleStep(step);
}, [textDraft, ask, handleStep]);
```

The review phase already shows `KindredProseEditor` (with `onPolish`) + tier + Share — text stories arrive there via `router.refresh()` with the rendered prose, identical to voice. Ensure the review "relisten" audio block is guarded on `draft.mediaUrl` being present (text stories have none): wrap the `<audio>` render in `draft.mediaUrl ? (...) : null` (and the multi-take list is voice-only already).

- [ ] **Step 5: Add the title field (failing test first)**

Add to `story-composer.test.tsx`:

```tsx
it("review shows a title field prepopulated with the derived title, editable", () => {
  render(<StoryComposer mode="tell" ask={null} draft={{ storyId: "s", recordedAt: new Date().toISOString(), mediaUrl: "", prose: "body", title: "Auto Title", takes: [] }} />);
  const title = screen.getByLabelText(/title/i) as HTMLInputElement;
  expect(title.value).toBe("Auto Title");
});
```

This requires adding `title` to `DraftInfo` and to the server component that builds the draft prop (Task 11 covers the `/hub/tell` page; also add `title` where `/hub/answer/[askId]/page.tsx` builds `draft`). Run red.

- [ ] **Step 6: Implement the title field**

Add `title: string` to `DraftInfo`. In the review phase, above the prose editor, add:

```tsx
const [titleDraft, setTitleDraft] = useState(draft?.title ?? "");
// ...
<label style={{ display: "block", marginBottom: 24 }}>
  <span style={{ /* mono label style, copy from siblings */ }}>{hub.compose.titleLabel}</span>
  <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} disabled={isRemoving}
    style={{ /* KindredInput style; copy from an existing text input */ }} />
</label>
```

In `handleShare`, append the edited title:

```tsx
if (titleDraft.trim() && titleDraft !== draft!.title) form.append("correctedTitle", titleDraft);
```

Add copy to `apps/web/app/_copy/hub.ts` under a new `compose` block: `titleLabel: "Title"`, `typeIt: "Type it"`, `speak: "Speak"`, `tellPrompt: "What do you want to remember?"`, `continueLabel: "Continue"`.

- [ ] **Step 7: Run green**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/story-composer.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/hub/StoryComposer.tsx apps/web/app/hub/answer/[askId]/page.tsx apps/web/app/_copy/hub.ts apps/web/__tests__/story-composer.test.tsx apps/web/__tests__/answer-flow-*.test.tsx
git rm apps/web/app/hub/answer/[askId]/AnswerFlow.tsx
git commit -m "refactor(web): AnswerFlow → StoryComposer (mode, voice⇄text toggle, title field)"
```

---

### Task 10: `/hub/tell` route

**Files:**
- Create: `apps/web/app/hub/tell/page.tsx`
- Create: `apps/web/app/hub/tell/[storyId]/page.tsx` (resume a self-initiated draft in review)
- Test: covered by Task 9 component tests + a light route smoke test if the repo has route tests (grep `apps/web/__tests__` for a `page` render test to match the pattern; if none, skip a route test — the component is already tested).

- [ ] **Step 1: Create the new-telling page**

`apps/web/app/hub/tell/page.tsx` — a server component mirroring `apps/web/app/hub/answer/[askId]/page.tsx` minus the ask lookup. Resolve the account session (redirect to sign-in if not an account), then render:

```tsx
export default async function TellPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/welcome");
  return (
    <HubChrome> {/* match how the answer page wraps its content */}
      <StoryComposer mode="tell" ask={null} draft={null} />
    </HubChrome>
  );
}
```

Copy the exact chrome/layout wrapper the answer page uses so the surface looks identical.

- [ ] **Step 2: Create the resume page**

`apps/web/app/hub/tell/[storyId]/page.tsx` — resolve the account, load the owner's `pending_approval` text draft via the audited read (`getStoryForViewer(db, ctx, storyId)`), build the `DraftInfo` (including `title`, `prose`, `takes: []`, `mediaUrl: ""` for text), and render `StoryComposer mode="tell" ask={null} draft={draftInfo}`. If the story isn't found/owned or isn't `pending_approval`, redirect to `/hub?tab=stories`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chronicle/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/hub/tell/
git commit -m "feat(web): /hub/tell — start or resume a self-initiated story"
```

---

### Task 11: Stories tab — "Tell a story" entry + self-initiated drafts

**Files:**
- Modify: `apps/web/app/hub/page.tsx` (load `listOutstandingDrafts`; pass self-initiated drafts to StoriesTab, 135/152/304)
- Modify: `apps/web/app/hub/tabs/StoriesTab.tsx` (add the entry button + drafts list)
- Test: `apps/web/__tests__/stories-tab-tell.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
it("shows a 'Tell a story' entry linking to /hub/tell", () => {
  render(<StoriesTab stories={[]} selfDrafts={[]} />);
  const link = screen.getByRole("link", { name: /tell a story/i });
  expect(link.getAttribute("href")).toBe("/hub/tell");
});

it("lists a self-initiated pending draft with a resume link", () => {
  render(<StoriesTab stories={[]} selfDrafts={[{ storyId: "s1", kind: "text", recordedAt: new Date().toISOString() }]} />);
  expect(screen.getByRole("link", { name: /finish|resume/i }).getAttribute("href")).toBe("/hub/tell/s1");
});
```

Match `StoriesTab`'s actual current props by reading the file first; add a `selfDrafts` prop.

- [ ] **Step 2: Run red**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/stories-tab-tell.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `hub/page.tsx`, alongside the existing `listOutstandingAnswerDrafts(db, ctx.personId)` call (135), also call `listOutstandingDrafts(db, ctx.personId)` and derive the self-initiated subset:

```ts
const allDrafts = await listOutstandingDrafts(db, ctx.personId);
const selfDrafts = allDrafts.filter((d) => d.askId === null);
```

Pass `selfDrafts` to `<StoriesTab ... selfDrafts={selfDrafts} />` (304). In `StoriesTab.tsx`, add a prominent "Tell a story" `<Link href="/hub/tell">` (styled as a primary Kindred button/card) and, if `selfDrafts.length`, a "Finish what you started" list where each item links to `/hub/tell/${d.storyId}`.

- [ ] **Step 4: Run green**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/stories-tab-tell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/page.tsx apps/web/app/hub/tabs/StoriesTab.tsx apps/web/__tests__/stories-tab-tell.test.tsx
git commit -m "feat(web): Stories tab — Tell a story entry + resume self-initiated drafts"
```

---

### Task 12: Full regression + docs

**Files:**
- Modify: `docs/adr/0007-stories-are-origin-typed-audio-canonical-when-present.md` (mark Consequences done)
- Modify: `docs/PLAN.md` (add the increment + status), `docs/DECISIONS.md` if a decision was refined

- [ ] **Step 1: Full workspace green**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: PASS across all packages. Investigate and fix any regression in the existing web suite (the `AnswerFlow → StoryComposer` refactor is the likeliest source); each fix gets a companion regression test per the repo rule.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `pnpm --filter @chronicle/web dev`, sign in as a seeded account, go to Stories → "Tell a story", (a) type a story + title → Continue → review → Share; (b) record a story → review → Share. Confirm both appear as shared stories.

- [ ] **Step 3: Update docs**

Mark ADR-0007 Consequences implemented (schema `kind`, nullable recording, CHECK all landed). Add a PLAN.md increment entry describing direct story creation + text origin.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: mark ADR-0007 implemented; record direct-story-creation increment"
```

---

## Self-review notes (author checklist — completed at write time)

- **Spec coverage:** schema `kind`/nullable/CHECK/`user_authored` → Tasks 1-2; `createTextDraft` + generalized listing + title persistence → Tasks 3, 4, 8; `ingestTextStory` → Task 5; text-skips-transcribe pipeline → Task 6; `StoryComposer`/toggle/title/polish reuse → Task 9; `composeStoryAction`/ask-optional polish → Task 7 (polish action already ask-optional — no task needed, noted below); `/hub/tell` + Stories-tab entry + resumable drafts → Tasks 10-11; regression + ADR status → Task 12.
- **Polish action:** `polishAnswerProseAction` is ALREADY ask-optional (takes a `promptQuestion` field, no ownership check) and reused by `StoryComposer`'s `KindredProseEditor onPolish`. No generalization task required; wire the composer's `onPolish` to it in Task 9 (the answer page already does this — copy the wiring).
- **Type consistency:** `OutstandingDraft` (Task 4) is consumed as `selfDrafts` in Task 11; `DraftInfo.title` (Task 9) is produced by the `/hub/tell` pages (Task 10) and the answer page. `composeStoryAction`'s `ThreadStep` return matches the existing union.
- **Open reconciliation (not a task):** local `master` (AI-polish, unpushed) vs `origin/master` (Clerk fix) divergence — flagged in the spec; resolve at merge.
