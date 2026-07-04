import { getStoryForViewer } from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ingestTextStory } from "../src/index";

let db: Database;

beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(name = "Eleanor"): Promise<string> {
  const [person] = await db
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return person!.id;
}

async function rowCount(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
  return rows[0]?.n ?? 0;
}

describe("ingestTextStory (account actor)", () => {
  it("creates a text draft owned by the account person, no storage write", async () => {
    const person = await makePerson();
    const result = await ingestTextStory(db, {
      actor: { kind: "account", personId: person },
      text: "A story I want to tell.",
    });

    const story = await getStoryForViewer(
      db,
      { kind: "account", personId: person },
      result.storyId,
    );
    expect(story?.kind).toBe("text");
    expect(story?.ownerPersonId).toBe(person);
    expect(story?.state).toBe("draft");
    expect(story?.audienceTier).toBe("private");
    expect(story?.recordingMediaId).toBeNull();
    // Text origin: there are no audio bytes, so no media row is ever created.
    expect(await rowCount("media")).toBe(0);
    // ADR-0014 Inc 3: ingestTextStory now yields a BARE text draft — createTextDraft no longer writes
    // the typed words into `transcript` (the caller appends them via appendTypedTakeContribution).
    expect(story?.transcript).toBeNull();
  });

  it("threads promptQuestion and askId onto the draft when provided", async () => {
    const person = await makePerson();
    const { storyId } = await ingestTextStory(db, {
      actor: { kind: "account", personId: person },
      text: "We drove to the coast.",
      promptQuestion: "What is a favorite trip?",
    });
    const story = await getStoryForViewer(
      db,
      { kind: "account", personId: person },
      storyId,
    );
    expect(story?.promptQuestion).toBe("What is a favorite trip?");
  });

  it("account capture leaves originatingFamilyId null (no session family)", async () => {
    const person = await makePerson();
    const { storyId } = await ingestTextStory(db, {
      actor: { kind: "account", personId: person },
      text: "A memory.",
    });
    const story = await getStoryForViewer(
      db,
      { kind: "account", personId: person },
      storyId,
    );
    expect(story?.originatingFamilyId).toBeNull();
  });

  it("rejects a phantom personId and writes NOTHING", async () => {
    const phantomId = "00000000-0000-0000-0000-000000000000";
    await expect(
      ingestTextStory(db, {
        actor: { kind: "account", personId: phantomId },
        text: "Nobody's story.",
      }),
    ).rejects.toThrow();
    expect(await rowCount("stories")).toBe(0);
  });
});
