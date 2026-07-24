import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import { media, stories, storyRecordings } from "@chronicle/db/content";
import {
  accounts,
  consentRecords,
  families,
  memberships,
  narratorMemory,
  persons,
  storyFamilies,
} from "@chronicle/db/schema";
import { eraseAccount, eraseStory } from "../src/erasure-repository";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** A person WITH an account attached (the real account-erasure scenario). */
async function makeAccountPerson(name = "Eleanor") {
  const [acct] = await db
    .insert(accounts)
    .values({ authProviderUserId: `auth|${crypto.randomUUID()}`, email: `${name}@x.test` })
    .returning();
  const [p] = await db
    .insert(persons)
    .values({ displayName: name, spokenName: name, accountId: acct!.id })
    .returning();
  return { person: p!, account: acct! };
}

/** A bare account-less person (used to be the erasing narrator for eraseStory). */
async function makePerson(name = "Eleanor") {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!;
}

async function makeFamily(stewardPersonId: string) {
  const [f] = await db
    .insert(families)
    .values({ name: "Test", stewardPersonId, creatorPersonId: stewardPersonId })
    .returning();
  await db
    .insert(memberships)
    .values({ personId: stewardPersonId, familyId: f!.id, role: "steward", status: "active" });
  return f!;
}

/** A consented, family-shared voice story with recording + take-0 + approval audio + consent row. */
async function makeSharedStory(ownerPersonId: string, familyId: string) {
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
  const [approval] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "approval_audio",
      storageKey: `s3://b/${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      checksum: crypto.randomUUID(),
    })
    .returning();
  const story = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(stories)
      .values({ ownerPersonId, recordingMediaId: rec!.id, state: "shared", audienceTier: "family" })
      .returning();
    await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec!.id });
    return s!;
  });
  await db.insert(storyFamilies).values({ storyId: story.id, familyId });
  await db.insert(consentRecords).values({
    personId: ownerPersonId,
    actorPersonId: ownerPersonId,
    storyId: story.id,
    action: "approved_for_sharing",
    resultingState: "shared",
    approvalAudioMediaId: approval!.id,
  });
  return { story };
}

describe("eraseStory — narrator_memory extracted from the erased story goes with it", () => {
  // A fact MINED from a story (source_story_id set) has no FK cascade, so DELETE stories would
  // FK-fail unless eraseStory removes it first. A user-authored fact (source_story_id NULL) for the
  // SAME narrator is untouched — it did not come from this story.
  it("deletes facts whose source_story_id is the erased story, leaving user-authored facts intact", async () => {
    const owner = await makePerson();
    const family = await makeFamily(owner.id);
    const { story } = await makeSharedStory(owner.id, family.id);

    const [extracted] = await db
      .insert(narratorMemory)
      .values({
        personId: owner.id,
        title: "Worked at the cannery",
        summary: "Spent summers at the cannery on the coast.",
        origin: "extracted",
        sourceStoryId: story.id,
        confidence: 0.82,
      })
      .returning();
    const [authored] = await db
      .insert(narratorMemory)
      .values({
        personId: owner.id,
        title: "Favorite color is green",
        summary: "The narrator noted their favorite color is green.",
        origin: "user",
      })
      .returning();

    const result = await eraseStory(db, { kind: "account", personId: owner.id }, { storyId: story.id });

    expect(result.allowed).toBe(true);
    // The story is gone (would have FK-failed on narrator_memory without the explicit delete).
    expect(await db.select().from(stories).where(eq(stories.id, story.id))).toHaveLength(0);
    // The mined fact went with the story.
    expect(
      await db.select().from(narratorMemory).where(eq(narratorMemory.id, extracted!.id)),
    ).toHaveLength(0);
    // The user-authored fact (source_story_id NULL) survives untouched.
    expect(
      await db.select().from(narratorMemory).where(eq(narratorMemory.id, authored!.id)),
    ).toHaveLength(1);
  });
});

describe("eraseAccount — removes ALL of the erased person's narrator_memory rows", () => {
  // A solo person with only their own content hard-deletes cleanly. Their narrator_memory rows —
  // both an extracted fact from their own story AND a user-authored fact — must all be gone (else
  // narrator_memory.person_id FK-blocks DELETE persons and the whole erasure rolls back).
  it("deletes both extracted and user-authored facts for the erased person", async () => {
    const { person } = await makeAccountPerson();
    const family = await makeFamily(person.id);
    const { story } = await makeSharedStory(person.id, family.id);

    const [extracted] = await db
      .insert(narratorMemory)
      .values({
        personId: person.id,
        title: "Grew up on a farm",
        summary: "Childhood on a dairy farm in the valley.",
        origin: "extracted",
        sourceStoryId: story.id,
        confidence: 0.9,
      })
      .returning();
    const [authored] = await db
      .insert(narratorMemory)
      .values({
        personId: person.id,
        title: "Plays the accordion",
        summary: "The narrator plays the accordion at family gatherings.",
        origin: "user",
      })
      .returning();

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("deleted");
    // The person is gone (narrator_memory.person_id would have blocked DELETE persons otherwise).
    expect(await db.select().from(persons).where(eq(persons.id, person.id))).toHaveLength(0);
    // Every one of their facts is gone — extracted AND user-authored.
    expect(
      await db.select().from(narratorMemory).where(eq(narratorMemory.id, extracted!.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(narratorMemory).where(eq(narratorMemory.id, authored!.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(narratorMemory).where(eq(narratorMemory.personId, person.id)),
    ).toHaveLength(0);
  });
});
