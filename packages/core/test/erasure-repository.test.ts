import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import { familyPhotos, familyPhotoFamilies, media, stories, storyRecordings } from "@chronicle/db/content";
import {
  asks,
  askSubjectPhotos,
  consentRecords,
  erasureAudit,
  families,
  memberships,
  persons,
  storyFamilies,
  voiceCaptions,
} from "@chronicle/db/schema";
import { eraseAsk, eraseStory, eraseVoiceCaption } from "../src/erasure-repository";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(name = "Eleanor") {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!;
}

/** A consented, family-shared voice story with recording + take-0 + approval audio + consent row. */
async function makeSharedStory(ownerPersonId: string, familyId: string) {
  const [rec] = await db
    .insert(media)
    .values({ ownerPersonId, kind: "story_audio", storageKey: `s3://b/${crypto.randomUUID()}.wav`, contentType: "audio/wav", checksum: crypto.randomUUID() })
    .returning();
  const [approval] = await db
    .insert(media)
    .values({ ownerPersonId, kind: "approval_audio", storageKey: `s3://b/${crypto.randomUUID()}.wav`, contentType: "audio/wav", checksum: crypto.randomUUID() })
    .returning();
  const story = await db.transaction(async (tx) => {
    const [s] = await tx.insert(stories).values({ ownerPersonId, recordingMediaId: rec!.id, state: "shared", audienceTier: "family" }).returning();
    await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec!.id });
    return s!;
  });
  await db.insert(storyFamilies).values({ storyId: story.id, familyId });
  await db.insert(consentRecords).values({ personId: ownerPersonId, actorPersonId: ownerPersonId, storyId: story.id, action: "approved_for_sharing", resultingState: "shared", approvalAudioMediaId: approval!.id });
  return { story, recStorageKey: rec!.storageKey, approvalId: approval!.id };
}

async function makeFamily(stewardPersonId: string) {
  const [f] = await db
    .insert(families)
    .values({ name: "Test", stewardPersonId, creatorPersonId: stewardPersonId })
    .returning();
  await db.insert(memberships).values({ personId: stewardPersonId, familyId: f!.id, role: "steward", status: "active" });
  return f!;
}

describe("eraseStory — owner erasure of a consented, shared story", () => {
  it("hard-deletes the story, its audio, and its consent ledger, and writes an erasure_audit row", async () => {
    const owner = await makePerson();
    const family = await makeFamily(owner.id);
    const { story, recStorageKey } = await makeSharedStory(owner.id, family.id);

    const result = await eraseStory(db, { kind: "account", personId: owner.id }, { storyId: story.id });

    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.storageKeys).toContain(recStorageKey);

    expect(await db.select().from(stories).where(eq(stories.id, story.id))).toHaveLength(0);
    expect(await db.select().from(consentRecords).where(eq(consentRecords.storyId, story.id))).toHaveLength(0);

    const audit = await db.select().from(erasureAudit).where(eq(erasureAudit.itemId, story.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.reason).toBe("owner_erasure");
    expect(audit[0]!.itemType).toBe("story");
    expect(audit[0]!.actorPersonId).toBe(owner.id);
  });
});

describe("eraseStory — owner erasure of a never-approved draft (cascade token set but unused)", () => {
  it("hard-deletes the draft and its recording media with no consent ledger to unlock", async () => {
    const owner = await makePerson();
    const [rec] = await db
      .insert(media)
      .values({ ownerPersonId: owner.id, kind: "story_audio", storageKey: `s3://b/${crypto.randomUUID()}.wav`, contentType: "audio/wav", checksum: crypto.randomUUID() })
      .returning();
    const story = await db.transaction(async (tx) => {
      const [s] = await tx.insert(stories).values({ ownerPersonId: owner.id, recordingMediaId: rec!.id }).returning();
      await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec!.id });
      return s!;
    });

    const result = await eraseStory(db, { kind: "account", personId: owner.id }, { storyId: story.id });
    expect(result.allowed).toBe(true);

    expect(await db.select().from(stories).where(eq(stories.id, story.id))).toHaveLength(0);
    expect(await db.select().from(media).where(eq(media.id, rec!.id))).toHaveLength(0);

    const audit = await db.select().from(erasureAudit).where(eq(erasureAudit.itemId, story.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.reason).toBe("owner_erasure");
  });
});

describe("eraseStory — steward moderation of another member's shared story", () => {
  it("allows the steward to erase and records steward_moderation", async () => {
    const steward = await makePerson("Steward");
    const member = await makePerson("Member");
    const family = await makeFamily(steward.id);
    await db.insert(memberships).values({ personId: member.id, familyId: family.id, role: "member", status: "active" });
    const { story } = await makeSharedStory(member.id, family.id);

    const result = await eraseStory(db, { kind: "account", personId: steward.id }, { storyId: story.id });
    expect(result.allowed).toBe(true);

    const audit = await db.select().from(erasureAudit).where(eq(erasureAudit.itemId, story.id));
    expect(audit[0]!.reason).toBe("steward_moderation");
    expect(audit[0]!.ownerPersonId).toBe(member.id);
    expect(audit[0]!.actorPersonId).toBe(steward.id);
  });
});

describe("eraseStory — a non-owner, non-steward is denied", () => {
  it("denies and deletes nothing", async () => {
    const owner = await makePerson();
    const stranger = await makePerson("Stranger");
    const family = await makeFamily(owner.id);
    const { story } = await makeSharedStory(owner.id, family.id);

    const result = await eraseStory(db, { kind: "account", personId: stranger.id }, { storyId: story.id });
    expect(result.allowed).toBe(false);
    expect(await db.select().from(stories).where(eq(stories.id, story.id))).toHaveLength(1);
  });
});

async function makeVoiceAsk(askerPersonId: string, targetPersonId: string, familyId: string | null) {
  const [clip] = await db
    .insert(media)
    .values({ ownerPersonId: askerPersonId, kind: "story_audio", storageKey: `s3://b/${crypto.randomUUID()}.wav`, contentType: "audio/wav", checksum: crypto.randomUUID() })
    .returning();
  const [ask] = await db
    .insert(asks)
    .values({ askerPersonId, targetPersonId, familyId: familyId ?? undefined, questionText: "What was your first job?", recordingMediaId: clip!.id })
    .returning();
  return { ask: ask!, clipStorageKey: clip!.storageKey };
}

describe("eraseAsk — asker erases their own voice question", () => {
  it("hard-deletes the ask and its question audio, writes an audit row", async () => {
    const asker = await makePerson("Asker");
    const target = await makePerson("Target");
    const family = await makeFamily(asker.id);
    const { ask, clipStorageKey } = await makeVoiceAsk(asker.id, target.id, family.id);

    const result = await eraseAsk(db, { kind: "account", personId: asker.id }, { askId: ask.id });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.storageKeys).toContain(clipStorageKey);
    expect(await db.select().from(asks).where(eq(asks.id, ask.id))).toHaveLength(0);
    const audit = await db.select().from(erasureAudit).where(eq(erasureAudit.itemId, ask.id));
    expect(audit[0]!.itemType).toBe("ask");
    expect(audit[0]!.reason).toBe("owner_erasure");
  });
});

describe("eraseVoiceCaption — owner erases a voice caption", () => {
  it("hard-deletes the caption and its audio, writes an audit row", async () => {
    const owner = await makePerson("Owner");
    const family = await makeFamily(owner.id);
    const [clip] = await db.insert(media).values({ ownerPersonId: owner.id, kind: "caption_audio", storageKey: `s3://b/${crypto.randomUUID()}.wav`, contentType: "audio/wav", checksum: crypto.randomUUID() }).returning();
    const [photo] = await db.insert(familyPhotos).values({ contributorPersonId: owner.id, source: "upload", storageKey: `family-photos/${crypto.randomUUID()}` }).returning();
    await db.insert(familyPhotoFamilies).values({ photoId: photo!.id, familyId: family.id });
    const [vc] = await db.insert(voiceCaptions).values({ photoId: photo!.id, mediaId: clip!.id, ownerPersonId: owner.id }).returning();

    const result = await eraseVoiceCaption(db, { kind: "account", personId: owner.id }, { voiceCaptionId: vc!.id });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.storageKeys).toContain(clip!.storageKey);
    expect(await db.select().from(voiceCaptions).where(eq(voiceCaptions.id, vc!.id))).toHaveLength(0);
    expect(await db.select().from(media).where(eq(media.id, clip!.id))).toHaveLength(0);
    const audit = await db.select().from(erasureAudit).where(eq(erasureAudit.itemId, vc!.id));
    expect(audit[0]!.itemType).toBe("voice_caption");
  });
});
