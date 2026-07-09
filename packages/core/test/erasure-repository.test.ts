import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import {
  familyPhotos,
  familyPhotoFamilies,
  media,
  proseRevisions,
  stories,
  storyRecordings,
} from "@chronicle/db/content";
import {
  askFamilies,
  asks,
  consentRecords,
  erasureAudit,
  families,
  followUpDecisions,
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

describe("eraseStory — owner erasure of a FULLY-POPULATED shared voice story", () => {
  // Regression for the production deletion failures (2026-07-05): a real shared story carries
  // child rows the minimal fixtures above omit — a follow_up_decisions ledger row (ADR-0013) and
  // a per-take prose_revisions row (ADR-0014, FK → story_recordings). The cascade must erase ALL
  // of them. This locks in the WHOLE delete order so a guard/FK can't whack-a-mole again:
  //   - follow_up_decisions has an append-only trigger; DELETE must be permitted inside the token.
  //   - prose_revisions.story_recording_id FKs story_recordings, so prose must go BEFORE takes.
  it("hard-deletes the follow_up_decisions ledger and per-take prose_revisions too", async () => {
    const owner = await makePerson();
    const family = await makeFamily(owner.id);
    const { story } = await makeSharedStory(owner.id, family.id);

    // The take row seeded by makeSharedStory (position 0) — prose_revisions references it.
    const [take] = await db
      .select({ id: storyRecordings.id })
      .from(storyRecordings)
      .where(eq(storyRecordings.storyId, story.id));
    await db.insert(proseRevisions).values({
      storyId: story.id,
      level: "ai_transcribed",
      text: "raw transcript",
      storyRecordingId: take!.id,
    });
    await db.insert(followUpDecisions).values({
      storyId: story.id,
      threadPosition: 0,
      recordKind: "decision",
    });

    const result = await eraseStory(db, { kind: "account", personId: owner.id }, { storyId: story.id });

    expect(result.allowed).toBe(true);
    expect(await db.select().from(stories).where(eq(stories.id, story.id))).toHaveLength(0);
    expect(
      await db.select().from(followUpDecisions).where(eq(followUpDecisions.storyId, story.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(proseRevisions).where(eq(proseRevisions.storyId, story.id)),
    ).toHaveLength(0);
  });
});

describe("follow_up_decisions carve-out is erasure-scoped, not a blanket unlock", () => {
  // The guard must permit DELETE ONLY inside an authorized erasure (token set). A raw DELETE with
  // no cascade token still raises — the ledger stays permanent outside ADR-0008 erasure.
  it("still forbids a DELETE outside an erasure cascade (no token)", async () => {
    const owner = await makePerson();
    const family = await makeFamily(owner.id);
    const { story } = await makeSharedStory(owner.id, family.id);
    await db.insert(followUpDecisions).values({
      storyId: story.id,
      threadPosition: 0,
      recordKind: "decision",
    });

    await expect(
      db.delete(followUpDecisions).where(eq(followUpDecisions.storyId, story.id)),
    ).rejects.toThrow(/append-only\/immutable/);
    // The row survives the blocked delete.
    expect(
      await db.select().from(followUpDecisions).where(eq(followUpDecisions.storyId, story.id)),
    ).toHaveLength(1);
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

async function makeVoiceAsk(askerPersonId: string, targetPersonId: string, familyIds: string[] = []) {
  const [clip] = await db
    .insert(media)
    .values({ ownerPersonId: askerPersonId, kind: "story_audio", storageKey: `s3://b/${crypto.randomUUID()}.wav`, contentType: "audio/wav", checksum: crypto.randomUUID() })
    .returning();
  const [ask] = await db
    .insert(asks)
    .values({ askerPersonId, targetPersonId, questionText: "What was your first job?", recordingMediaId: clip!.id })
    .returning();
  if (familyIds.length > 0) {
    await db.insert(askFamilies).values(familyIds.map((familyId) => ({ askId: ask!.id, familyId })));
  }
  return { ask: ask!, clipStorageKey: clip!.storageKey };
}

describe("eraseAsk — asker erases their own voice question", () => {
  it("hard-deletes the ask and its question audio, writes an audit row", async () => {
    const asker = await makePerson("Asker");
    const target = await makePerson("Target");
    const family = await makeFamily(asker.id);
    const { ask, clipStorageKey } = await makeVoiceAsk(asker.id, target.id, [family.id]);

    const result = await eraseAsk(db, { kind: "account", personId: asker.id }, { askId: ask.id });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.storageKeys).toContain(clipStorageKey);
    expect(await db.select().from(asks).where(eq(asks.id, ask.id))).toHaveLength(0);
    // The join rows are cleared with the ask.
    expect(await db.select().from(askFamilies).where(eq(askFamilies.askId, ask.id))).toHaveLength(0);
    const audit = await db.select().from(erasureAudit).where(eq(erasureAudit.itemId, ask.id));
    expect(audit[0]!.itemType).toBe("ask");
    expect(audit[0]!.reason).toBe("owner_erasure");
  });
});

describe("eraseAsk — steward moderation across multiple targeted families", () => {
  it("lets the steward of ANY targeted family erase the ask (not just the first)", async () => {
    const asker = await makePerson("Asker");
    const target = await makePerson("Target");
    // Two families with distinct stewards; the ask targets BOTH.
    const famA = await makeFamily(asker.id); // asker stewards famA
    const stewardB = await makePerson("StewardB");
    const famB = await makeFamily(stewardB.id); // stewardB stewards famB
    const { ask } = await makeVoiceAsk(asker.id, target.id, [famA.id, famB.id]);

    // The steward of the SECOND targeted family (not the asker) may moderate-delete it.
    const result = await eraseAsk(db, { kind: "account", personId: stewardB.id }, { askId: ask.id });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(await db.select().from(asks).where(eq(asks.id, ask.id))).toHaveLength(0);
    expect(await db.select().from(askFamilies).where(eq(askFamilies.askId, ask.id))).toHaveLength(0);
    const audit = await db.select().from(erasureAudit).where(eq(erasureAudit.itemId, ask.id));
    expect(audit[0]!.reason).toBe("steward_moderation");
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
