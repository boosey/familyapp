/**
 * Regression tests for discardDraftStory (ADR-0002):
 * event-driven cleanup of a never-consented draft (explicit discard / re-record supersession).
 *
 * The function must:
 *   - delete the draft Story row and its recording Media row inside one transaction;
 *   - return the recording's storageKey so the caller can best-effort delete the blob;
 *   - refuse any operation that would delete consented audio.
 *
 * Tests may import from @chronicle/db/content and @chronicle/db/schema directly — test files
 * are explicitly excluded from the architecture guard scan (they legitimately seed via the schema).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveAndShareStory,
  createAsk,
  createTextDraft,
  discardDraftStory,
  InvariantViolation,
  persistRecordingAndCreateDraft,
  transitionStoryState,
} from "../src/index";
import {
  addMembership,
  makeFamily,
  makePerson,
  targetStoryToFamily,
} from "./helpers";
import { media, stories } from "@chronicle/db/content";
import { asks, consentRecords, storyFamilies } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** Create a draft via the audited write path, returning a stable storageKey for assertions. */
async function makeDraft(ownerPersonId: string, storageKey?: string) {
  const key = storageKey ?? `r2://chronicle/rec-${Math.random()}.webm`;
  const { story, recording } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId,
    storageKey: key,
    contentType: "audio/webm",
    durationSeconds: 42,
    checksum: `sha256:${Math.random()}`,
  });
  return { story, recording, storageKey: key };
}

describe("discardDraftStory — happy path", () => {
  it("deletes both the story row and the media row inside the tx, and returns the recording storageKey", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story, recording, storageKey } = await makeDraft(narrator.id);

    const result = await discardDraftStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
    });

    // Return value contains the blob key the caller should delete from object storage.
    expect(result.storageKeys).toEqual([storageKey]);

    // Story row is gone.
    const storyRows = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, story.id));
    expect(storyRows).toHaveLength(0);

    // Media row is gone.
    const mediaRows = await db
      .select({ id: media.id })
      .from(media)
      .where(eq(media.id, recording.id));
    expect(mediaRows).toHaveLength(0);
  });
});

describe("discardDraftStory — a follow-up ask sourced from the draft (#77) does NOT block discard", () => {
  // Regression for B2 (twin of B1 on the discard path): `asks.source_story_id` referencing a draft
  // must not FK-fail the discard. The owner CAN self-ask a follow-up on their OWN draft — createAsk
  // has no owner-exclusion, its co-membership gate passes for a self-target, and getStoryForViewer
  // returns the draft (owner-sees-own-in-any-state). Full fixtures: owner + active family + a real
  // createAsk follow-up sourced at the draft. Discard must SUCCEED and the ask survive with a null
  // source link (ON DELETE SET NULL + the explicit null-out in discardDraftStory).
  it("discards the source draft and leaves the follow-up ask standing with a null source link", async () => {
    const narrator = await makePerson(db, "Eleanor");
    // createAsk's co-membership gate needs the asker+target to share an ACTIVE family; a self-ask
    // shares all of the owner's families, so one active membership suffices.
    const family = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, family.id);
    const { story: draft } = await makeDraft(narrator.id);

    const followUp = await createAsk(
      db,
      { kind: "account", personId: narrator.id },
      {
        targetPersonId: narrator.id,
        questionText: "Note to self: add the part about the dog.",
        sourceStoryId: draft.id,
      },
    );
    expect(followUp.sourceStoryId).toBe(draft.id);

    const result = await discardDraftStory(db, {
      storyId: draft.id,
      narratorPersonId: narrator.id,
    });
    expect(result.storageKeys).toHaveLength(1);

    // The draft is gone — the discard was NOT rolled back by the source-story FK.
    expect(
      await db.select({ id: stories.id }).from(stories).where(eq(stories.id, draft.id)),
    ).toHaveLength(0);

    // The follow-up ask survives as a standalone with its origin nulled out.
    const [survivor] = await db.select().from(asks).where(eq(asks.id, followUp.id));
    expect(survivor).toBeDefined();
    expect(survivor!.sourceStoryId).toBeNull();
  });
});

describe("discardDraftStory — text story (ADR-0007, null recording)", () => {
  it("discards a text draft: no media rows, returns empty storageKeys, story row gone", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story } = await createTextDraft(db, {
      ownerPersonId: narrator.id,
      text: "The summer we moved to Naples.",
    });

    const result = await discardDraftStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
    });

    // A text story owns no audio, so there is nothing for the caller to delete from storage.
    expect(result.storageKeys).toEqual([]);

    // Story row is gone.
    const storyRows = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, story.id));
    expect(storyRows).toHaveLength(0);

    // No media row was ever created for the narrator, so none leaked.
    const mediaRows = await db
      .select({ id: media.id })
      .from(media)
      .where(eq(media.ownerPersonId, narrator.id));
    expect(mediaRows).toHaveLength(0);
  });
});

describe("discardDraftStory — ownership guard", () => {
  it("refuses when narratorPersonId is not the story owner; story and media survive", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const impostor = await makePerson(db, "Ivan");
    const { story, recording } = await makeDraft(narrator.id);

    await expect(
      discardDraftStory(db, { storyId: story.id, narratorPersonId: impostor.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);

    // Story still present.
    const storyRows = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, story.id));
    expect(storyRows).toHaveLength(1);

    // Media still present.
    const mediaRows = await db
      .select({ id: media.id })
      .from(media)
      .where(eq(media.id, recording.id));
    expect(mediaRows).toHaveLength(1);
  });
});

describe("discardDraftStory — pending_approval (consent-free pre-approval window)", () => {
  it("discards a consent-free pending_approval story: deletes both rows and returns the storageKey", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story, recording, storageKey } = await makeDraft(narrator.id);

    // Advance to pending_approval — render has run, but narrator hasn't approved yet.
    await transitionStoryState(db, story.id, "pending_approval");

    const result = await discardDraftStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
    });

    expect(result.storageKeys).toEqual([storageKey]);

    // Story row is gone.
    const storyRows = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, story.id));
    expect(storyRows).toHaveLength(0);

    // Media row is gone.
    const mediaRows = await db
      .select({ id: media.id })
      .from(media)
      .where(eq(media.id, recording.id));
    expect(mediaRows).toHaveLength(0);
  });
});

describe("discardDraftStory — targeted draft (ADR-0010 regression)", () => {
  it("discards a draft that has explicit story_families targeting rows, leaving no orphan target rows", async () => {
    // Regression: story_families.story_id → stories.id is ON DELETE no action, so deleting a story
    // that still has targeting rows raises an FK violation. A pre-approval story CAN carry target
    // rows (the narrator picked families before approving via setStoryFamilyTargets). discard must
    // clear them first. Before the fix this threw a raw FK error and the draft was undeletable.
    const narrator = await makePerson(db, "Eleanor");
    const family = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, family.id);
    const { story, recording, storageKey } = await makeDraft(narrator.id);

    await transitionStoryState(db, story.id, "pending_approval");
    await targetStoryToFamily(db, story.id, family.id);

    const result = await discardDraftStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
    });
    expect(result.storageKeys).toEqual([storageKey]);

    // Story, media, AND the targeting rows are all gone — no orphan story_families row survives.
    expect(
      await db.select({ id: stories.id }).from(stories).where(eq(stories.id, story.id)),
    ).toHaveLength(0);
    expect(
      await db.select({ id: media.id }).from(media).where(eq(media.id, recording.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: storyFamilies.id })
        .from(storyFamilies)
        .where(eq(storyFamilies.storyId, story.id)),
    ).toHaveLength(0);
  });
});

describe("discardDraftStory — state guard", () => {
  it("refuses when the story is in a post-approval state (e.g. shared); the shared story's media survives", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story, recording } = await makeDraft(narrator.id);

    // Advance to pending_approval (pipeline has run), then approve → shared.
    await transitionStoryState(db, story.id, "pending_approval");
    await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
      audienceTier: "family",
      // Tap-approval (ADR-0004): no voice clip required.
    });

    await expect(
      discardDraftStory(db, { storyId: story.id, narratorPersonId: narrator.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);

    // The shared story's recording media is still present — immutable forever.
    const mediaRows = await db
      .select({ id: media.id })
      .from(media)
      .where(eq(media.id, recording.id));
    expect(mediaRows).toHaveLength(1);
  });
});

describe("discardDraftStory — consent defense-in-depth", () => {
  it(
    "refuses when a consent_records row references the story even if state is still draft; " +
      "media remains present (proves defense-in-depth check fires before the DB trigger would)",
    async () => {
      const narrator = await makePerson(db, "Eleanor");
      const { story, recording } = await makeDraft(narrator.id);

      // Inject a consent row for a story that is still technically in `draft` state.
      // This should never happen via the normal path (approveAndShareStory requires
      // pending_approval), but the domain guard must catch it regardless.
      await db.insert(consentRecords).values({
        personId: narrator.id,
        actorPersonId: narrator.id,
        storyId: story.id,
        action: "approved_for_sharing",
        resultingState: "shared",
      });

      await expect(
        discardDraftStory(db, { storyId: story.id, narratorPersonId: narrator.id }),
      ).rejects.toBeInstanceOf(InvariantViolation);

      // Recording media is untouched — consented audio is immutable forever.
      const mediaRows = await db
        .select({ id: media.id })
        .from(media)
        .where(eq(media.id, recording.id));
      expect(mediaRows).toHaveLength(1);
    },
  );
});
