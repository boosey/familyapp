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
  discardDraftStory,
  InvariantViolation,
  persistRecordingAndCreateDraft,
  transitionStoryState,
} from "../src/index";
import { makePerson } from "./helpers";
import { media, stories } from "@chronicle/db/content";
import { consentRecords } from "@chronicle/db/schema";
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

describe("discardDraftStory — state guard", () => {
  it("refuses when the story has left draft (e.g. shared); the shared story's media survives", async () => {
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
