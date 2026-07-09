/**
 * ADR-0008: media is an existence-scoped content artifact. The media guard forbids DELETE while ANY
 * live parent references the audio — a story recording pointer, a story take, a voice ask, a voice
 * caption, or a consent approval-audio reference — regardless of consent. UPDATE is always forbidden.
 * Once no live parent references the row (the item was deleted first), the orphan is reclaimable.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  asks,
  consentRecords,
  familyPhotos,
  media,
  persons,
  stories,
  storyRecordings,
  voiceCaptions,
} from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(displayName = "Eleanor") {
  const [p] = await db
    .insert(persons)
    .values({ displayName, spokenName: displayName })
    .returning();
  return p!;
}

async function makeAudio(ownerPersonId: string, kind: "story_audio" | "caption_audio" = "story_audio") {
  const [m] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind,
      storageKey: `s3://b/${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      checksum: crypto.randomUUID(),
    })
    .returning();
  return m!;
}

describe("voice ask audio is un-detachable while the ask lives", () => {
  it("rejects DELETE of media referenced by asks.recording_media_id", async () => {
    const asker = await makePerson();
    const target = await makePerson("Sam");
    const clip = await makeAudio(asker.id);
    await db.insert(asks).values({
      askerPersonId: asker.id,
      targetPersonId: target.id,
      questionText: "Tell me about the farm.",
      recordingMediaId: clip.id,
    });
    await expect(
      db.delete(media).where(eq(media.id, clip.id)),
    ).rejects.toThrow(/immutable|restrict|artifact/i);
  });
});

describe("voice caption audio is un-detachable while the caption lives", () => {
  it("rejects DELETE of media referenced by voice_captions.media_id", async () => {
    const owner = await makePerson();
    const clip = await makeAudio(owner.id, "caption_audio");
    const [photo] = await db
      .insert(familyPhotos)
      .values({
        contributorPersonId: owner.id,
        source: "upload",
        storageKey: `s3://b/${crypto.randomUUID()}.jpg`,
      })
      .returning();
    await db.insert(voiceCaptions).values({
      photoId: photo!.id,
      mediaId: clip.id,
      ownerPersonId: owner.id,
    });
    await expect(
      db.delete(media).where(eq(media.id, clip.id)),
    ).rejects.toThrow(/immutable|restrict|artifact/i);
  });
});

describe("draft story recording is un-detachable while the (unconsented) story lives", () => {
  it("rejects independent DELETE of a draft's recording media (item-existence, not consent)", async () => {
    const narrator = await makePerson();
    const clip = await makeAudio(narrator.id);
    await db.transaction(async (tx) => {
      const [s] = await tx
        .insert(stories)
        .values({ ownerPersonId: narrator.id, recordingMediaId: clip.id })
        .returning();
      await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: clip.id });
    });
    await expect(
      db.delete(media).where(eq(media.id, clip.id)),
    ).rejects.toThrow(/immutable|restrict|artifact/i);
  });
});

describe("approval-audio audio is un-detachable while a consent record references it", () => {
  it("rejects DELETE of media referenced by consent_records.approval_audio_media_id", async () => {
    const narrator = await makePerson();
    const recording = await makeAudio(narrator.id);
    // The approval-audio clip: a distinct media row (kind approval_audio) the consent row points at.
    const [approvalClip] = await db
      .insert(media)
      .values({
        ownerPersonId: narrator.id,
        kind: "approval_audio",
        storageKey: `s3://b/approval-${crypto.randomUUID()}.wav`,
        contentType: "audio/wav",
        checksum: crypto.randomUUID(),
      })
      .returning();
    const story = await db.transaction(async (tx) => {
      const [s] = await tx
        .insert(stories)
        .values({ ownerPersonId: narrator.id, recordingMediaId: recording.id })
        .returning();
      await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: recording.id });
      return s!;
    });
    await db.insert(consentRecords).values({
      personId: narrator.id,
      actorPersonId: narrator.id,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
      approvalAudioMediaId: approvalClip!.id,
    });
    await expect(
      db.delete(media).where(eq(media.id, approvalClip!.id)),
    ).rejects.toThrow(/immutable|restrict|artifact/i);
  });
});

describe("a position>=1 take's audio is un-detachable while the take lives", () => {
  it("rejects DELETE of a non-canonical take's media via the story_recordings branch (no consent needed)", async () => {
    const narrator = await makePerson();
    const rec0 = await makeAudio(narrator.id);
    const story = await db.transaction(async (tx) => {
      const [s] = await tx
        .insert(stories)
        .values({ ownerPersonId: narrator.id, recordingMediaId: rec0.id })
        .returning();
      await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec0.id });
      return s!;
    });
    // A follow-up take (position 1) with its own media — not the canonical recording pointer.
    const rec1 = await makeAudio(narrator.id);
    await db.insert(storyRecordings).values({ storyId: story.id, position: 1, mediaId: rec1.id });
    await expect(
      db.delete(media).where(eq(media.id, rec1.id)),
    ).rejects.toThrow(/immutable|restrict|artifact/i);
  });
});
