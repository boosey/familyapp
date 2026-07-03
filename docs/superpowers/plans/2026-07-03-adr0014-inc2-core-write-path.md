# ADR-0014 Increment 2 — Core write path + kind invariant + schema FK — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the foundational DB + core write path for ADR-0014's composing surface: a per-take prose-provenance FK, the mixed-draft kind/recording invariant, hardened media protection, and the core functions that append takes / finish / polish a draft — so Inc 3 (web) and Inc 4 (intake) can wire them up.

**Architecture:** All work is in `@chronicle/db` (schema + hand-maintained `invariants.sql`) and `@chronicle/core` (`story-repository.ts`, already on the architecture ALLOWLIST). No web, no pipeline. The kind/recording rule moves from a take-0-only single-table CHECK to a **DEFERRABLE INITIALLY DEFERRED constraint trigger** that enforces the biconditional `kind='voice' ⟺ ≥1 story_recordings row` at COMMIT, plus a single-table CHECK for the text-half. LM/vendor calls never enter core — core receives already-cleaned text / already-derived metadata.

**Tech Stack:** TypeScript (strict, ESM, `noUncheckedIndexedAccess`), Drizzle ORM, PGlite (real Postgres in-process) for tests, Vitest.

---

## Frozen-contract references (READ BEFORE STARTING)

- `docs/superpowers/plans/2026-07-03-adr0014-shared-contract.md` — §2 (FK + keying table), §3 (kind invariant + media-guard hardening, **amended 2026-07-03**: the `kind text→voice` flip is co-transactional inside `persistTakeRecording`, NOT `appendVoiceTakeContribution`), §4 (core signatures + regeneration guard).
- `docs/adr/0014-composing-surface-authored-prose-and-the-four-passes.md` — §6 (voice/text interleave), §7 (prose is authored, never regenerated).
- Repo `CLAUDE.md` — the single front door; `invariants.sql` is HAND-maintained (never generated); `schema.sql` is GENERATED (never hand-edited).

## Two owner-confirmed forks (do NOT re-ask)

1. Add nullable `story_recording_id uuid` FK to `prose_revisions` (per-take provenance).
2. Harden `chronicle_media_delete_guard`: forbid deleting media referenced by ANY `story_recordings` row whose story has a consent record (closes silent-audio-loss for follow-up/mixed takes). Ships with a regression test.

## Critical mechanism notes (the whole plan hinges on these)

1. **Deferred triggers fire at COMMIT.** In PGlite/Postgres autocommit mode, EACH bare `db.insert(...)` is its own transaction and commits immediately. So a voice-story insert with no take, done as a lone statement, fails at THAT statement's commit — you do not need the enclosing test to end. Any fixture that builds a voice story + its take as two separate `await db.insert(...)` calls must wrap them in ONE `db.transaction(...)`. This is why Task 2 exists and precedes Task 3.
2. **`persistTakeRecording` is the authoritative kind-flipper** (contract §3.3, amended). The first `story_recordings` insert onto a `kind='text'` draft MUST flip `kind→voice` in the SAME tx, or the biconditional is violated at that tx's commit — before `appendVoiceTakeContribution` ever runs.
3. **The trigger function must tolerate a deleted story** (whole-draft discard deletes `story_recordings` rows and the `stories` row in one tx; at commit the story is gone → nothing to enforce → return without raising).

## Task order & rationale

1. **Task 1** — Schema FK (additive; safe under old invariant).
2. **Task 2** — Fixture prep: seed take-0 co-transactionally in shared fixtures. Keeps the whole suite green under the OLD invariant, so Task 3's trigger doesn't cause a red avalanche.
3. **Task 3** — The kind/recording biconditional invariant (new CHECK + deferred trigger; rewrite `story-kind-check.test.ts`).
4. **Task 4** — `persistTakeRecording` flips kind text→voice (unblocks the typed-first→voice path the core write fns need).
5. **Task 5** — Media-delete guard hardening (fork #2).
6. **Task 6** — `appendVoiceTakeContribution`.
7. **Task 7** — `appendTypedTakeContribution`.
8. **Task 8** — `finishDraft`.
9. **Task 9** — `logPolish`.
10. **Task 10** — Regeneration guard + wire into `applyTranscriptCorrection`.

Every task ends green. After Task 10, run `pnpm -r test` + `pnpm -r typecheck` from repo root.

---

## Task 1: Schema — `prose_revisions.storyRecordingId` FK

**Files:**
- Modify: `packages/db/src/schema.ts` (the `proseRevisions` table, ~line 491-515)
- Modify: `packages/core/src/story-repository.ts` (`AppendProseRevisionInput` ~line 962, `appendProseRevision` ~line 971)
- Generate: `packages/db/drizzle/schema.sql` (via `db:generate` — do NOT hand-edit)
- Test: `packages/db/test/prose-revisions.test.ts` (add cases)

- [ ] **Step 1: Write the failing test** — append to `packages/db/test/prose-revisions.test.ts` (inside its top-level `describe`, or a new one). This asserts the FK column exists, accepts a valid `story_recordings.id`, accepts null, and rejects a bogus uuid.

```ts
// NOTE: this file's existing `makeStory` helper must already seed a take-0 row after Task 2.
// For THIS test, create the story + take via persistRecordingAndCreateDraft-style setup so a
// real story_recordings row id is available. If the file has no such helper, add one:
import { media, persons, stories, storyRecordings, proseRevisions } from "../src/schema";

async function makeVoiceStoryWithTake(db: Database, ownerPersonId: string) {
  return db.transaction(async (tx) => {
    const [rec] = await tx.insert(media).values({
      ownerPersonId, kind: "story_audio",
      storageKey: `s3://b/${crypto.randomUUID()}.wav`, contentType: "audio/wav", checksum: "c",
    }).returning();
    const [story] = await tx.insert(stories).values({
      ownerPersonId, kind: "voice", recordingMediaId: rec!.id,
    }).returning();
    const [take] = await tx.insert(storyRecordings).values({
      storyId: story!.id, position: 0, mediaId: rec!.id,
    }).returning();
    return { story: story!, take: take! };
  });
}

describe("prose_revisions.story_recording_id FK (ADR-0014 §2)", () => {
  it("accepts a row keyed to a real story_recordings id", async () => {
    const narrator = await makePerson(); // existing file helper
    const { story, take } = await makeVoiceStoryWithTake(db, narrator.id);
    const [row] = await db.insert(proseRevisions).values({
      storyId: story.id, level: "ai_cleaned", text: "cleaned",
      storyRecordingId: take.id,
    }).returning();
    expect(row!.storyRecordingId).toBe(take.id);
  });

  it("accepts a null story_recording_id (holistic / typed rows)", async () => {
    const narrator = await makePerson();
    const { story } = await makeVoiceStoryWithTake(db, narrator.id);
    const [row] = await db.insert(proseRevisions).values({
      storyId: story.id, level: "ai_polished", text: "polished", storyRecordingId: null,
    }).returning();
    expect(row!.storyRecordingId).toBeNull();
  });

  it("rejects a story_recording_id that references no take", async () => {
    const narrator = await makePerson();
    const { story } = await makeVoiceStoryWithTake(db, narrator.id);
    await expect(
      db.insert(proseRevisions).values({
        storyId: story.id, level: "ai_cleaned", text: "x",
        storyRecordingId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
```

If `makePerson` is not already defined in this test file, add the standard one:
```ts
async function makePerson(displayName = "Eleanor") {
  const [p] = await db.insert(persons).values({ displayName, spokenName: displayName }).returning();
  return p!;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/db exec vitest run test/prose-revisions.test.ts`
Expected: FAIL — `storyRecordingId` is not a known column (TS error) or the insert ignores it. (If TS blocks the whole file from compiling, that is the expected red.)

- [ ] **Step 3: Add the column to the schema** — in `packages/db/src/schema.ts`, inside the `proseRevisions` table definition, add after `actorPersonId` (keep `AnyPgColumn` import already at line 31). `storyRecordings` is declared LATER in the file, so use the lazy typed thunk to avoid a TS circular-inference error (mirrors the `followUpDecisions` self-FK pattern):

```ts
    /** The person who produced a human_corrected revision; null for AI levels. */
    actorPersonId: uuid("actor_person_id").references(() => persons.id),
    /**
     * ADR-0014 §2: the audio take this row derives from, for PER-TAKE automatic levels
     * (ai_transcribed / ai_cleaned). NULL for holistic rows (ai_polished, human_corrected) and
     * for typed takes (user_authored). A nullable FK — "not tied to one audio take".
     */
    storyRecordingId: uuid("story_recording_id").references(
      (): AnyPgColumn => storyRecordings.id,
    ),
```

- [ ] **Step 4: Thread it through the core append helper** — in `packages/core/src/story-repository.ts`, extend `AppendProseRevisionInput` and `appendProseRevision`:

```ts
export interface AppendProseRevisionInput {
  storyId: string;
  level: ProseRevisionLevel;
  text: string;
  modelId?: string | null;
  promptText?: string | null;
  actorPersonId?: string | null;
  /** ADR-0014 §2: the audio take this row derives from (per-take automatic levels). */
  storyRecordingId?: string | null;
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
      storyRecordingId: input.storyRecordingId ?? null,
    })
    .returning();
  return row!;
}
```

- [ ] **Step 5: Regenerate `schema.sql`**

Run: `pnpm --filter @chronicle/db db:generate`
Expected: prints `wrote .../drizzle/schema.sql (... lines of DDL)`; the diff shows a new `story_recording_id uuid` column + FK on `prose_revisions`.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @chronicle/db exec vitest run test/prose-revisions.test.ts` → PASS
Run: `pnpm --filter @chronicle/db typecheck && pnpm --filter @chronicle/core typecheck` → clean

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/schema.sql packages/core/src/story-repository.ts packages/db/test/prose-revisions.test.ts
git commit -m "feat(db): add prose_revisions.story_recording_id FK (ADR-0014 Inc 2 §2)"
```

---

## Task 2: Fixture prep — seed take-0 co-transactionally

**Why first:** Task 3's deferred trigger will reject any voice story that lacks a take. The shared fixtures below create voice stories as bare (non-transactional) inserts with no take. Fixing them NOW — while the OLD invariant is still in place — keeps the entire suite green through Task 3. Adding a take-0 row does not violate the OLD CHECK (which only constrains `recording_media_id`), so the suite stays green after this task too.

**Files:**
- Modify: `packages/core/test/helpers.ts` (`makeStory` ~line 81)
- Modify: `packages/db/test/invariants.test.ts` (local `makeStoryWithRecording` ~line 37 and the inline "born private + draft" insert ~line 70)
- Modify: `packages/db/test/media-immutability-consent-scoped.test.ts` (local `makeStoryWithRecording` ~line 38)
- Modify: `packages/db/test/story-recordings.test.ts` (local `makeStory` ~line 22/38)
- Modify: `packages/db/test/story-views.test.ts` (local `makeStory` ~line 28/40)
- Modify: `packages/db/test/prose-revisions.test.ts` (if a local `makeStory` exists ~line 11/27 — reconcile with the `makeVoiceStoryWithTake` you added in Task 1; prefer replacing the bare `makeStory` with the transactional one)

- [ ] **Step 1: Fix the central core fixture** — `packages/core/test/helpers.ts`, `makeStory`. Wrap the story + a take-0 `storyRecordings` insert in ONE transaction. Import `storyRecordings` from `@chronicle/db/content`.

Change the import line at the top:
```ts
import { media, stories, storyRecordings } from "@chronicle/db/content";
```

Replace the story-insert block inside `makeStory` (the `const recording = ...` through `.returning();` for the story) with a transactional create:
```ts
  const recording = await makeRecording(db, opts.ownerPersonId);
  const story = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(stories)
      .values({
        ownerPersonId: opts.ownerPersonId,
        recordingMediaId: recording.id,
        state: opts.state ?? "draft",
        audienceTier: opts.audienceTier ?? "private",
        originatingFamilyId: opts.originatingFamilyId ?? null,
        askId: opts.askId ?? null,
      })
      .returning();
    // Seed take-0 so the story satisfies the ADR-0014 kind⇔recording biconditional (Task 3).
    await tx.insert(storyRecordings).values({
      storyId: s!.id,
      position: 0,
      mediaId: recording.id,
    });
    return s!;
  });
```
Then keep the rest of `makeStory` (the `withApprovalConsent` and `targetFamilyIds` blocks) unchanged, referencing `story` (now a plain row, not `story!`). Adjust the trailing `return { story, recording };` — note the variable is now `story`, not `story!`.

- [ ] **Step 2: Fix each db-test local factory the same way.** For each file listed, wrap its story-creating helper's `stories` insert + a take-0 `storyRecordings` insert in one `db.transaction`. Pattern (adapt variable names per file):

```ts
async function makeStoryWithRecording(ownerPersonId: string) {
  const [rec] = await db.insert(media).values({
    ownerPersonId, kind: "story_audio",
    storageKey: `s3://bucket/${crypto.randomUUID()}.wav`, contentType: "audio/wav",
    durationSeconds: 60, checksum: crypto.randomUUID(),
  }).returning();
  const story = await db.transaction(async (tx) => {
    const [s] = await tx.insert(stories).values({
      ownerPersonId, recordingMediaId: rec!.id,
    }).returning();
    await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec!.id });
    return s!;
  });
  return { recording: rec!, story };
}
```
Add `storyRecordings` to each file's `../src/schema` import. In `invariants.test.ts`, the inline "born private + draft" insert (~line 70) that does a bare `db.insert(stories)` must likewise be wrapped so a take-0 row is created in the same tx (or refactored to call `makeStoryWithRecording`).

In `story-recordings.test.ts`: its `makeStory` currently creates a story with NO take, and separate `makeTake` calls add takes later. Give `makeStory` a take-0 row (transactional). Then any test that expects a specific number of takes must account for take-0 already existing — READ each assertion and adjust counts/positions. The `follow_up_decisions` tests there (which call only `makeStory`) simply need the take-0 to exist; they don't assert take counts.

- [ ] **Step 3: Run the full test suite (still under OLD invariant)**

Run: `pnpm -r test`
Expected: PASS across all packages. If `story-recordings.test.ts` count assertions fail, fix the expected positions/counts to include take-0.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/helpers.ts packages/db/test/invariants.test.ts packages/db/test/media-immutability-consent-scoped.test.ts packages/db/test/story-recordings.test.ts packages/db/test/story-views.test.ts packages/db/test/prose-revisions.test.ts
git commit -m "test(db): seed take-0 co-transactionally in shared story fixtures (ADR-0014 Inc 2 prep)"
```

---

## Task 3: The kind/recording biconditional invariant

**Files:**
- Modify: `packages/db/drizzle/invariants.sql` (replace the `stories_kind_recording_ck` block ~line 161-170)
- Rewrite: `packages/db/test/story-kind-check.test.ts`
- (No schema.sql change — CHECK/trigger DDL lives only in the hand-maintained invariants.sql.)

- [ ] **Step 1: Write the new failing tests** — replace the whole body of `packages/db/test/story-kind-check.test.ts` with the new semantics. Helpers create a real narrator + media; assertions exercise both the single-table CHECK and the deferred trigger.

```ts
/**
 * ADR-0014 §3 — the kind ⇔ recording invariant for MIXED drafts.
 *   - single-table CHECK: NOT (kind='text' AND recording_media_id IS NOT NULL)
 *   - deferred constraint trigger: (kind='voice') ⟺ (≥1 story_recordings row), checked at COMMIT.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { media, persons, stories, storyRecordings } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => { db = await createTestDatabase(); });

async function makePerson(displayName = "Eleanor") {
  const [p] = await db.insert(persons).values({ displayName, spokenName: displayName }).returning();
  return p!;
}
async function makeRecording(ownerPersonId: string) {
  const [rec] = await db.insert(media).values({
    ownerPersonId, kind: "story_audio",
    storageKey: `s3://bucket/${crypto.randomUUID()}.wav`, contentType: "audio/wav",
    durationSeconds: 60, checksum: crypto.randomUUID(),
  }).returning();
  return rec!;
}

describe("single-table CHECK: text ⇒ no recording pointer", () => {
  it("rejects a 'text' story that carries a recording pointer", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    await expect(
      db.insert(stories).values({ ownerPersonId: narrator.id, kind: "text", recordingMediaId: rec.id }),
    ).rejects.toThrow(/check|text.*recording|recording.*text/i);
  });

  it("accepts a 'text' story with a NULL pointer and no take", async () => {
    const narrator = await makePerson();
    const [story] = await db.insert(stories).values({
      ownerPersonId: narrator.id, kind: "text", recordingMediaId: null,
      transcript: "I was born on Cherry Street.",
    }).returning();
    expect(story!.kind).toBe("text");
  });
});

describe("deferred biconditional: voice ⟺ ≥1 story_recordings row", () => {
  it("rejects a lone voice story with no take (fails at commit)", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    // Bare insert = its own autocommit tx; the deferred trigger fires at that commit.
    await expect(
      db.insert(stories).values({ ownerPersonId: narrator.id, kind: "voice", recordingMediaId: rec.id }),
    ).rejects.toThrow(/kind|recording|invariant|restrict/i);
  });

  it("accepts a voice story + take-0 created in ONE transaction", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    const story = await db.transaction(async (tx) => {
      const [s] = await tx.insert(stories).values({
        ownerPersonId: narrator.id, kind: "voice", recordingMediaId: rec.id,
      }).returning();
      await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec.id });
      return s!;
    });
    expect(story.kind).toBe("voice");
  });

  it("rejects a text story that gets a stray take (text ⟺ no takes)", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    const [textStory] = await db.insert(stories).values({
      ownerPersonId: narrator.id, kind: "text", recordingMediaId: null,
    }).returning();
    // A take on a text story violates the biconditional at commit of THIS bare insert.
    await expect(
      db.insert(storyRecordings).values({ storyId: textStory!.id, position: 0, mediaId: rec.id }),
    ).rejects.toThrow(/kind|recording|invariant|restrict/i);
  });

  it("permits flipping text→voice + inserting the first take in ONE tx", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    const [textStory] = await db.insert(stories).values({
      ownerPersonId: narrator.id, kind: "text", recordingMediaId: null,
    }).returning();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(storyRecordings).values({ storyId: textStory!.id, position: 0, mediaId: rec.id });
        await tx.update(stories).set({ kind: "voice" }).where(eqId(textStory!.id));
      }),
    ).resolves.not.toThrow();
  });
});

// tiny local eq helper to avoid importing drizzle `eq` twice; or just import { eq } and use eq(stories.id, id)
import { eq } from "drizzle-orm";
function eqId(id: string) { return eq(stories.id, id); }
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm --filter @chronicle/db exec vitest run test/story-kind-check.test.ts`
Expected: FAIL — the "lone voice story with no take" and "stray take on text" cases still succeed (no trigger yet); the text-pointer CHECK message may differ.

- [ ] **Step 3: Replace the DDL in `invariants.sql`** — remove the old `stories_kind_recording_ck` block (the `ALTER TABLE stories ADD CONSTRAINT stories_kind_recording_ck CHECK (...)` at ~line 167-170 plus its comment header ~161-166) and replace with:

```sql
-- ---------------------------------------------------------------------------
-- (1f) ADR-0014 §3: the kind ⇔ recording invariant for MIXED drafts (supersedes the ADR-0007
--      take-0-only CHECK). A draft is a live composition of interleaved voice + typed takes;
--      "any audio ⇒ voice". Enforced in two parts:
--        (a) a single-table CHECK for the text-half (needs no cross-table lookup);
--        (b) a DEFERRABLE INITIALLY DEFERRED constraint trigger for the voice biconditional,
--            checked at COMMIT so the audited repo may, within one tx, insert the first take and
--            flip kind in either order.
-- ---------------------------------------------------------------------------

-- (a) text ⇒ no canonical recording pointer. (voice MAY have a NULL pointer — a typed-first draft
--     that later gets a voice take keeps recording_media_id = NULL; its audio is the take set.)
ALTER TABLE stories ADD CONSTRAINT stories_text_no_recording_ck CHECK (
  NOT (kind = 'text' AND recording_media_id IS NOT NULL)
);

-- (b) The biconditional (kind = 'voice') ⟺ (EXISTS a story_recordings row for the story).
--     Deferred to COMMIT. The function is shared by triggers on BOTH stories and story_recordings
--     and re-derives the affected story id from whichever table fired. If the story no longer
--     exists (whole-draft discard deletes its takes AND the story in one tx), there is nothing to
--     enforce — return cleanly.
CREATE OR REPLACE FUNCTION chronicle_story_kind_recording_biconditional()
RETURNS trigger AS $$
DECLARE
  v_story_id uuid;
  v_kind story_kind;
  v_has_recording boolean;
BEGIN
  IF TG_TABLE_NAME = 'stories' THEN
    v_story_id := NEW.id;              -- fired on stories INSERT/UPDATE
  ELSE
    v_story_id := COALESCE(NEW.story_id, OLD.story_id);  -- story_recordings INSERT/DELETE
  END IF;

  SELECT kind INTO v_kind FROM stories WHERE id = v_story_id;
  IF NOT FOUND THEN
    RETURN NULL;  -- story deleted in this tx (discard); nothing to enforce.
  END IF;

  v_has_recording := EXISTS (SELECT 1 FROM story_recordings WHERE story_id = v_story_id);

  IF (v_kind = 'voice') <> v_has_recording THEN
    RAISE EXCEPTION
      'story % violates the ADR-0014 kind/recording invariant: kind=%, has_recording=% (voice ⟺ ≥1 story_recordings row)',
      v_story_id, v_kind, v_has_recording
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NULL;  -- AFTER trigger: return value ignored.
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER stories_kind_recording_biconditional
  AFTER INSERT OR UPDATE ON stories
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_kind_recording_biconditional();

CREATE CONSTRAINT TRIGGER story_recordings_kind_recording_biconditional
  AFTER INSERT OR DELETE ON story_recordings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_kind_recording_biconditional();
```

- [ ] **Step 4: Run the new tests → GREEN**

Run: `pnpm --filter @chronicle/db exec vitest run test/story-kind-check.test.ts`
Expected: PASS. If `CREATE CONSTRAINT TRIGGER ... DEFERRABLE` errors in PGlite, STOP — this is the load-bearing assumption; report it (the fallback is a non-deferred AFTER trigger plus repo write-ordering, which changes the plan).

- [ ] **Step 5: Run the whole suite (fixtures from Task 2 must keep it green)**

Run: `pnpm -r test`
Expected: PASS. Any remaining red is a fixture still creating a voice story without a take — fix it the Task 2 way.

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle/invariants.sql packages/db/test/story-kind-check.test.ts
git commit -m "feat(db): mixed-draft kind/recording biconditional trigger (ADR-0014 Inc 2 §3)"
```

---

## Task 4: `persistTakeRecording` flips kind text→voice (co-transactional)

**Files:**
- Modify: `packages/core/src/story-repository.ts` (`persistTakeRecording` ~line 1232-1262)
- Test: `packages/core/test/story-recordings-repo.test.ts`

- [ ] **Step 1: Write the failing test** — add to `packages/core/test/story-recordings-repo.test.ts`. Uses `createTextDraft` (a text story, no takes) then `persistTakeRecording` for the first voice take; asserts kind flipped and the commit succeeded.

```ts
import { createTextDraft, persistTakeRecording, persistRecordingAndCreateDraft } from "../src/story-repository";
import { stories } from "@chronicle/db/content";
import { eq } from "drizzle-orm";

it("flips kind text→voice when the first take is appended to a typed-first draft", async () => {
  const narrator = await makePerson(db, "Eleanor"); // existing helper style in this file
  const { story } = await createTextDraft(db, { ownerPersonId: narrator.id, text: "I typed this first." });
  expect(story.kind).toBe("text");

  const { storyRecording } = await persistTakeRecording(
    db,
    { ownerPersonId: narrator.id, storageKey: "s3://b/take0.wav", contentType: "audio/wav", checksum: "c" },
    story.id,
  );
  expect(storyRecording.position).toBe(0);

  const [after] = await db.select().from(stories).where(eq(stories.id, story.id));
  expect(after!.kind).toBe("voice");
  // recording_media_id stays NULL for a typed-first draft (contract §3: pointer is not re-aimed).
  expect(after!.recordingMediaId).toBeNull();
});

it("leaves kind=voice unchanged when appending a follow-up take to a voice story", async () => {
  const narrator = await makePerson(db, "Sal");
  const { story } = await persistRecordingAndCreateDraft(
    db,
    { ownerPersonId: narrator.id, storageKey: "s3://b/v0.wav", contentType: "audio/wav", checksum: "c0" },
  );
  const { storyRecording } = await persistTakeRecording(
    db,
    { ownerPersonId: narrator.id, storageKey: "s3://b/v1.wav", contentType: "audio/wav", checksum: "c1" },
    story.id,
  );
  expect(storyRecording.position).toBe(1);
  const [after] = await db.select().from(stories).where(eq(stories.id, story.id));
  expect(after!.kind).toBe("voice");
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm --filter @chronicle/core exec vitest run test/story-recordings-repo.test.ts -t "flips kind"`
Expected: FAIL — the first-take insert on a text story throws the biconditional violation at commit (because `persistTakeRecording` does not yet flip kind).

- [ ] **Step 3: Make `persistTakeRecording` flip kind in its tx** — modify the function so that, when the story is currently `kind='text'` and this is its first take, it flips `kind→voice` in the SAME transaction, BEFORE the tx commits. Read the story's current kind inside the tx:

```ts
export async function persistTakeRecording(
  db: Database,
  recording: RecordingInput,
  storyId: string,
): Promise<{ recording: Media; storyRecording: StoryRecording }> {
  return db.transaction(async (tx) => {
    const [rec] = await tx
      .insert(media)
      .values({
        ownerPersonId: recording.ownerPersonId,
        kind: "story_audio",
        storageKey: recording.storageKey,
        contentType: recording.contentType,
        durationSeconds: recording.durationSeconds ?? null,
        checksum: recording.checksum,
      })
      .returning();
    const existing = await tx
      .select({ position: storyRecordings.position })
      .from(storyRecordings)
      .where(eq(storyRecordings.storyId, storyId))
      .orderBy(desc(storyRecordings.position))
      .limit(1);
    const nextPosition = (existing[0]?.position ?? -1) + 1;
    const [row] = await tx
      .insert(storyRecordings)
      .values({ storyId, position: nextPosition, mediaId: rec!.id })
      .returning();
    // ADR-0014 §3.3 (amended): the FIRST take on a typed-first (kind='text') draft flips
    // kind→voice CO-TRANSACTIONALLY, so the deferred biconditional holds at THIS commit. The
    // recording_media_id pointer is NOT re-aimed (it stays NULL — the take set is the audio).
    if (nextPosition === 0) {
      const [current] = await tx
        .select({ kind: stories.kind })
        .from(stories)
        .where(eq(stories.id, storyId))
        .limit(1);
      if (current && current.kind === "text") {
        await tx.update(stories).set({ kind: "voice", updatedAt: new Date() }).where(eq(stories.id, storyId));
      }
    }
    return { recording: rec!, storyRecording: row! };
  });
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `pnpm --filter @chronicle/core exec vitest run test/story-recordings-repo.test.ts`
Expected: PASS (both new cases + all pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/test/story-recordings-repo.test.ts
git commit -m "feat(core): persistTakeRecording flips kind text→voice on first take (ADR-0014 Inc 2)"
```

---

## Task 5: Media-delete guard hardening (fork #2)

**Files:**
- Modify: `packages/db/drizzle/invariants.sql` (`chronicle_media_delete_guard`, add check (c) after check (b) ~line 94-103)
- Test: `packages/db/test/media-immutability-consent-scoped.test.ts` (add a regression case)

- [ ] **Step 1: Write the failing regression test** — add to `packages/db/test/media-immutability-consent-scoped.test.ts`. A consented voice story with a FOLLOW-UP take (position 1); deleting that take's media must raise. (Today it slips through: check (a) approval-ref = no; check (b) recording_media_id = take-0, not take-1.)

```ts
import { storyRecordings } from "../src/schema"; // add to imports if absent

describe("test 6 — consented story's follow-up-take media (ADR-0014 fork #2): DELETE raises", () => {
  it("rejects DELETE of a position≥1 take's media when the story has consent", async () => {
    const narrator = await makePerson();
    const { recording: rec0, story } = await makeStoryWithRecording(narrator.id); // now seeds take-0
    // Add a follow-up take (position 1) with its own media, in one tx (kind already voice).
    const rec1 = (await db.insert(media).values({
      ownerPersonId: narrator.id, kind: "story_audio",
      storageKey: `s3://b/${crypto.randomUUID()}.wav`, contentType: "audio/wav", checksum: crypto.randomUUID(),
    }).returning())[0]!;
    await db.insert(storyRecordings).values({ storyId: story.id, position: 1, mediaId: rec1.id });
    // Consent the story.
    await db.insert(consentRecords).values({
      personId: narrator.id, actorPersonId: narrator.id, storyId: story.id,
      action: "approved_for_sharing", resultingState: "shared",
    });
    // Take-1's media must now be un-deletable.
    await expect(db.delete(media).where(eq(media.id, rec1.id))).rejects.toThrow(/immutable|restrict|consent/i);
    // (Regression companion: take-0 media still protected via check (b).)
    await expect(db.delete(media).where(eq(media.id, rec0.id))).rejects.toThrow(/immutable|restrict|consent/i);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm --filter @chronicle/db exec vitest run test/media-immutability-consent-scoped.test.ts -t "fork #2"`
Expected: FAIL — the take-1 media delete currently succeeds (no guard covers position≥1 takes).

- [ ] **Step 3: Add check (c) to the guard** — in `chronicle_media_delete_guard`, after the existing check (b) block and before `RETURN OLD;`:

```sql
  -- DELETE: check (c) — ADR-0014 fork #2. Is this media referenced by ANY story_recordings take
  -- whose owning story has a consent record? Protects position ≥ 1 follow-up takes AND typed-first
  -- mixed-take audio (which check (b)'s recording_media_id pointer never covers). Closes the
  -- silent-audio-loss gap for consented multi-take stories.
  IF EXISTS (
    SELECT 1 FROM story_recordings sr
    INNER JOIN consent_records cr ON cr.story_id = sr.story_id
    WHERE sr.media_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Cannot delete media %: it backs a take of a story with consent records. Consented take audio is immutable forever.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
```

- [ ] **Step 4: Run to verify GREEN + no regressions**

Run: `pnpm --filter @chronicle/db exec vitest run test/media-immutability-consent-scoped.test.ts` → PASS
Run: `pnpm --filter @chronicle/core exec vitest run test/discard-draft.test.ts` → PASS (dropStoryRecording deletes the take row before the media row within one tx, so check (c) sees no take for a pre-consent drop; discard deletes the whole never-consented story).

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/invariants.sql packages/db/test/media-immutability-consent-scoped.test.ts
git commit -m "feat(db): protect consented follow-up/mixed-take audio in media delete-guard (ADR-0014 Inc 2 fork #2)"
```

---

## Task 6: `appendVoiceTakeContribution`

**Files:**
- Modify: `packages/core/src/story-repository.ts` (add near the multi-take section ~after line 1262)
- Test: `packages/core/test/composing-write-path.test.ts` (CREATE)

**Contract (§4):** Persists `ai_transcribed(rawTranscript, storyRecordingId)` + `ai_cleaned(cleanedSegment, storyRecordingId)`; sets `stories.prose` to the concatenation of prior text + cleaned segment; asserts `kind='voice'` idempotently (persistTakeRecording is the authoritative flipper); owner + `state='draft'` gated. Returns `{ prose, appendedSegment }`.

- [ ] **Step 1: Write the failing test** — CREATE `packages/core/test/composing-write-path.test.ts`. (This file will host Tasks 6-9.) Use `createTestDatabase`, `makePerson` (local), `persistRecordingAndCreateDraft`, `persistTakeRecording`, `updateStoryRecordingTranscript`, `listProseRevisions`.

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { stories } from "@chronicle/db/content";
import {
  persistRecordingAndCreateDraft, persistTakeRecording, createTextDraft,
  appendVoiceTakeContribution, listProseRevisions,
} from "../src/story-repository";

let db: Database;
beforeEach(async () => { db = await createTestDatabase(); });

async function makePerson(name = "Eleanor") {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!;
}

describe("appendVoiceTakeContribution (ADR-0014 §4)", () => {
  it("appends ai_transcribed + ai_cleaned keyed to the take, and concatenates prose", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    // take-0 already exists (position 0); fetch its id.
    const takeRows = await listStoryRecordingsLocal(db, story.id);
    const take0 = takeRows[0]!;

    const res = await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "um so i was born in naples",
      cleanedSegment: "I was born in Naples.",
      transcribeModelId: "whisper-1", cleanupModelId: "claude-x", cleanupPromptText: "cleanup v1",
      priorProse: null,
    });
    expect(res.prose).toBe("I was born in Naples.");
    expect(res.appendedSegment).toBe("I was born in Naples.");

    const revs = await listProseRevisions(db, story.id);
    const transcribed = revs.find((r) => r.level === "ai_transcribed")!;
    const cleaned = revs.find((r) => r.level === "ai_cleaned")!;
    expect(transcribed.text).toBe("um so i was born in naples");
    expect(transcribed.storyRecordingId).toBe(take0.id);
    expect(transcribed.modelId).toBe("whisper-1");
    expect(cleaned.text).toBe("I was born in Naples.");
    expect(cleaned.storyRecordingId).toBe(take0.id);
    expect(cleaned.modelId).toBe("claude-x");
    expect(cleaned.promptText).toBe("cleanup v1");

    const [s] = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(s!.prose).toBe("I was born in Naples.");
  });

  it("concatenates onto prior editor text with a blank-line separator", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    const res = await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw two", cleanedSegment: "Second segment.",
      transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p",
      priorProse: "First segment.",
    });
    expect(res.prose).toBe("First segment.\n\nSecond segment.");
  });

  it("flips a typed-first draft's kind idempotently (after persistTakeRecording already flipped it)", async () => {
    const narrator = await makePerson();
    const { story } = await createTextDraft(db, { ownerPersonId: narrator.id, text: "Typed opener." });
    const { storyRecording } = await persistTakeRecording(db,
      { ownerPersonId: narrator.id, storageKey: "s3://b/t.wav", contentType: "audio/wav", checksum: "c" },
      story.id);
    const res = await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: storyRecording.id,
      rawTranscript: "raw", cleanedSegment: "Voice add.",
      transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p",
      priorProse: "Typed opener.",
    });
    expect(res.prose).toBe("Typed opener.\n\nVoice add.");
    const [s] = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(s!.kind).toBe("voice");
  });

  it("rejects a non-owner", async () => {
    const narrator = await makePerson("Owner");
    const intruder = await makePerson("Intruder");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await expect(appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: intruder.id, storyRecordingId: take0.id,
      rawTranscript: "r", cleanedSegment: "c", transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p",
      priorProse: null,
    })).rejects.toThrow(/owner/i);
  });

  it("rejects when the story is not in draft state", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    // Move out of draft via the audited transition path.
    const { transitionStoryState } = await import("../src/story-repository");
    await transitionStoryState(db, story.id, "pending_approval");
    await expect(appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "r", cleanedSegment: "c", transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p",
      priorProse: null,
    })).rejects.toThrow(/draft/i);
  });
});

// Local read helper (avoids depending on listStoryRecordings signature drift).
import { listStoryRecordings } from "../src/story-repository";
async function listStoryRecordingsLocal(db: Database, storyId: string) {
  return listStoryRecordings(db, storyId);
}
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm --filter @chronicle/core exec vitest run test/composing-write-path.test.ts`
Expected: FAIL — `appendVoiceTakeContribution` is not exported.

- [ ] **Step 3: Implement** — add to `packages/core/src/story-repository.ts` (place after `persistTakeRecording`, or near the prose-revision helpers). Helper for the blank-line join keeps prose concatenation DRY across Tasks 6-7:

```ts
/** Concatenate a new segment onto prior working prose with a blank-line separator, skipping
 *  empty parts (ADR-0014: an empty Cleanup segment is a no-op, not a stray blank line). */
function concatProse(priorProse: string | null, segment: string): string {
  return [priorProse ?? "", segment]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/**
 * Append the provenance + working-prose for a freshly recorded & cleaned VOICE take (ADR-0014 §4).
 * The media + story_recordings row already exist (persistTakeRecording, which also flipped kind
 * text→voice co-transactionally on the first take). LM ran in the caller — core stays vendor-free.
 * Owner + state='draft' gated. Returns the new full prose + the appended segment.
 */
export async function appendVoiceTakeContribution(
  db: Database,
  input: {
    storyId: string;
    ownerPersonId: string;
    storyRecordingId: string;
    rawTranscript: string;
    cleanedSegment: string;
    transcribeModelId: string;
    cleanupModelId: string;
    cleanupPromptText: string;
    priorProse: string | null;
  },
): Promise<{ prose: string; appendedSegment: string }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state, kind: stories.kind })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) throw new InvariantViolation(`appendVoiceTakeContribution: story ${input.storyId} not found`);
    if (current.ownerPersonId !== input.ownerPersonId) {
      throw new InvariantViolation(
        `appendVoiceTakeContribution: actor ${input.ownerPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "draft") {
      throw new InvariantViolation(
        `appendVoiceTakeContribution: story must be draft (was ${current.state})`,
      );
    }

    await tx.insert(proseRevisions).values({
      storyId: input.storyId, level: "ai_transcribed", text: input.rawTranscript,
      modelId: input.transcribeModelId, promptText: null, actorPersonId: null,
      storyRecordingId: input.storyRecordingId,
    });
    await tx.insert(proseRevisions).values({
      storyId: input.storyId, level: "ai_cleaned", text: input.cleanedSegment,
      modelId: input.cleanupModelId, promptText: input.cleanupPromptText, actorPersonId: null,
      storyRecordingId: input.storyRecordingId,
    });

    const prose = concatProse(input.priorProse, input.cleanedSegment);
    // Defense-in-depth: ensure kind='voice' (persistTakeRecording is the authoritative flipper).
    await tx
      .update(stories)
      .set({ prose, kind: "voice", updatedAt: new Date() })
      .where(eq(stories.id, input.storyId));

    return { prose, appendedSegment: input.cleanedSegment };
  });
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `pnpm --filter @chronicle/core exec vitest run test/composing-write-path.test.ts`
Expected: PASS (all `appendVoiceTakeContribution` cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/test/composing-write-path.test.ts
git commit -m "feat(core): appendVoiceTakeContribution — per-take voice provenance + prose (ADR-0014 Inc 2 §4)"
```

---

## Task 7: `appendTypedTakeContribution`

**Files:**
- Modify: `packages/core/src/story-repository.ts`
- Test: `packages/core/test/composing-write-path.test.ts` (add a `describe`)

**Contract (§4):** Appends `user_authored(text, storyRecordingId=null)`; concatenates prose; does NOT create a `story_recordings` row and does NOT change kind. Owner + `state='draft'` gated. Empty text is rejected (consistent with `createTextDraft`).

- [ ] **Step 1: Write the failing test** — add to `composing-write-path.test.ts`:

```ts
import { appendTypedTakeContribution } from "../src/story-repository";

describe("appendTypedTakeContribution (ADR-0014 §4)", () => {
  it("appends user_authored keyed to the narrator, concatenates prose, leaves kind unchanged", async () => {
    const narrator = await makePerson();
    const { story } = await createTextDraft(db, { ownerPersonId: narrator.id, text: "Opener." });
    const res = await appendTypedTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, text: "Second typed part.", priorProse: "Opener.",
    });
    expect(res.prose).toBe("Opener.\n\nSecond typed part.");
    expect(res.appendedSegment).toBe("Second typed part.");

    const revs = await listProseRevisions(db, story.id);
    const authored = revs.filter((r) => r.level === "user_authored");
    // createTextDraft wrote one; this appended a second.
    expect(authored.length).toBe(2);
    const latest = authored[authored.length - 1]!;
    expect(latest.text).toBe("Second typed part.");
    expect(latest.actorPersonId).toBe(narrator.id);
    expect(latest.storyRecordingId).toBeNull();

    const [s] = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(s!.kind).toBe("text"); // unchanged — a typed take does not make it voice
    const takes = await listStoryRecordingsLocal(db, story.id);
    expect(takes.length).toBe(0); // no story_recordings row created
  });

  it("rejects empty/whitespace text", async () => {
    const narrator = await makePerson();
    const { story } = await createTextDraft(db, { ownerPersonId: narrator.id, text: "Opener." });
    await expect(appendTypedTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, text: "   ", priorProse: "Opener.",
    })).rejects.toThrow(/non-empty|empty/i);
  });

  it("rejects a non-owner and a non-draft story", async () => {
    const narrator = await makePerson("Owner");
    const intruder = await makePerson("Intruder");
    const { story } = await createTextDraft(db, { ownerPersonId: narrator.id, text: "Opener." });
    await expect(appendTypedTakeContribution(db, {
      storyId: story.id, ownerPersonId: intruder.id, text: "x", priorProse: null,
    })).rejects.toThrow(/owner/i);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @chronicle/core exec vitest run test/composing-write-path.test.ts -t "appendTypedTakeContribution"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * Append a TYPED take (ADR-0014 §4/§6): user_authored(text) with no audio, no story_recordings row,
 * no kind change (a typed take never makes a story voice). Owner + state='draft' gated.
 */
export async function appendTypedTakeContribution(
  db: Database,
  input: { storyId: string; ownerPersonId: string; text: string; priorProse: string | null },
): Promise<{ prose: string; appendedSegment: string }> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new InvariantViolation("appendTypedTakeContribution: a typed take must have non-empty text");
  }
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) throw new InvariantViolation(`appendTypedTakeContribution: story ${input.storyId} not found`);
    if (current.ownerPersonId !== input.ownerPersonId) {
      throw new InvariantViolation(
        `appendTypedTakeContribution: actor ${input.ownerPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "draft") {
      throw new InvariantViolation(
        `appendTypedTakeContribution: story must be draft (was ${current.state})`,
      );
    }
    await tx.insert(proseRevisions).values({
      storyId: input.storyId, level: "user_authored", text,
      modelId: null, promptText: null, actorPersonId: input.ownerPersonId, storyRecordingId: null,
    });
    const prose = concatProse(input.priorProse, text);
    await tx.update(stories).set({ prose, updatedAt: new Date() }).where(eq(stories.id, input.storyId));
    return { prose, appendedSegment: text };
  });
}
```

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @chronicle/core exec vitest run test/composing-write-path.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/test/composing-write-path.test.ts
git commit -m "feat(core): appendTypedTakeContribution — typed take provenance + prose (ADR-0014 Inc 2 §4)"
```

---

## Task 8: `finishDraft`

**Files:**
- Modify: `packages/core/src/story-repository.ts`
- Test: `packages/core/test/composing-write-path.test.ts` (add a `describe`)

**Contract (§4):** `finalText` = the client's final editor text; `metadata` already derived by the caller (core stays LM-free). If `finalText !== current stories.prose`, update prose + append `human_corrected(finalText)`. Persist title/summary/tags. Transition `draft → pending_approval` (via `assertStoryTransition`). Owner + `state='draft'` gated. NEVER clears prose (reject empty `finalText`).

- [ ] **Step 1: Write the failing test**

```ts
import { finishDraft } from "../src/story-repository";

describe("finishDraft (ADR-0014 §4)", () => {
  it("seals an edited draft: snapshots human_corrected, writes metadata, transitions to pending_approval", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw", cleanedSegment: "Cleaned prose.",
      transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p", priorProse: null,
    });
    const finished = await finishDraft(db, {
      storyId: story.id, ownerPersonId: narrator.id,
      finalText: "Cleaned prose, then hand-edited.", // differs from current prose
      metadata: { title: "Naples", summary: "A birth in Naples.", tags: ["childhood", "italy"] },
    });
    expect(finished.state).toBe("pending_approval");
    expect(finished.prose).toBe("Cleaned prose, then hand-edited.");
    expect(finished.title).toBe("Naples");
    expect(finished.summary).toBe("A birth in Naples.");
    expect(finished.tags).toEqual(["childhood", "italy"]);

    const revs = await listProseRevisions(db, story.id);
    const corrected = revs.filter((r) => r.level === "human_corrected");
    expect(corrected.length).toBe(1);
    expect(corrected[0]!.text).toBe("Cleaned prose, then hand-edited.");
    expect(corrected[0]!.actorPersonId).toBe(narrator.id);
  });

  it("does NOT snapshot human_corrected when finalText equals current prose", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw", cleanedSegment: "Unchanged prose.",
      transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p", priorProse: null,
    });
    const finished = await finishDraft(db, {
      storyId: story.id, ownerPersonId: narrator.id, finalText: "Unchanged prose.",
      metadata: { title: "T", summary: "S", tags: [] },
    });
    expect(finished.state).toBe("pending_approval");
    const corrected = (await listProseRevisions(db, story.id)).filter((r) => r.level === "human_corrected");
    expect(corrected.length).toBe(0);
  });

  it("rejects empty finalText (never clears prose)", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    await expect(finishDraft(db, {
      storyId: story.id, ownerPersonId: narrator.id, finalText: "   ",
      metadata: { title: "T", summary: "S", tags: [] },
    })).rejects.toThrow(/empty|non-empty/i);
  });

  it("rejects a non-owner and a non-draft story", async () => {
    const narrator = await makePerson("Owner");
    const intruder = await makePerson("Intruder");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    await expect(finishDraft(db, {
      storyId: story.id, ownerPersonId: intruder.id, finalText: "x",
      metadata: { title: "T", summary: "S", tags: [] },
    })).rejects.toThrow(/owner/i);
  });
});
```

- [ ] **Step 2: Run RED** — `pnpm --filter @chronicle/core exec vitest run test/composing-write-path.test.ts -t "finishDraft"` → FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
/**
 * FINISH (ADR-0014 §4): seal composition. `finalText` is the client's final editor text; `metadata`
 * was already derived by the caller (core stays LM-free). If finalText differs from current prose,
 * update prose + append human_corrected(finalText). Persist title/summary/tags. Transition
 * draft → pending_approval (assertStoryTransition). Owner + state='draft' gated. NEVER clears prose.
 */
export async function finishDraft(
  db: Database,
  input: {
    storyId: string;
    ownerPersonId: string;
    finalText: string;
    metadata: { title: string; summary: string; tags: string[] };
  },
): Promise<Story> {
  const finalText = input.finalText.trim();
  if (finalText.length === 0) {
    throw new InvariantViolation("finishDraft: finalText must be non-empty (Finish never clears prose)");
  }
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state, prose: stories.prose })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) throw new InvariantViolation(`finishDraft: story ${input.storyId} not found`);
    if (current.ownerPersonId !== input.ownerPersonId) {
      throw new InvariantViolation(
        `finishDraft: actor ${input.ownerPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "draft") {
      throw new InvariantViolation(`finishDraft: story must be draft (was ${current.state})`);
    }

    if (current.prose !== finalText) {
      await tx.insert(proseRevisions).values({
        storyId: input.storyId, level: "human_corrected", text: finalText,
        modelId: null, promptText: null, actorPersonId: input.ownerPersonId, storyRecordingId: null,
      });
    }

    assertStoryTransition(current.state, "pending_approval");
    const [row] = await tx
      .update(stories)
      .set({
        prose: finalText,
        title: input.metadata.title,
        summary: input.metadata.summary,
        tags: input.metadata.tags,
        state: "pending_approval",
        updatedAt: new Date(),
      })
      .where(eq(stories.id, input.storyId))
      .returning();
    return row!;
  });
}
```

- [ ] **Step 4: Run GREEN** — `pnpm --filter @chronicle/core exec vitest run test/composing-write-path.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/test/composing-write-path.test.ts
git commit -m "feat(core): finishDraft — seal composition, snapshot correction, transition (ADR-0014 Inc 2 §4)"
```

---

## Task 9: `logPolish`

**Files:**
- Modify: `packages/core/src/story-repository.ts`
- Test: `packages/core/test/composing-write-path.test.ts` (add a `describe`)

**Contract (§4):** Appends `ai_polished(polishedProse, modelId, promptText)` AND updates `stories.prose`. Owner-gated; allowed in `draft` (composing) AND `pending_approval` (light review). LM ran in the caller.

- [ ] **Step 1: Write the failing test**

```ts
import { logPolish, transitionStoryState } from "../src/story-repository";

describe("logPolish (ADR-0014 §4)", () => {
  it("appends ai_polished and updates prose in draft", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw", cleanedSegment: "Rambly first draft.",
      transcribeModelId: "w", cleanupModelId: "c", cleanupPromptText: "p", priorProse: null,
    });
    const res = await logPolish(db, {
      storyId: story.id, ownerPersonId: narrator.id,
      polishedProse: "A tighter, polished draft.", modelId: "claude-polish", promptText: "polish v1",
    });
    expect(res.prose).toBe("A tighter, polished draft.");
    const polished = (await listProseRevisions(db, story.id)).filter((r) => r.level === "ai_polished");
    expect(polished.length).toBe(1);
    expect(polished[0]!.text).toBe("A tighter, polished draft.");
    expect(polished[0]!.modelId).toBe("claude-polish");
    expect(polished[0]!.promptText).toBe("polish v1");
    expect(polished[0]!.storyRecordingId).toBeNull();
  });

  it("is allowed in pending_approval too", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw", cleanedSegment: "Body.", transcribeModelId: "w", cleanupModelId: "c",
      cleanupPromptText: "p", priorProse: null,
    });
    await transitionStoryState(db, story.id, "pending_approval");
    const res = await logPolish(db, {
      storyId: story.id, ownerPersonId: narrator.id,
      polishedProse: "Polished in review.", modelId: "m", promptText: "p",
    });
    expect(res.prose).toBe("Polished in review.");
  });

  it("rejects a non-owner", async () => {
    const narrator = await makePerson("Owner");
    const intruder = await makePerson("Intruder");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    await expect(logPolish(db, {
      storyId: story.id, ownerPersonId: intruder.id, polishedProse: "x", modelId: "m", promptText: "p",
    })).rejects.toThrow(/owner/i);
  });
});
```

- [ ] **Step 2: Run RED** — `... -t "logPolish"` → FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
/**
 * Log a manual ✨ Polish tap (ADR-0014 §2/§4): append ai_polished(polishedProse) AND update
 * stories.prose. Owner-gated; allowed in 'draft' (composing) AND 'pending_approval' (light review).
 * Every tap is logged (permanent ledger row), even one later undone in the UI. LM ran in the caller.
 */
export async function logPolish(
  db: Database,
  input: {
    storyId: string;
    ownerPersonId: string;
    polishedProse: string;
    modelId: string;
    promptText: string;
  },
): Promise<Story> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!current) throw new InvariantViolation(`logPolish: story ${input.storyId} not found`);
    if (current.ownerPersonId !== input.ownerPersonId) {
      throw new InvariantViolation(
        `logPolish: actor ${input.ownerPersonId} is not the owner of story ${input.storyId}`,
      );
    }
    if (current.state !== "draft" && current.state !== "pending_approval") {
      throw new InvariantViolation(
        `logPolish: story must be draft or pending_approval (was ${current.state})`,
      );
    }
    await tx.insert(proseRevisions).values({
      storyId: input.storyId, level: "ai_polished", text: input.polishedProse,
      modelId: input.modelId, promptText: input.promptText, actorPersonId: null, storyRecordingId: null,
    });
    const [row] = await tx
      .update(stories)
      .set({ prose: input.polishedProse, updatedAt: new Date() })
      .where(eq(stories.id, input.storyId))
      .returning();
    return row!;
  });
}
```

- [ ] **Step 4: Run GREEN** — `pnpm --filter @chronicle/core exec vitest run test/composing-write-path.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/test/composing-write-path.test.ts
git commit -m "feat(core): logPolish — log every manual Polish tap + update prose (ADR-0014 Inc 2 §4)"
```

---

## Task 10: Regeneration guard + wire into `applyTranscriptCorrection`

**Files:**
- Modify: `packages/core/src/story-repository.ts` (`applyTranscriptCorrection` ~line 664-696; add a guard helper)
- Test: `packages/core/test/composing-write-path.test.ts` (add a `describe`) or extend an existing correction test

**Contract (§4):** No core path may set `stories.prose = NULL` on a story that has any `user_authored` or `human_corrected` lineage row (authored content must never be blindly regenerated — ADR-0014 §7). `applyTranscriptCorrection` is the concrete null-clearing path; guard it.

- [ ] **Step 1: Write the failing test**

```ts
import { applyTranscriptCorrection, appendTypedTakeContribution } from "../src/story-repository";

describe("regeneration guard (ADR-0014 §7)", () => {
  it("blocks applyTranscriptCorrection (which nulls prose) on a story with human_corrected lineage", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw", cleanedSegment: "Body.", transcribeModelId: "w", cleanupModelId: "c",
      cleanupPromptText: "p", priorProse: null,
    });
    // Finish with an edit → writes a human_corrected row, moves to pending_approval.
    await finishDraft(db, {
      storyId: story.id, ownerPersonId: narrator.id, finalText: "Hand-edited body.",
      metadata: { title: "T", summary: "S", tags: [] },
    });
    await expect(applyTranscriptCorrection(db, story.id, "new transcript")).rejects.toThrow(/authored|regenerat|lineage/i);
  });

  it("still allows applyTranscriptCorrection on a pure-voice story with no authored lineage", async () => {
    const narrator = await makePerson();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id, storageKey: "s3://b/0.wav", contentType: "audio/wav", checksum: "c0",
    });
    const take0 = (await listStoryRecordingsLocal(db, story.id))[0]!;
    await appendVoiceTakeContribution(db, {
      storyId: story.id, ownerPersonId: narrator.id, storyRecordingId: take0.id,
      rawTranscript: "raw", cleanedSegment: "Body.", transcribeModelId: "w", cleanupModelId: "c",
      cleanupPromptText: "p", priorProse: null,
    });
    // Move to pending_approval WITHOUT a hand-edit (no human_corrected, no user_authored rows).
    await transitionStoryState(db, story.id, "pending_approval");
    const after = await applyTranscriptCorrection(db, story.id, "corrected transcript");
    expect(after.prose).toBeNull(); // legacy voice-correction behavior preserved
    expect(after.transcript).toBe("corrected transcript");
  });
});
```

- [ ] **Step 2: Run RED** — `... -t "regeneration guard"` → FAIL (the first case currently nulls prose and succeeds).

- [ ] **Step 3: Wire the guard into `applyTranscriptCorrection`** — in `packages/core/src/story-repository.ts`, make it transactional and inline the authored-lineage check before the null-clearing update. Inlining (rather than a separate helper) avoids annotating the Drizzle transaction type; `tx` is inferred. `applyTranscriptCorrection` requires `pending_approval`.

```ts
export async function applyTranscriptCorrection(
  db: Database,
  storyId: string,
  correctedTranscript: string,
): Promise<Story> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ state: stories.state })
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1);
    if (!current) throw new Error(`story not found: ${storyId}`);
    if (current.state !== "pending_approval") {
      throw new InvariantViolation(
        `applyTranscriptCorrection: story must be pending_approval (was ${current.state})`,
      );
    }
    // ADR-0014 §7: authored prose is never blindly regenerated. Refuse to null prose when the story
    // has any user_authored or human_corrected lineage row (typed takes / hand-edits), which
    // clearing-to-re-render would silently destroy.
    const authored = await tx
      .select({ id: proseRevisions.id })
      .from(proseRevisions)
      .where(
        and(
          eq(proseRevisions.storyId, storyId),
          inArray(proseRevisions.level, ["user_authored", "human_corrected"]),
        ),
      )
      .limit(1);
    if (authored.length > 0) {
      throw new InvariantViolation(
        `applyTranscriptCorrection: story ${storyId} has authored prose lineage ` +
          `(user_authored/human_corrected); its prose is authored and must never be regenerated (ADR-0014 §7)`,
      );
    }
    const [row] = await tx
      .update(stories)
      .set({
        transcript: correctedTranscript,
        transcriptWordTimings: null,
        prose: null,
        title: null,
        summary: null,
        tags: [],
        updatedAt: new Date(),
      })
      .where(eq(stories.id, storyId))
      .returning();
    return row!;
  });
}
```

`inArray` and `and` are both already imported at the top of the file (`import { and, asc, desc, eq, inArray } from "drizzle-orm";`).

- [ ] **Step 4: Run GREEN + full core suite**

Run: `pnpm --filter @chronicle/core exec vitest run test/composing-write-path.test.ts` → PASS
Run: `pnpm --filter @chronicle/core test` → PASS (confirm `applyTranscriptCorrection`'s existing callers/tests still pass — the guard only fires on authored lineage, which legacy voice stories lack).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/test/composing-write-path.test.ts
git commit -m "feat(core): regeneration guard — never null authored prose (ADR-0014 Inc 2 §7)"
```

---

## Final verification (after Task 10)

- [ ] **Run the full monorepo suite + typecheck from repo root:**

```bash
pnpm -r test
pnpm -r typecheck
```
Expected: all green. If `pnpm -r lint` is part of CI, run it too.

- [ ] **Sanity-check the architecture test is still green** (no new content-import outside the allowlist — all new fns live in the already-allowed `story-repository.ts`):

Run: `pnpm --filter @chronicle/core exec vitest run test/architecture.test.ts` → PASS

- [ ] **Confirm no schema drift** between `schema.ts` and `schema.sql`:

Run: `pnpm --filter @chronicle/db db:generate` then `git diff --exit-code packages/db/drizzle/schema.sql`
Expected: no diff (schema.sql already regenerated in Task 1).

---

## Out of scope for Inc 2 (do NOT do here)

- Any web/UI wiring (Inc 3) or pipeline seams `cleanupTake`/`deriveMetadata` (Inc 1).
- The Finish-check detect-and-offer logic (Inc 3, layered before `finishDraft`).
- Neon reseed / schema-parity deploy step — an OPERATIONAL step done once at merge/deploy time after Inc 2 lands, NOT part of this code task.
- Retiring the old `renderStoryFromTranscript` / orchestrator render path (Inc 3).
- era/eraYear derivation (deferred per CONTEXT Timeline).

## Post-plan operational note

After this increment merges toward master, BOTH Neon branches (dev + production) must be reseeded before deploy — the `vercel.json buildCommand → db:check-parity` gate fails a deploy on schema drift. This is tracked separately (handoff §Landmines), not a task here.
