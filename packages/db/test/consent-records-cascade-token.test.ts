/**
 * ADR-0008: consent_records is append-only EXCEPT inside an authorized story-erasure cascade, gated
 * by the transaction-local `chronicle.cascade_delete_story` token. Without the token (or with a
 * mismatched one) DELETE and all UPDATE are forbidden.
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { consentRecords, media, persons, stories, storyRecordings } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson() {
  const [p] = await db.insert(persons).values({ displayName: "E", spokenName: "E" }).returning();
  return p!;
}

async function makeConsentedStory(ownerPersonId: string) {
  const [rec] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "story_audio",
      storageKey: `s3://b/${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      checksum: crypto.randomUUID(),
    })
    .returning();
  const story = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(stories)
      .values({ ownerPersonId, recordingMediaId: rec!.id })
      .returning();
    await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec!.id });
    return s!;
  });
  const [row] = await db
    .insert(consentRecords)
    .values({
      personId: ownerPersonId,
      actorPersonId: ownerPersonId,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    })
    .returning();
  return { story, consentRow: row! };
}

describe("consent_records DELETE without the token is forbidden", () => {
  it("rejects a plain DELETE of a consent row", async () => {
    const p = await makePerson();
    const { consentRow } = await makeConsentedStory(p.id);
    await expect(
      db.delete(consentRecords).where(eq(consentRecords.id, consentRow.id)),
    ).rejects.toThrow(/append-only|permanent/i);
  });
});

describe("consent_records DELETE with a matching token succeeds", () => {
  it("permits DELETE inside a transaction that sets the story token", async () => {
    const p = await makePerson();
    const { story, consentRow } = await makeConsentedStory(p.id);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('chronicle.cascade_delete_story', ${story.id}, true)`);
      await tx.delete(consentRecords).where(eq(consentRecords.id, consentRow.id));
    });
    const remaining = await db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.id, consentRow.id));
    expect(remaining).toHaveLength(0);
  });
});

describe("a mismatched token does not unlock DELETE", () => {
  it("rejects DELETE when the token names a different story", async () => {
    const p = await makePerson();
    const { consentRow } = await makeConsentedStory(p.id);
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('chronicle.cascade_delete_story', ${crypto.randomUUID()}, true)`,
        );
        await tx.delete(consentRecords).where(eq(consentRecords.id, consentRow.id));
      }),
    ).rejects.toThrow(/append-only|permanent/i);
  });
});

describe("UPDATE of a consent row is always forbidden (even with a token)", () => {
  it("rejects UPDATE regardless of the token", async () => {
    const p = await makePerson();
    const { story, consentRow } = await makeConsentedStory(p.id);
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('chronicle.cascade_delete_story', ${story.id}, true)`);
        await tx.update(consentRecords).set({ action: "revoked" }).where(eq(consentRecords.id, consentRow.id));
      }),
    ).rejects.toThrow(/append-only/i);
  });
});
