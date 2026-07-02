import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import {
  createIntakeRecording,
  saveIntakeTranscript,
  saveIntakeText,
  getIntakeAnswer,
  listAnsweredQuestionKeys,
} from "../src/intake-answer-repository";

async function seedPerson(db: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [p] = await db.insert(persons).values({ spokenName: "Nora", displayName: "Nora", lifeStatus: "living" }).returning();
  return p!.id;
}

describe("intake-answer-repository", () => {
  it("createIntakeRecording writes an immutable media row + a voice intake answer (text empty)", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    const answer = await createIntakeRecording(db, {
      personId,
      questionKey: "hometown",
      promptQuestion: "Where did you grow up?",
      storageKey: "intake-audio/p/a.webm",
      contentType: "audio/webm",
      checksum: "sha256:abc",
    });
    expect(answer.origin).toBe("voice");
    expect(answer.mediaId).not.toBeNull();
    expect(answer.text).toBe("");
  });

  it("saveIntakeTranscript sets transcript and seeds text with it", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await createIntakeRecording(db, {
      personId, questionKey: "hometown", promptQuestion: "Q",
      storageKey: "k", contentType: "audio/webm", checksum: "sha256:abc",
    });
    const updated = await saveIntakeTranscript(db, { personId, questionKey: "hometown", transcript: "I grew up in Metairie." });
    expect(updated.transcript).toBe("I grew up in Metairie.");
    expect(updated.text).toBe("I grew up in Metairie.");
  });

  it("saveIntakeText upserts a typed answer and later edits preserve one row", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await saveIntakeText(db, { personId, questionKey: "occupationSummary", promptQuestion: "Q", text: "Teacher" });
    await saveIntakeText(db, { personId, questionKey: "occupationSummary", promptQuestion: "Q", text: "Schoolteacher for 30 years" });
    const got = await getIntakeAnswer(db, personId, "occupationSummary");
    expect(got!.origin).toBe("typed");
    expect(got!.text).toBe("Schoolteacher for 30 years");
  });

  it("listAnsweredQuestionKeys returns every answered key for the person", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await saveIntakeText(db, { personId, questionKey: "hometown", promptQuestion: "Q", text: "NOLA" });
    await saveIntakeText(db, { personId, questionKey: "occupationSummary", promptQuestion: "Q", text: "Teacher" });
    const keys = await listAnsweredQuestionKeys(db, personId);
    expect(keys.sort()).toEqual(["hometown", "occupationSummary"]);
  });
});
