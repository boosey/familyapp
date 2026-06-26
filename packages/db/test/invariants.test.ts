/**
 * Increment 1 — database-layer structural invariants.
 *
 * These assert the load-bearing guarantees in the database itself (via PGlite real Postgres):
 *   - the consent ledger is append-only (UPDATE and DELETE both rejected)
 *   - Media is immutable (the canonical recording can never be overwritten or deleted)
 *   - at most one ACTIVE membership per (person, family), while ended rows may coexist
 *   - one Account maps to exactly one Person; many login-less elders coexist
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  accounts,
  consentRecords,
  createTestDatabase,
  families,
  media,
  memberships,
  persons,
  stories,
  type Database,
} from "../src/index";

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

describe("consent ledger is append-only", () => {
  it("permits INSERT", async () => {
    const elder = await makePerson();
    const { story } = await makeStoryWithRecording(elder.id);
    const [row] = await db
      .insert(consentRecords)
      .values({
        personId: elder.id,
        actorPersonId: elder.id,
        storyId: story.id,
        action: "approved_for_sharing",
        resultingState: "shared",
      })
      .returning();
    expect(row!.action).toBe("approved_for_sharing");
  });

  it("rejects UPDATE of a consent record", async () => {
    const elder = await makePerson();
    const { story } = await makeStoryWithRecording(elder.id);
    const [row] = await db
      .insert(consentRecords)
      .values({
        personId: elder.id,
        actorPersonId: elder.id,
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
    const elder = await makePerson();
    const { story } = await makeStoryWithRecording(elder.id);
    const [row] = await db
      .insert(consentRecords)
      .values({
        personId: elder.id,
        actorPersonId: elder.id,
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
    const elder = await makePerson();
    const { story } = await makeStoryWithRecording(elder.id);
    await db.insert(consentRecords).values({
      personId: elder.id,
      actorPersonId: elder.id,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    });
    await db.insert(consentRecords).values({
      personId: elder.id,
      actorPersonId: elder.id,
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
    const elder = await makePerson();
    const { recording } = await makeStoryWithRecording(elder.id);
    await expect(
      db
        .update(media)
        .set({ storageKey: "s3://bucket/OVERWRITTEN.wav" })
        .where(eq(media.id, recording.id)),
    ).rejects.toThrow(/immutable|append-only/i);
  });

  it("rejects DELETE of a media row", async () => {
    const elder = await makePerson();
    const { recording } = await makeStoryWithRecording(elder.id);
    await expect(
      db.delete(media).where(eq(media.id, recording.id)),
    ).rejects.toThrow(/immutable|append-only/i);
  });
});

describe("membership active-uniqueness", () => {
  it("rejects two ACTIVE memberships for the same person+family", async () => {
    const elder = await makePerson();
    const [fam] = await db
      .insert(families)
      .values({
        name: "Boudreaux",
        creatorPersonId: elder.id,
        stewardPersonId: elder.id,
      })
      .returning();
    await db
      .insert(memberships)
      .values({ personId: elder.id, familyId: fam!.id, role: "narrator" });
    await expect(
      db
        .insert(memberships)
        .values({ personId: elder.id, familyId: fam!.id, role: "member" }),
    ).rejects.toThrow();
  });

  it("allows an ended membership to coexist with a new active one (rejoin)", async () => {
    const elder = await makePerson();
    const [fam] = await db
      .insert(families)
      .values({
        name: "Boudreaux",
        creatorPersonId: elder.id,
        stewardPersonId: elder.id,
      })
      .returning();
    await db.insert(memberships).values({
      personId: elder.id,
      familyId: fam!.id,
      status: "ended",
      endedAt: sql`now()`,
    });
    const [rejoin] = await db
      .insert(memberships)
      .values({ personId: elder.id, familyId: fam!.id, status: "active" })
      .returning();
    expect(rejoin!.status).toBe("active");
  });
});

describe("person/account separation", () => {
  it("permits many login-less elders (null account_id)", async () => {
    await makePerson("Elder A");
    await makePerson("Elder B");
    const all = await db.select().from(persons);
    expect(all.every((p) => p.accountId === null)).toBe(true);
    expect(all).toHaveLength(2);
  });

  it("enforces one Account -> exactly one Person", async () => {
    const [acct] = await db
      .insert(accounts)
      .values({ authProviderUserId: "clerk_user_1" })
      .returning();
    const younger = await makePerson("Sofia");
    await db
      .update(persons)
      .set({ accountId: acct!.id })
      .where(eq(persons.id, younger.id));
    const other = await makePerson("Other");
    await expect(
      db
        .update(persons)
        .set({ accountId: acct!.id })
        .where(eq(persons.id, other.id)),
    ).rejects.toThrow();
  });
});
