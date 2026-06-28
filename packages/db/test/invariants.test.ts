/**
 * Increment 1 — database-layer structural invariants.
 *
 * These assert the load-bearing guarantees in the database itself (via PGlite real Postgres):
 *   - the consent ledger is append-only (UPDATE and DELETE both rejected)
 *   - Media is immutable (the canonical recording can never be overwritten or deleted)
 *   - at most one ACTIVE membership per (person, family), while ended rows may coexist
 *   - one Account maps to exactly one Person; many login-less narrators coexist
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  accounts,
  consentRecords,
  families,
  joinRequests,
  media,
  memberships,
  persons,
  stories,
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

async function makeStoryWithRecording(ownerPersonId: string) {
  const [rec] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "story_audio",
      storageKey: "s3://bucket/original.wav",
      contentType: "audio/wav",
      durationSeconds: 120,
      checksum: "abc123",
    })
    .returning();
  const [story] = await db
    .insert(stories)
    .values({ ownerPersonId, recordingMediaId: rec!.id })
    .returning();
  return { recording: rec!, story: story! };
}

describe("a story is born private + draft (authenticity/consent defaults)", () => {
  it("defaults audienceTier=private and state=draft when only required fields are given", async () => {
    const narrator = await makePerson();
    const [rec] = await db
      .insert(media)
      .values({
        ownerPersonId: narrator.id,
        kind: "story_audio",
        storageKey: "s3://bucket/original.wav",
        contentType: "audio/wav",
        checksum: "abc123",
      })
      .returning();
    const [story] = await db
      .insert(stories)
      .values({ ownerPersonId: narrator.id, recordingMediaId: rec!.id })
      .returning();
    expect(story!.state).toBe("draft");
    expect(story!.audienceTier).toBe("private");
    expect(story!.approvedAt).toBeNull();
    expect(story!.prose).toBeNull();
  });
});

describe("consent ledger is append-only", () => {
  it("permits INSERT", async () => {
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
    expect(row!.action).toBe("approved_for_sharing");
  });

  it("rejects UPDATE of a consent record", async () => {
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

  it("rejects DELETE of a consent record", async () => {
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

  it("models revocation as a NEW superseding row, not an edit", async () => {
    const narrator = await makePerson();
    const { story } = await makeStoryWithRecording(narrator.id);
    await db.insert(consentRecords).values({
      personId: narrator.id,
      actorPersonId: narrator.id,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    });
    await db.insert(consentRecords).values({
      personId: narrator.id,
      actorPersonId: narrator.id,
      storyId: story.id,
      action: "revoked",
      resultingState: "private",
    });
    const rows = await db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.storyId, story.id));
    expect(rows).toHaveLength(2);
  });
});

describe("media is immutable (canonical recording protected)", () => {
  it("rejects UPDATE of a media row", async () => {
    const narrator = await makePerson();
    const { recording } = await makeStoryWithRecording(narrator.id);
    await expect(
      db
        .update(media)
        .set({ storageKey: "s3://bucket/OVERWRITTEN.wav" })
        .where(eq(media.id, recording.id)),
    ).rejects.toThrow(/immutable|append-only/i);
  });

  it("rejects DELETE of a consented story's recording media (ADR-0002)", async () => {
    // Per ADR-0002 the trigger is consent-scoped: a recording tied to a story that has at
    // least one consent_records row must never be deleted.  We add a consent record here to
    // exercise the trigger; without it the trigger permits deletion and the FK constraint
    // (stories.recording_media_id NOT NULL) is a separate protection.
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
      db.delete(media).where(eq(media.id, recording.id)),
    ).rejects.toThrow(/immutable|restrict/i);
  });
});

describe("membership active-uniqueness", () => {
  it("rejects two ACTIVE memberships for the same person+family", async () => {
    const narrator = await makePerson();
    const [fam] = await db
      .insert(families)
      .values({
        name: "Boudreaux",
        creatorPersonId: narrator.id,
        stewardPersonId: narrator.id,
      })
      .returning();
    await db
      .insert(memberships)
      .values({ personId: narrator.id, familyId: fam!.id, role: "narrator" });
    await expect(
      db
        .insert(memberships)
        .values({ personId: narrator.id, familyId: fam!.id, role: "member" }),
    ).rejects.toThrow();
  });

  it("allows an ended membership to coexist with a new active one (rejoin)", async () => {
    const narrator = await makePerson();
    const [fam] = await db
      .insert(families)
      .values({
        name: "Boudreaux",
        creatorPersonId: narrator.id,
        stewardPersonId: narrator.id,
      })
      .returning();
    await db.insert(memberships).values({
      personId: narrator.id,
      familyId: fam!.id,
      status: "ended",
      endedAt: sql`now()`,
    });
    const [rejoin] = await db
      .insert(memberships)
      .values({ personId: narrator.id, familyId: fam!.id, status: "active" })
      .returning();
    expect(rejoin!.status).toBe("active");
  });
});

describe("join-request pending-uniqueness", () => {
  async function makeDiscoverableFamily(stewardId: string) {
    const [fam] = await db
      .insert(families)
      .values({
        name: "Esposito",
        discoverable: true,
        creatorPersonId: stewardId,
        stewardPersonId: stewardId,
      })
      .returning();
    return fam!;
  }

  it("rejects two PENDING join requests for the same family+requester (partial unique index)", async () => {
    const steward = await makePerson("Rosa");
    const requester = await makePerson("Cousin");
    const fam = await makeDiscoverableFamily(steward.id);
    await db.insert(joinRequests).values({
      familyId: fam.id,
      requesterPersonId: requester.id,
      status: "pending",
    });
    await expect(
      db.insert(joinRequests).values({
        familyId: fam.id,
        requesterPersonId: requester.id,
        status: "pending",
      }),
    ).rejects.toThrow();
  });

  it("allows a new pending request after an earlier one was declined", async () => {
    const steward = await makePerson("Rosa");
    const requester = await makePerson("Cousin");
    const fam = await makeDiscoverableFamily(steward.id);
    await db.insert(joinRequests).values({
      familyId: fam.id,
      requesterPersonId: requester.id,
      status: "declined",
    });
    const [again] = await db
      .insert(joinRequests)
      .values({
        familyId: fam.id,
        requesterPersonId: requester.id,
        status: "pending",
      })
      .returning();
    expect(again!.status).toBe("pending");
  });
});

describe("person/account separation", () => {
  it("permits many login-less narrators (null account_id)", async () => {
    await makePerson("Narrator A");
    await makePerson("Narrator B");
    const all = await db.select().from(persons);
    expect(all.every((p) => p.accountId === null)).toBe(true);
    expect(all).toHaveLength(2);
  });

  it("enforces one Account -> exactly one Person", async () => {
    const [acct] = await db
      .insert(accounts)
      .values({ authProviderUserId: "clerk_user_1" })
      .returning();
    const member = await makePerson("Sofia");
    await db
      .update(persons)
      .set({ accountId: acct!.id })
      .where(eq(persons.id, member.id));
    const other = await makePerson("Other");
    await expect(
      db
        .update(persons)
        .set({ accountId: acct!.id })
        .where(eq(persons.id, other.id)),
    ).rejects.toThrow();
  });
});
