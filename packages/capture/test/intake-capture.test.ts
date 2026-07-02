import { getIntakeAnswer } from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import {
  InMemoryMediaStorage,
  type MediaStorage,
  type PutObjectInput,
} from "@chronicle/storage";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ingestIntakeRecording } from "../src/intake-capture";

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

function storageObjectCount(s: InMemoryMediaStorage): number {
  return s.size;
}

async function rowCount(table: "media" | "intake_answers"): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
  return rows[0]?.n ?? 0;
}

async function seedPerson() {
  const [p] = await db
    .insert(persons)
    .values({ displayName: "Sam", spokenName: "Sam", lifeStatus: "living" })
    .returning();
  return p!.id;
}

describe("ingestIntakeRecording", () => {
  it("stores audio first, then creates a voice intake answer pointing at the media", async () => {
    const personId = await seedPerson();
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

  it(
    "if the DB write fails after the storage upload, the audio is preserved " +
      "(authenticity-beats-polish trade-off) and no intake_answers row is created",
    async () => {
      // The storage-first ordering is deliberate: if the DB write fails, the narrator's audio
      // is still durable in object storage — recoverable evidence is the lesser evil. This test
      // pins that contract for the intake path, mirroring the story path's analogous test.
      const personId = await seedPerson();

      // Drop intake_answers so the upsert inside createIntakeRecording throws, rolling back the
      // whole transaction — both the media insert and the intake_answers upsert are rolled back,
      // leaving zero DB rows. The audio upload happened BEFORE the transaction, so it survives.
      await db.execute(sql`DROP TABLE intake_answers CASCADE`);

      await expect(
        ingestIntakeRecording(db, storage, {
          actor: { kind: "account", personId },
          questionKey: "hometown",
          promptQuestion: "Where did you grow up?",
          audio: { bytes: new Uint8Array([99, 99, 99]), contentType: "audio/webm" },
        }),
      ).rejects.toThrow();

      // Storage: the blob IS present (audio is preserved on partial failure).
      expect(storageObjectCount(storage)).toBe(1);
      // DB: media is empty (the media insert was rolled back with the transaction).
      expect(await rowCount("media")).toBe(0);
    },
  );

  it("if storage.put fails, NEITHER an orphan blob NOR a DB row is created", async () => {
    const personId = await seedPerson();

    const failingStorage: MediaStorage = {
      put: async (_input: PutObjectInput) => {
        throw new Error("simulated R2 outage");
      },
      getBytes: async () => null,
      exists: async () => false,
      getUrl: async (k: string) => `nowhere://${k}`,
      delete: async () => {},
    };

    await expect(
      ingestIntakeRecording(db, failingStorage, {
        actor: { kind: "account", personId },
        questionKey: "hometown",
        promptQuestion: "Where did you grow up?",
        audio: { bytes: new Uint8Array([7, 7]), contentType: "audio/webm" },
      }),
    ).rejects.toThrow(/simulated R2 outage/);

    expect(await rowCount("media")).toBe(0);
    expect(await rowCount("intake_answers")).toBe(0);
  });
});
