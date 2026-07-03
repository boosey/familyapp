/**
 * Regression tests for ADR-0002 — Media immutability is consent-scoped.
 *
 * The trigger `media_immutable` (backed by `chronicle_media_delete_guard`) enforces:
 *   - UPDATE on any media row: always forbidden.
 *   - DELETE on a media row: allowed only when the row is NOT referenced by any consent_records
 *     row AND its owning Story has NO consent_records row.
 *   - consent_records UPDATE/DELETE: still fully append-only (regression guard).
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  consentRecords,
  media,
  persons,
  stories,
  storyRecordings,
} from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makePerson(displayName = "Eleanor") {
  const [p] = await db
    .insert(persons)
    .values({ displayName, spokenName: displayName })
    .returning();
  return p!;
}

/** Insert a media row + a story that points to it. */
async function makeStoryWithRecording(ownerPersonId: string) {
  const [rec] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "story_audio",
      storageKey: `s3://bucket/${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      durationSeconds: 60,
      checksum: crypto.randomUUID(),
    })
    .returning();
  const story = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(stories)
      .values({ ownerPersonId, recordingMediaId: rec!.id })
      .returning();
    // Seed take-0 so the story satisfies the ADR-0014 kind⇔recording biconditional.
    await tx
      .insert(storyRecordings)
      .values({ storyId: s!.id, position: 0, mediaId: rec!.id });
    return s!;
  });
  return { recording: rec!, story };
}

/** Insert an approval-audio media row (not attached to any story). */
async function makeApprovalAudioMedia(ownerPersonId: string) {
  const [m] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "approval_audio",
      storageKey: `s3://bucket/approval-${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      durationSeconds: 5,
      checksum: crypto.randomUUID(),
    })
    .returning();
  return m!;
}

// ---------------------------------------------------------------------------
// Test 1: never-consented draft media DELETE succeeds
// ---------------------------------------------------------------------------

describe("test 1 — never-consented draft: DELETE succeeds", () => {
  it("allows DELETE of a media row whose story has zero consent_records", async () => {
    const narrator = await makePerson();
    const { recording, story } = await makeStoryWithRecording(narrator.id);

    // Confirm no consent records exist.
    const rows = await db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.storyId, story.id));
    expect(rows).toHaveLength(0);

    // Whole-draft discard (ADR-0014): the takes and the story go together in one transaction
    // (the take-0 row pins the story FK), then the reclaimed media row can be deleted.
    await db.transaction(async (tx) => {
      await tx.delete(storyRecordings).where(eq(storyRecordings.storyId, story.id));
      await tx.delete(stories).where(eq(stories.id, story.id));
    });

    // The trigger should now permit the delete (no consent linkage).
    await expect(
      db.delete(media).where(eq(media.id, recording.id)),
    ).resolves.not.toThrow();

    // Row is gone.
    const remaining = await db
      .select()
      .from(media)
      .where(eq(media.id, recording.id));
    expect(remaining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2: consented story's recording media DELETE is rejected
// ---------------------------------------------------------------------------

describe("test 2 — consented story recording: DELETE raises", () => {
  it("rejects DELETE of recording media when its owning story has a consent_records row", async () => {
    const narrator = await makePerson();
    const { recording, story } = await makeStoryWithRecording(narrator.id);

    // Add a consent record — story is now approved/shared.
    await db.insert(consentRecords).values({
      personId: narrator.id,
      actorPersonId: narrator.id,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    });

    // The trigger must reject this even if someone tries to delete the media directly.
    await expect(
      db.delete(media).where(eq(media.id, recording.id)),
    ).rejects.toThrow(/immutable|restrict/i);
  });
});

// ---------------------------------------------------------------------------
// Test 3: approval-audio media referenced by a consent_records row cannot be deleted
// ---------------------------------------------------------------------------

describe("test 3 — approval-audio referenced by consent record: DELETE raises", () => {
  it("rejects DELETE of a media row that is an approval_audio_media_id on any consent_records row", async () => {
    const narrator = await makePerson();
    const { story } = await makeStoryWithRecording(narrator.id);
    const approvalClip = await makeApprovalAudioMedia(narrator.id);

    // Consent record references the approval-audio clip.
    await db.insert(consentRecords).values({
      personId: narrator.id,
      actorPersonId: narrator.id,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
      approvalAudioMediaId: approvalClip.id,
    });

    // Trigger check (a): approval_audio_media_id reference must block deletion.
    await expect(
      db.delete(media).where(eq(media.id, approvalClip.id)),
    ).rejects.toThrow(/immutable|restrict/i);
  });
});

// ---------------------------------------------------------------------------
// Test 4: UPDATE on any media row is always rejected
// ---------------------------------------------------------------------------

describe("test 4 — UPDATE on media is always forbidden", () => {
  it("rejects UPDATE on an unconsented draft media row", async () => {
    const narrator = await makePerson();
    const { recording } = await makeStoryWithRecording(narrator.id);
    await expect(
      db
        .update(media)
        .set({ storageKey: "s3://bucket/OVERWRITTEN.wav" })
        .where(eq(media.id, recording.id)),
    ).rejects.toThrow(/immutable|append-only/i);
  });

  it("rejects UPDATE on a consented story's recording media", async () => {
    const narrator = await makePerson();
    const { recording, story } = await makeStoryWithRecording(narrator.id);
    await db.insert(consentRecords).values({
      personId: narrator.id,
      actorPersonId: narrator.id,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    });
    await expect(
      db
        .update(media)
        .set({ storageKey: "s3://bucket/OVERWRITTEN.wav" })
        .where(eq(media.id, recording.id)),
    ).rejects.toThrow(/immutable|append-only/i);
  });
});

// ---------------------------------------------------------------------------
// Test 4b: the recording pointer itself is immutable (closes the re-aim hole)
// ---------------------------------------------------------------------------

describe("test 4b — stories.recording_media_id is immutable", () => {
  it("rejects changing recording_media_id (would orphan a consented recording)", async () => {
    const narrator = await makePerson();
    const { story } = await makeStoryWithRecording(narrator.id);
    // A second media row the pointer might be re-aimed at.
    const other = await makeApprovalAudioMedia(narrator.id);
    await expect(
      db
        .update(stories)
        .set({ recordingMediaId: other.id })
        .where(eq(stories.id, story.id)),
    ).rejects.toThrow(/immutable|restrict/i);
  });

  it("allows updating OTHER story columns (the guard fires only on a pointer change)", async () => {
    const narrator = await makePerson();
    const { story } = await makeStoryWithRecording(narrator.id);
    // Changing state but NOT the recording pointer must succeed (draft -> the same row, new state).
    await expect(
      db
        .update(stories)
        .set({ state: "pending_approval" })
        .where(eq(stories.id, story.id)),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 5: consent_records append-only guard still holds (regression)
// ---------------------------------------------------------------------------

describe("test 5 — consent_records append-only guard not regressed", () => {
  it("rejects UPDATE of a consent_records row", async () => {
    const narrator = await makePerson();
    const { story } = await makeStoryWithRecording(narrator.id);
    const [row] = await db
      .insert(consentRecords)
      .values({
        personId: narrator.id,
        actorPersonId: narrator.id,
        storyId: story.id,
        action: "approved_for_sharing",
        resultingState: "shared",
      })
      .returning();
    await expect(
      db
        .update(consentRecords)
        .set({ action: "revoked" })
        .where(eq(consentRecords.id, row!.id)),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE of a consent_records row", async () => {
    const narrator = await makePerson();
    const { story } = await makeStoryWithRecording(narrator.id);
    const [row] = await db
      .insert(consentRecords)
      .values({
        personId: narrator.id,
        actorPersonId: narrator.id,
        storyId: story.id,
        action: "approved_for_sharing",
        resultingState: "shared",
      })
      .returning();
    await expect(
      db.delete(consentRecords).where(eq(consentRecords.id, row!.id)),
    ).rejects.toThrow(/append-only/i);
  });
});
