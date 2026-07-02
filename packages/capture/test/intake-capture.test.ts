import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { getIntakeAnswer } from "@chronicle/core";
import { ingestIntakeRecording } from "../src/intake-capture";

async function seedPerson(db: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [p] = await db
    .insert(persons)
    .values({ displayName: "Sam", spokenName: "Sam", lifeStatus: "living" })
    .returning();
  return p!.id;
}

describe("ingestIntakeRecording", () => {
  it("stores audio first, then creates a voice intake answer pointing at the media", async () => {
    const db = await createTestDatabase();
    const storage = new InMemoryMediaStorage();
    const personId = await seedPerson(db);
    const bytes = new Uint8Array([9, 9, 9]);

    const result = await ingestIntakeRecording(db, storage, {
      actor: { kind: "account", personId },
      questionKey: "hometown",
      promptQuestion: "Where did you grow up?",
      audio: { bytes, contentType: "audio/webm" },
    });

    expect(result.storageKey).toMatch(/^intake-audio\//);
    expect(await storage.exists(result.storageKey)).toBe(true);

    const answer = await getIntakeAnswer(db, personId, "hometown");
    expect(answer!.mediaId).toBe(result.mediaId);
    expect(answer!.origin).toBe("voice");
    expect(answer!.text).toBe("");
  });
});
