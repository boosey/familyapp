# Prose Provenance & Human Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record three immutable prose levels (AI-transcribed → AI-polished → human-corrected) per story and let the narrator edit the polished prose directly in the UI before approving, so the L2→L3 diff becomes empirical signal for tuning prompts/models.

**Architecture:** A new append-only `prose_revisions` table (sibling to the consent ledger) captures each level with its model id and prompt text. The pipeline runs once per story (transcribe → polish, no judge, no regeneration loop) and appends L1+L2. The render moves to *before* the review step so the narrator reads/edits the prose, then approval persists L3 and shares. All content writes stay inside the audited `@chronicle/core` surface.

**Tech Stack:** TypeScript ESM monorepo (pnpm workspaces), Drizzle + PGlite (Postgres in-process) for db/tests, Vitest, Next.js 15 / React 19 for web.

**Spec:** `docs/superpowers/specs/2026-06-29-prose-provenance-and-human-correction-design.md`

**Conventions reminder:**
- Run a single package's tests: `pnpm --filter @chronicle/<pkg> test`
- Single test file: `pnpm --filter @chronicle/<pkg> exec vitest run path/to/file.test.ts`
- After editing `packages/db/src/schema.ts` you MUST run `pnpm --filter @chronicle/db db:generate` to regenerate `packages/db/drizzle/schema.sql` (the test harness applies that generated DDL, not `schema.ts`).
- `prose_revisions` holds prose **content**, so its table object lives behind `@chronicle/db/content` (like `stories`/`media`) and is touched only by the already-allowlisted `packages/core/src/story-repository.ts`. No change to `packages/core/test/architecture.test.ts` is required — do NOT widen the allowlist.

---

## Increment A — DB: the `prose_revisions` table + append-only trigger

### Task 1: Add the `prose_revisions` table + enum

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema-public.ts`
- Modify: `packages/db/src/content.ts`
- Modify: `packages/db/src/index.ts`
- Generated: `packages/db/drizzle/schema.sql` (via `db:generate`)
- Test: `packages/db/test/prose-revisions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/prose-revisions.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { media, persons, proseRevisions, stories } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makeStory(): Promise<{ personId: string; storyId: string }> {
  const [p] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor" })
    .returning();
  const [rec] = await db
    .insert(media)
    .values({
      ownerPersonId: p!.id,
      kind: "story_audio",
      storageKey: "s3://bucket/o.wav",
      contentType: "audio/wav",
      checksum: "abc",
    })
    .returning();
  const [s] = await db
    .insert(stories)
    .values({ ownerPersonId: p!.id, recordingMediaId: rec!.id })
    .returning();
  return { personId: p!.id, storyId: s!.id };
}

describe("prose_revisions table", () => {
  it("stores a level/text/modelId/promptText/actor row and assigns a monotonic seq", async () => {
    const { personId, storyId } = await makeStory();
    const [l1] = await db
      .insert(proseRevisions)
      .values({
        storyId,
        level: "ai_transcribed",
        text: "raw transcript",
        modelId: "mock-whisper-turbo",
      })
      .returning();
    const [l3] = await db
      .insert(proseRevisions)
      .values({
        storyId,
        level: "human_corrected",
        text: "edited prose",
        actorPersonId: personId,
      })
      .returning();

    expect(l1!.level).toBe("ai_transcribed");
    expect(l1!.promptText).toBeNull();
    expect(l1!.actorPersonId).toBeNull();
    expect(l3!.level).toBe("human_corrected");
    expect(l3!.modelId).toBeNull();
    expect(l3!.actorPersonId).toBe(personId);
    expect(l3!.seq).toBeGreaterThan(l1!.seq);

    const rows = await db
      .select()
      .from(proseRevisions)
      .where(eq(proseRevisions.storyId, storyId));
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chronicle/db exec vitest run test/prose-revisions.test.ts`
Expected: FAIL — `proseRevisions` is not exported / `relation "prose_revisions" does not exist`.

- [ ] **Step 3: Add the enum + table to `schema.ts`**

In `packages/db/src/schema.ts`, after the `joinRequestStatusEnum` block (around line 117), add:

```ts
/** The provenance levels of a story's prose, oldest to newest. `ai_verified` is a reserved
 * future seam (an AI verify/judge step) — not produced by Phase 1. */
export const proseRevisionLevelEnum = pgEnum("prose_revision_level", [
  "ai_transcribed",
  "ai_polished",
  "human_corrected",
  "ai_verified",
]);
```

After the `stories` table definition (after line 365), add the table:

```ts
// ---------------------------------------------------------------------------
// ProseRevision — append-only provenance of a story's prose at each stage
// (L1 raw transcript → L2 AI-polished → L3 human-corrected). Holds prose CONTENT,
// so the table object lives behind @chronicle/db/content. Immutable: a trigger
// (invariants.sql) forbids UPDATE/DELETE. The L2→L3 diff is the prompt/model signal;
// modelId + promptText record exactly what produced each AI level.
// ---------------------------------------------------------------------------

export const proseRevisions = pgTable(
  "prose_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic total order over a story's revisions — deterministic ordering even within a tx. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    level: proseRevisionLevelEnum("level").notNull(),
    /** The prose text at this stage. */
    text: text("text").notNull(),
    /** AI model that produced this level; null for human_corrected. */
    modelId: text("model_id"),
    /** Exact prompt that produced this level; null for ai_transcribed (STT) and human_corrected. */
    promptText: text("prompt_text"),
    /** The person who produced a human_corrected revision; null for AI levels. */
    actorPersonId: uuid("actor_person_id").references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("prose_revisions_story_idx").on(t.storyId)],
);
```

In the inferred-types section at the bottom of `schema.ts` (after the `StoryView` types, around line 654) add:

```ts
export type ProseRevision = typeof proseRevisions.$inferSelect;
export type NewProseRevision = typeof proseRevisions.$inferInsert;
```

And in the enum-types block (after `JoinRequestStatus`, around line 666) add:

```ts
export type ProseRevisionLevel =
  (typeof proseRevisionLevelEnum.enumValues)[number];
```

- [ ] **Step 4: Export the enum object (public) and the table object (guarded)**

In `packages/db/src/schema-public.ts`, add `proseRevisionLevelEnum` to the export list (after `storyStateEnum`):

```ts
  storyStateEnum,
  proseRevisionLevelEnum,
} from "./schema";
```

In `packages/db/src/content.ts`, add `proseRevisions` to the guarded export:

```ts
export { media, stories, proseRevisions } from "./schema";
```

In `packages/db/src/index.ts`, add the type exports inside the existing `export type { ... } from "./schema";` block (after `BiographicalProfile`):

```ts
  BiographicalProfile,
  ProseRevision,
  NewProseRevision,
  ProseRevisionLevel,
} from "./schema";
```

- [ ] **Step 5: Regenerate the SQL DDL**

Run: `pnpm --filter @chronicle/db db:generate`
Expected: `packages/db/drizzle/schema.sql` now contains `CREATE TYPE "public"."prose_revision_level"` and `CREATE TABLE ... "prose_revisions"`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @chronicle/db exec vitest run test/prose-revisions.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck the db package**

Run: `pnpm --filter @chronicle/db typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/schema-public.ts packages/db/src/content.ts packages/db/src/index.ts packages/db/drizzle/schema.sql packages/db/test/prose-revisions.test.ts
git commit -m "feat(db): add append-only prose_revisions table + level enum"
```

---

### Task 2: Make `prose_revisions` append-only (trigger)

**Files:**
- Modify: `packages/db/drizzle/invariants.sql`
- Test: `packages/db/test/prose-revisions.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/test/prose-revisions.test.ts` inside the `describe("prose_revisions table", ...)` block:

```ts
  it("rejects UPDATE of a prose revision", async () => {
    const { storyId } = await makeStory();
    const [row] = await db
      .insert(proseRevisions)
      .values({ storyId, level: "ai_polished", text: "v1", modelId: "mock-claude" })
      .returning();
    await expect(
      db
        .update(proseRevisions)
        .set({ text: "v2" })
        .where(eq(proseRevisions.id, row!.id)),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE of a prose revision", async () => {
    const { storyId } = await makeStory();
    const [row] = await db
      .insert(proseRevisions)
      .values({ storyId, level: "ai_polished", text: "v1", modelId: "mock-claude" })
      .returning();
    await expect(
      db.delete(proseRevisions).where(eq(proseRevisions.id, row!.id)),
    ).rejects.toThrow(/append-only/i);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @chronicle/db exec vitest run test/prose-revisions.test.ts`
Expected: the two new tests FAIL (UPDATE/DELETE currently succeed, so `rejects.toThrow` is not satisfied).

- [ ] **Step 3: Add the trigger**

In `packages/db/drizzle/invariants.sql`, after the `consent_records_append_only` trigger (after line 24), add:

```sql
-- Prose revisions: the prose provenance ledger (L1 transcribed → L2 polished → L3 corrected).
-- Append-only like the consent ledger — a correction is a NEW row, never an edit. Reuses the
-- shared chronicle_forbid_mutation() guard defined above.
CREATE TRIGGER prose_revisions_append_only
  BEFORE UPDATE OR DELETE ON prose_revisions
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @chronicle/db exec vitest run test/prose-revisions.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/invariants.sql packages/db/test/prose-revisions.test.ts
git commit -m "feat(db): enforce prose_revisions append-only via trigger"
```

---

## Increment B — core: the write/read seams

All three functions live in `packages/core/src/story-repository.ts` (already on the architecture allowlist). They are exported from `packages/core/src/index.ts`.

### Task 3: `appendProseRevision` + `listProseRevisions`

**Files:**
- Modify: `packages/core/src/story-repository.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/prose-revisions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/prose-revisions.test.ts`:

```ts
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendProseRevision,
  listProseRevisions,
  persistRecordingAndCreateDraft,
} from "../src/index";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function seedStory(): Promise<{ personId: string; storyId: string }> {
  const narrator = await makePerson(db, "Eleanor");
  const { story } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId: narrator.id,
    storageKey: "r2://x.webm",
    contentType: "audio/webm",
    checksum: "sha256:x",
  });
  return { personId: narrator.id, storyId: story.id };
}

describe("appendProseRevision / listProseRevisions", () => {
  it("appends rows and lists them in seq order", async () => {
    const { personId, storyId } = await seedStory();
    await appendProseRevision(db, {
      storyId,
      level: "ai_transcribed",
      text: "raw",
      modelId: "mock-whisper-turbo",
    });
    await appendProseRevision(db, {
      storyId,
      level: "ai_polished",
      text: "polished",
      modelId: "mock-claude",
      promptText: "SYSTEM PROMPT",
    });
    await appendProseRevision(db, {
      storyId,
      level: "human_corrected",
      text: "edited",
      actorPersonId: personId,
    });

    const rows = await listProseRevisions(db, storyId);
    expect(rows.map((r) => r.level)).toEqual([
      "ai_transcribed",
      "ai_polished",
      "human_corrected",
    ]);
    expect(rows[1]!.promptText).toBe("SYSTEM PROMPT");
    expect(rows[2]!.actorPersonId).toBe(personId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/prose-revisions.test.ts`
Expected: FAIL — `appendProseRevision` / `listProseRevisions` are not exported.

- [ ] **Step 3: Implement both functions**

In `packages/core/src/story-repository.ts`:

Extend the content import (line 22) to include the new table:

```ts
import { media, proseRevisions, stories } from "@chronicle/db/content";
```

Extend the type import from `@chronicle/db` (lines 24-32) to add `ProseRevision` and `ProseRevisionLevel`:

```ts
import type {
  Ask,
  AudienceTier,
  ConsentRecord,
  Database,
  Media,
  ProseRevision,
  ProseRevisionLevel,
  Story,
  StoryState,
} from "@chronicle/db";
```

Add the `asc` helper to the drizzle-orm import (line 21):

```ts
import { and, asc, eq, isNotNull } from "drizzle-orm";
```

Append at the end of the file:

```ts
/**
 * Append a row to the append-only prose provenance ledger. AI levels carry `modelId` (+ `promptText`
 * for the polished render); `human_corrected` carries `actorPersonId`. The trigger in invariants.sql
 * makes the row immutable. This holds prose content, so it lives in this audited file.
 */
export interface AppendProseRevisionInput {
  storyId: string;
  level: ProseRevisionLevel;
  text: string;
  modelId?: string | null;
  promptText?: string | null;
  actorPersonId?: string | null;
}

export async function appendProseRevision(
  db: Database,
  input: AppendProseRevisionInput,
): Promise<ProseRevision> {
  const [row] = await db
    .insert(proseRevisions)
    .values({
      storyId: input.storyId,
      level: input.level,
      text: input.text,
      modelId: input.modelId ?? null,
      promptText: input.promptText ?? null,
      actorPersonId: input.actorPersonId ?? null,
    })
    .returning();
  return row!;
}

/**
 * Read a story's full prose lineage in append order. ANALYTICS / OFFLINE-TOOLING ONLY — this
 * surfaces raw prose content with no AuthContext, so NO user-facing surface may call it. It lives
 * in this already-allowlisted file; the L2→L3 diff (ai_polished vs human_corrected) is the
 * prompt/model improvement signal.
 */
export async function listProseRevisions(
  db: Database,
  storyId: string,
): Promise<ProseRevision[]> {
  return db
    .select()
    .from(proseRevisions)
    .where(eq(proseRevisions.storyId, storyId))
    .orderBy(asc(proseRevisions.seq));
}
```

In `packages/core/src/index.ts`, add to the `story-repository` export block (after `discardDraftStory`, line 38):

```ts
  discardDraftStory,
  appendProseRevision,
  listProseRevisions,
  type AppendProseRevisionInput,
} from "./story-repository";
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chronicle/core exec vitest run test/prose-revisions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/src/index.ts packages/core/test/prose-revisions.test.ts
git commit -m "feat(core): appendProseRevision + listProseRevisions"
```

---

### Task 4: `saveProseCorrection` (the direct prose edit → L3)

**Files:**
- Modify: `packages/core/src/story-repository.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/prose-revisions.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/prose-revisions.test.ts`. Add `transitionStoryState`, `updateDerivedFields`, `getStoryForViewer`, and `saveProseCorrection` to the imports from `../src/index`, then add:

```ts
describe("saveProseCorrection", () => {
  async function seedPendingApproval() {
    const { personId, storyId } = await seedStory();
    await updateDerivedFields(db, storyId, { transcript: "t", prose: "polished L2" });
    await transitionStoryState(db, storyId, "pending_approval");
    return { personId, storyId };
  }

  it("sets stories.prose to the correction and appends a human_corrected revision", async () => {
    const { personId, storyId } = await seedPendingApproval();
    const story = await saveProseCorrection(db, {
      storyId,
      correctedProse: "human edited L3",
      actorPersonId: personId,
    });
    expect(story.prose).toBe("human edited L3");

    const rows = await listProseRevisions(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe("human_corrected");
    expect(rows[0]!.text).toBe("human edited L3");
    expect(rows[0]!.actorPersonId).toBe(personId);
  });

  it("rejects a non-owner", async () => {
    const { storyId } = await seedPendingApproval();
    const stranger = await makePerson(db, "Stranger");
    await expect(
      saveProseCorrection(db, {
        storyId,
        correctedProse: "x",
        actorPersonId: stranger.id,
      }),
    ).rejects.toThrow(/not the owner/i);
  });

  it("rejects a story that is not pending_approval", async () => {
    const { personId, storyId } = await seedStory(); // still draft
    await expect(
      saveProseCorrection(db, {
        storyId,
        correctedProse: "x",
        actorPersonId: personId,
      }),
    ).rejects.toThrow(/pending_approval/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/prose-revisions.test.ts`
Expected: FAIL — `saveProseCorrection` is not exported.

- [ ] **Step 3: Implement `saveProseCorrection`**

Append to `packages/core/src/story-repository.ts`:

```ts
/**
 * Persist a narrator's DIRECT prose edit (L3) and append a `human_corrected` revision — in one tx.
 * Unlike `applyTranscriptCorrection`, this does NOT touch the transcript and does NOT re-run the
 * LLM: the human is the correction authority and AI runs only once (spec: prose-provenance design).
 * Gated to the owner and to `pending_approval` (a post-share edit would need a new consent event,
 * out of scope). Callers should only invoke this when the edited prose differs from the AI polish.
 */
export interface SaveProseCorrectionInput {
  storyId: string;
  correctedProse: string;
  /** The narrator editing — must equal the story owner. */
  actorPersonId: string;
}

export async function saveProseCorrection(
  db: Database,
  input: SaveProseCorrectionInput,
): Promise<Story> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) throw new Error(`story not found: ${input.storyId}`);
    if (current.ownerPersonId !== input.actorPersonId) {
      throw new InvariantViolation(
        `saveProseCorrection: actor ${input.actorPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "pending_approval") {
      throw new InvariantViolation(
        `saveProseCorrection: story must be pending_approval (was ${current.state})`,
      );
    }
    const [row] = await tx
      .update(stories)
      .set({ prose: input.correctedProse, updatedAt: new Date() })
      .where(eq(stories.id, input.storyId))
      .returning();
    await tx.insert(proseRevisions).values({
      storyId: input.storyId,
      level: "human_corrected",
      text: input.correctedProse,
      actorPersonId: input.actorPersonId,
    });
    return row!;
  });
}
```

In `packages/core/src/index.ts`, add the two NEW lines to the `story-repository` export block you
already extended in Task 3 (do not re-add `appendProseRevision`/`listProseRevisions` — they are
already there). The block's tail becomes:

```ts
  discardDraftStory,
  appendProseRevision,
  listProseRevisions,
  saveProseCorrection,
  type AppendProseRevisionInput,
  type SaveProseCorrectionInput,
} from "./story-repository";
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chronicle/core exec vitest run test/prose-revisions.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the core architecture guard (must still pass unchanged)**

Run: `pnpm --filter @chronicle/core exec vitest run test/architecture.test.ts`
Expected: PASS — the allowlist canary is unchanged because `prose_revisions` is only touched from the already-allowlisted `story-repository.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/src/index.ts packages/core/test/prose-revisions.test.ts
git commit -m "feat(core): saveProseCorrection (direct prose edit -> L3, no LLM)"
```

---

## Increment C — pipeline: append L1 + L2 with model + prompt

### Task 5: `renderStoryFromTranscript` returns the exact system prompt

**Files:**
- Modify: `packages/pipeline/src/render-story.ts`
- Test: `packages/pipeline/test/render-story.test.ts` (create — small focused test)

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/test/render-story.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ScriptedLanguageModel } from "../src/index";
import { renderStoryFromTranscript } from "../src/render-story";

describe("renderStoryFromTranscript", () => {
  it("returns the exact system prompt it used (for provenance)", async () => {
    const llm = new ScriptedLanguageModel();
    const out = await renderStoryFromTranscript(llm, { transcript: "I was born on a farm." });
    expect(typeof out.systemPrompt).toBe("string");
    // The prompt the model actually saw must equal what we report.
    const systemMsg = llm.calls[0]!.messages.find((m) => m.role === "system");
    expect(out.systemPrompt).toBe(systemMsg!.content);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chronicle/pipeline exec vitest run test/render-story.test.ts`
Expected: FAIL — `out.systemPrompt` is `undefined`.

- [ ] **Step 3: Add `systemPrompt` to `RenderOutput`**

In `packages/pipeline/src/render-story.ts`:

Add the field to the interface (after `modelId: string;`, line 42):

```ts
export interface RenderOutput {
  prose: string;
  title: string;
  summary: string;
  tags: string[];
  modelId: string;
  /** The exact system prompt used — recorded as prose-revision provenance. */
  systemPrompt: string;
}
```

Update the return in `renderStoryFromTranscript` (line 92):

```ts
  return {
    ...parseRenderResponse(res.text, input.transcript),
    modelId: res.modelId,
    systemPrompt: SYSTEM_PROMPT,
  };
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chronicle/pipeline exec vitest run test/render-story.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/render-story.ts packages/pipeline/test/render-story.test.ts
git commit -m "feat(pipeline): renderStoryFromTranscript reports the system prompt used"
```

---

### Task 6: Orchestrator appends `ai_transcribed` + `ai_polished`

**Files:**
- Modify: `packages/pipeline/src/orchestrator.ts`
- Test: `packages/pipeline/test/pipeline.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add `listProseRevisions` to the `@chronicle/core` import at the top of `packages/pipeline/test/pipeline.test.ts` (lines 5-10):

```ts
import {
  getStoryForViewer,
  listProseRevisions,
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
```

Add this `describe` block to the file:

```ts
describe("pipeline — prose provenance", () => {
  it("appends ai_transcribed (L1) and ai_polished (L2) with model ids + render prompt", async () => {
    const narratorId = await makeNarrator();
    const canonical = new Uint8Array([1, 2, 3]);
    const { storyId } = await seedDraftStory(narratorId, canonical);

    const transcriber = new ScriptedTranscriber({
      text: "I was born on a farm.",
      modelId: "whisper-test",
    });
    const languageModel = new ScriptedLanguageModel({ modelId: "claude-test" });
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });

    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    const rows = await listProseRevisions(db, storyId);
    expect(rows.map((r) => r.level)).toEqual(["ai_transcribed", "ai_polished"]);
    const [l1, l2] = rows;
    expect(l1!.modelId).toBe("whisper-test");
    expect(l1!.promptText).toBeNull();
    expect(l2!.modelId).toBe("claude-test");
    expect(typeof l2!.promptText).toBe("string");
    expect(l2!.promptText!.length).toBeGreaterThan(0);
  });

  it("does not append duplicate revisions when the pipeline is re-run (idempotent)", async () => {
    const narratorId = await makeNarrator();
    const { storyId } = await seedDraftStory(narratorId, new Uint8Array([9, 9]));
    const transcriber = new ScriptedTranscriber({ text: "A short memory." });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });

    await pipeline.start(storyId);
    await pipeline.runToCompletion();
    // Re-run: both stages hit their idempotency early-returns, so no new rows.
    await pipeline.start(storyId);
    await pipeline.runToCompletion();

    const rows = await listProseRevisions(db, storyId);
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chronicle/pipeline exec vitest run test/pipeline.test.ts`
Expected: FAIL — `listProseRevisions` returns `[]` (no rows appended yet).

- [ ] **Step 3: Append revisions in the orchestrator**

In `packages/pipeline/src/orchestrator.ts`:

Add `appendProseRevision` to the core import (line 29):

```ts
import { appendProseRevision, transitionStoryState, updateDerivedFields } from "@chronicle/core";
```

In `runTranscribeStage`, immediately after the `updateDerivedFields(...)` call (after line 147) and before the `queue.enqueue("render_story", ...)`:

```ts
    await appendProseRevision(deps.db, {
      storyId: view.storyId,
      level: "ai_transcribed",
      text: transcription.text,
      modelId: transcription.modelId,
    });
```

In `runRenderStoryStage`, immediately after the `updateDerivedFields(...)` call (after line 188) and before `transitionStoryState(...)`:

```ts
    await appendProseRevision(deps.db, {
      storyId: view.storyId,
      level: "ai_polished",
      text: render.prose,
      modelId: render.modelId,
      promptText: render.systemPrompt,
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chronicle/pipeline exec vitest run test/pipeline.test.ts`
Expected: PASS (all pipeline tests, including the canonical-audio invariants).

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/orchestrator.ts packages/pipeline/test/pipeline.test.ts
git commit -m "feat(pipeline): record L1/L2 prose revisions with model + prompt"
```

---

## Increment D — capture: accept a prose correction at approval

### Task 7: `captureApproval` accepts optional `correctedProse`

**Files:**
- Modify: `packages/capture/src/approval.ts`
- Test: `packages/capture/test/approval.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `packages/capture/test/approval.test.ts`, add `listProseRevisions` to the `@chronicle/core` import (lines 5-10), then add inside the `describe("captureApproval ...")` block:

```ts
  it("persists a prose correction (L3) before sharing when correctedProse is provided", async () => {
    const { storyId, token } = await setup();
    await captureApproval(db, storage, {
      actor: { kind: "link_session", token },
      storyId,
      audienceTier: "family",
      audio: { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/webm" },
      correctedProse: "the narrator's edited prose",
    });

    const rows = await listProseRevisions(db, storyId);
    const human = rows.find((r) => r.level === "human_corrected");
    expect(human).toBeDefined();
    expect(human!.text).toBe("the narrator's edited prose");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chronicle/capture exec vitest run test/approval.test.ts`
Expected: FAIL — `correctedProse` is not a known property / no `human_corrected` row is written.

- [ ] **Step 3: Wire `saveProseCorrection` into `captureApproval`**

In `packages/capture/src/approval.ts`:

Add `saveProseCorrection` to the core import (line 18):

```ts
import { approveAndShareStory, getStoryForViewer, saveProseCorrection } from "@chronicle/core";
```

Add the optional field to `CaptureApprovalInput` (after the `audio` field, around line 73):

```ts
  /**
   * The narrator's edited prose (L3). OPTIONAL — pass ONLY when the narrator actually changed the
   * AI-polished prose in the editor. Persisted via saveProseCorrection (which appends a
   * human_corrected revision) BEFORE the story transitions out of pending_approval.
   */
  correctedProse?: string;
```

In `captureApproval`, after the `story.state !== "pending_approval"` check (after line 139) and before the audio upload (line 141), add:

```ts
  // Persist the human correction (L3) while the story is still pending_approval. Only when the UI
  // sent an edited prose — an unchanged prose sends nothing, so no spurious human_corrected row.
  if (input.correctedProse !== undefined) {
    await saveProseCorrection(db, {
      storyId: input.storyId,
      correctedProse: input.correctedProse,
      actorPersonId: resolved.personId,
    });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chronicle/capture exec vitest run test/approval.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/capture/src/approval.ts packages/capture/test/approval.test.ts
git commit -m "feat(capture): captureApproval persists optional prose correction (L3)"
```

---

## Increment E — web: the in-hub reorder + prose editor

> Web UI tasks: the repo has a Vitest harness under `apps/web/__tests__` but no React-rendering
> harness for these flows. Logic is covered by the core/capture/pipeline tests above; UI tasks here
> end with an explicit **manual verification** step. Follow existing Kindred chrome patterns
> (`AnswerFlow.tsx`, `ApprovalRecorder.tsx`).

### Task 8: Add a shared `ProseEditor` component

**Files:**
- Create: `apps/web/app/_kindred/KindredProseEditor.tsx`
- Modify: `apps/web/app/_kindred/index.ts` (barrel — confirm it exists and re-exports siblings)

- [ ] **Step 1: Create the component**

Create `apps/web/app/_kindred/KindredProseEditor.tsx`:

```tsx
"use client";

/**
 * Multiline prose editor in Kindred chrome. Prefilled with the AI-polished prose (L2); the narrator
 * edits directly. The parent decides whether the value changed (only then is a correction saved).
 */
interface KindredProseEditorProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export function KindredProseEditor({ value, onChange, disabled }: KindredProseEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={12}
      aria-label="Your story, in your words"
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "18px 20px",
        borderRadius: "var(--radius-md)",
        border: "1.5px solid var(--border)",
        background: "var(--surface-card)",
        color: "var(--text-body)",
        fontFamily: "var(--font-story)",
        fontSize: "var(--text-ui)",
        lineHeight: "var(--leading-relaxed, 1.6)",
        resize: "vertical",
      }}
    />
  );
}
```

- [ ] **Step 2: Re-export from the barrel**

Open `apps/web/app/_kindred/index.ts`. Add (matching the existing export style):

```ts
export { KindredProseEditor } from "./KindredProseEditor";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/_kindred/KindredProseEditor.tsx apps/web/app/_kindred/index.ts
git commit -m "feat(web): KindredProseEditor component"
```

---

### Task 9: Run the pipeline at record time (in-hub)

**Files:**
- Modify: `apps/web/app/hub/answer/[askId]/actions.ts`

**Why:** the review phase needs the polished prose to exist. Today the pipeline runs inside
`shareAnswerAction` (after Share). Move it into `recordAnswerAction` (after ingest) and out of
`shareAnswerAction`.

- [ ] **Step 1: Run the pipeline after ingest in `recordAnswerAction`**

In `apps/web/app/hub/answer/[askId]/actions.ts`, `recordAnswerAction`:

Change the runtime destructure (line 32) to also get the pipeline factory:

```ts
  const { db, storage, auth, newPipeline } = await getRuntime();
```

Replace the `ingestRecording` block (lines 61-69) with ingest-then-pipeline. `ingestRecording`
returns `{ storyId }`; run the pipeline so the draft reaches `pending_approval` with prose:

```ts
  let storyId: string;
  try {
    const result = await ingestRecording(db, storage, {
      actor: { kind: "account", personId: ctx.personId },
      audio: { bytes, contentType: audio.type || "audio/webm" },
      askId: askIdField,
    });
    storyId = result.storyId;
  } catch {
    return { error: hub.actions.saveFailed };
  }

  // Render BEFORE review (prose-provenance design): transcribe → polish so the review phase can
  // show the polished prose for the narrator to read and edit. A fresh pipeline per call isolates
  // its in-process queue (SF-3). Idempotent if re-run.
  try {
    const pipeline = newPipeline();
    await pipeline.start(storyId);
    await pipeline.runToCompletion();
  } catch {
    return { error: hub.actions.saveFailed };
  }
```

> Note: confirm `ingestRecording`'s result field name in `packages/capture/src/capture.ts`
> (`IngestResult.storyId`). The capture spec section documents `{ storyId, recordingMediaId,
> storageKey }`.

- [ ] **Step 2: Remove the pipeline run from `shareAnswerAction`**

In `shareAnswerAction`, delete the pipeline block (lines 104-110: the `const pipeline = newPipeline();`
through `await pipeline.runToCompletion();` and its comment). Keep the ownership check, the
TEMPORARY title block, `approveAndShareStory`, and the augmentation block. `newPipeline` is no longer
used in `shareAnswerAction` — but it IS still needed for the `saveProseCorrection` wiring in Task 10,
so leave the runtime destructure for now (Task 10 finalizes it).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: no errors (if `newPipeline` is reported unused in `shareAnswerAction`, that is resolved in Task 10; if blocking, temporarily prefix with `void newPipeline;` and remove in Task 10).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/hub/answer/[askId]/actions.ts
git commit -m "refactor(web): run render pipeline at record time, not at share"
```

---

### Task 10: Show + save the prose edit in the in-hub review phase

**Files:**
- Modify: `apps/web/app/hub/answer/[askId]/page.tsx`
- Modify: `apps/web/app/hub/answer/[askId]/AnswerFlow.tsx`
- Modify: `apps/web/app/hub/answer/[askId]/actions.ts` (extend `shareAnswerAction`)

- [ ] **Step 1: Pass the polished prose into `AnswerFlow`**

In `apps/web/app/hub/answer/[askId]/page.tsx`, the server component already loads the draft for the
review phase. Read the story's `prose` via the front door and pass it on the `draft` object. Locate
where `DraftInfo` is built (it sets `storyId`, `recordedAt`, `mediaUrl`) and add the prose. Use
`getStoryForViewer(db, ctx, storyId)` (already imported in this area of the app) and read `.prose`.
Add a `prose: string` field:

```tsx
// when building the draft object for the review phase:
const storyForReview = await getStoryForViewer(db, ctx, draftStoryId);
const draft = {
  storyId: draftStoryId,
  recordedAt: /* existing */,
  mediaUrl: /* existing */,
  prose: storyForReview?.prose ?? "",
};
```

> Confirm the exact current shape of the server component when implementing; the only addition is
> reading `prose` and adding it to the object passed as `draft`.

- [ ] **Step 2: Render the editor and send the edit on Share**

In `apps/web/app/hub/answer/[askId]/AnswerFlow.tsx`:

Add `prose: string;` to the `DraftInfo` interface (after `mediaUrl: string;`, line 30).

Import the editor (line 16 area):

```tsx
import { KindredVoiceButton, KindredButton, KindredProseEditor } from "@/app/_kindred";
```

Add review-phase state near the other review state (after line 62):

```tsx
  const [proseDraft, setProseDraft] = useState(draft?.prose ?? "");
```

In the review-phase JSX, insert the editor between the relisten `<audio>` and the tier-picker
`<fieldset>` (after line 276):

```tsx
        {/* Read + edit the polished prose before sharing */}
        <div style={{ marginBottom: 32 }}>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--support)",
              margin: "0 0 14px",
            }}
          >
            {hub.answer.reviewYourWords}
          </p>
          <KindredProseEditor
            value={proseDraft}
            onChange={setProseDraft}
            disabled={isRemoving}
          />
        </div>
```

In `handleShare`, send the edited prose only when it changed from the AI polish:

```tsx
      const form = new FormData();
      form.append("storyId", draft!.storyId);
      form.append("audienceTier", tier);
      if (proseDraft !== draft!.prose) {
        form.append("correctedProse", proseDraft);
      }
      const result = await shareAnswerAction(form);
```

Add the copy key. In `apps/web/app/_copy` (the `hub.answer` group), add:
`reviewYourWords: "Read it over — edit anything that isn't quite right"`.

- [ ] **Step 3: Persist the correction in `shareAnswerAction`**

In `apps/web/app/hub/answer/[askId]/actions.ts`:

Add `saveProseCorrection` to the core import (line 12-17):

```ts
import {
  getStoryForViewer,
  approveAndShareStory,
  discardDraftStory,
  saveProseCorrection,
  updateDerivedFields,
} from "@chronicle/core";
```

In `shareAnswerAction`, after the ownership check (after line 102) and BEFORE `approveAndShareStory`,
read and apply the optional correction:

```ts
    const correctedProse = formData.get("correctedProse");
    if (typeof correctedProse === "string" && correctedProse.length > 0) {
      await saveProseCorrection(db, {
        storyId,
        correctedProse,
        actorPersonId: ctx.personId,
      });
    }
```

Remove `newPipeline` from the `shareAnswerAction` runtime destructure (line 80) now that the pipeline
no longer runs here — keep `languageModel` (used by augmentation):

```ts
  const { db, auth, languageModel } = await getRuntime();
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the dev server: `pnpm --filter @chronicle/web dev`. Sign in (dev), answer an ask, and on the
review screen confirm: (a) the polished prose appears in the editor, (b) editing it and tapping Share
succeeds, (c) the shared story shows the edited text. Then check provenance: in a node/psql session
against the dev DB, `select level, left(text, 40), model_id from prose_revisions order by seq` shows
`ai_transcribed`, `ai_polished`, and (when edited) `human_corrected`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/hub/answer/[askId]/page.tsx apps/web/app/hub/answer/[askId]/AnswerFlow.tsx apps/web/app/hub/answer/[askId]/actions.ts apps/web/app/_copy
git commit -m "feat(web): in-hub prose review + edit before share"
```

---

## Increment F — web: the link-session approval editor

### Task 11: Prose editor on the voice-approval surface

**Files:**
- Modify: `apps/web/app/s/[token]/approve/[storyId]/page.tsx`
- Modify: `apps/web/app/s/[token]/approve/[storyId]/ApprovalRecorder.tsx`
- Modify: `apps/web/app/api/capture/approve/route.ts`

- [ ] **Step 1: Pass the polished prose into `ApprovalRecorder`**

In `apps/web/app/s/[token]/approve/[storyId]/page.tsx`, the `story` loaded via `getStoryForViewer`
already has `.prose`. Pass it to the recorder (line 185):

```tsx
<ApprovalRecorder token={token} storyId={story.id} prose={story.prose ?? ""} />
```

- [ ] **Step 2: Render the editor and send the edit with the approval**

In `apps/web/app/s/[token]/approve/[storyId]/ApprovalRecorder.tsx`:

Update the props (line 15-21):

```tsx
export function ApprovalRecorder({
  token,
  storyId,
  prose,
}: {
  token: string;
  storyId: string;
  prose: string;
}) {
```

Add editor imports + state (line 8-9 area):

```tsx
import { KindredVoiceButton, KindredButton, KindredProseEditor } from "@/app/_kindred";
import { useCallback, useRef, useState } from "react";
```

Add state near the other `useState` (after line 23):

```tsx
  const [proseDraft, setProseDraft] = useState(prose);
```

In `upload`, attach the edit only when changed (inside the `FormData` build, after the `audio` append, line 36):

```tsx
      if (proseDraft !== prose) {
        form.append("correctedProse", proseDraft);
      }
```

Render the editor in the `idle` branch, above the tier-picker `<fieldset>` (before line 190):

```tsx
      {/* Read + edit the polished prose before approving */}
      <div style={{ marginBottom: 28 }}>
        <KindredProseEditor value={proseDraft} onChange={setProseDraft} />
      </div>
```

- [ ] **Step 3: Forward `correctedProse` from the route to `captureApproval`**

In `apps/web/app/api/capture/approve/route.ts`:

Read the optional field after the existing `form.get` calls (after line 39):

```ts
  const correctedProse = form.get("correctedProse");
```

Pass it to `captureApproval` only when it's a non-empty string (line 58-63):

```ts
    const result = await captureApproval(db, storage, {
      actor: { kind: "link_session", token },
      storyId,
      audienceTier: tierField as Exclude<AudienceTier, "private">,
      audio: { bytes, contentType: audio.type || "audio/webm" },
      ...(typeof correctedProse === "string" && correctedProse.length > 0
        ? { correctedProse }
        : {}),
    });
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

With a dev link session at `/s/<token>/approve/<storyId>` (story in `pending_approval`): confirm the
prose appears in the editor, editing + voice approval succeeds, and `prose_revisions` gains a
`human_corrected` row with the edited text.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/s/[token]/approve/[storyId]/page.tsx apps/web/app/s/[token]/approve/[storyId]/ApprovalRecorder.tsx apps/web/app/api/capture/approve/route.ts
git commit -m "feat(web): prose review + edit on link-session voice approval"
```

---

## Final verification (whole feature)

- [ ] **Step 1: Full workspace typecheck**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 2: Full workspace tests**

Run: `pnpm -r test`
Expected: all green — including `packages/core/test/architecture.test.ts` (allowlist canary unchanged) and the new prose-revision tests at the db/core/pipeline/capture layers.

- [ ] **Step 3: Lint**

Run: `pnpm -r lint`
Expected: clean.

---

## Notes / deliberately deferred (from the spec)

- **No AI judge / `ai_verified`** — the enum value exists; nothing produces it yet.
- **No `genConfig` (temperature/max-tokens)** in provenance — only `promptText` was requested.
- **No prompt-text normalization** (hashed `prompts` table) — accepted redundancy for now.
- **Title/summary/tags are not human-editable** in this slice — only `prose`.
- **No-AI phase:** `modelId` will be the mock id and L2 will be mock prose until real Groq/Anthropic
  adapters are exercised; the editor + provenance work end-to-end regardless.
```
