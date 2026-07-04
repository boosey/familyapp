import { describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDatabase } from "@chronicle/db";
import { persons, intakeAnswers, intakeRevisions } from "@chronicle/db/schema";
import {
  createIntakeRecording,
  saveIntakeTranscript,
  saveIntakeText,
  getIntakeAnswer,
  listAnsweredQuestionKeys,
  appendIntakeRevision,
  listIntakeRevisions,
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

  it("createIntakeRecording re-record upsert: exactly one row, mediaId updated to second recording", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    const first = await createIntakeRecording(db, {
      personId, questionKey: "hometown", promptQuestion: "Q",
      storageKey: "intake-audio/first.webm", contentType: "audio/webm", checksum: "sha256:aaa",
    });
    const second = await createIntakeRecording(db, {
      personId, questionKey: "hometown", promptQuestion: "Q2",
      storageKey: "intake-audio/second.webm", contentType: "audio/webm", checksum: "sha256:bbb",
    });
    // One intake_answers row for (personId, "hometown") — not two.
    const rows = await db
      .select()
      .from(intakeAnswers)
      .where(and(eq(intakeAnswers.personId, personId), eq(intakeAnswers.questionKey, "hometown")));
    expect(rows).toHaveLength(1);
    // Points at the SECOND media row, not the first.
    expect(rows[0]!.mediaId).toBe(second.mediaId);
    expect(rows[0]!.mediaId).not.toBe(first.mediaId);
    // Conflict set wipes transcript + text so they don't carry over from a prior answer.
    expect(rows[0]!.origin).toBe("voice");
    expect(rows[0]!.transcript).toBeNull();
    expect(rows[0]!.text).toBe("");
  });

  it("saveIntakeTranscript throws when no row exists for the given (personId, questionKey)", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await expect(
      saveIntakeTranscript(db, { personId, questionKey: "nope", transcript: "x" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("intake_revisions ledger", () => {
  it("appendIntakeRevision inserts and returns a row", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    const answer = await saveIntakeText(db, {
      personId, questionKey: "hometown", promptQuestion: "Q", text: "New Orleans",
    });
    const rev = await appendIntakeRevision(db, {
      intakeAnswerId: answer.id,
      level: "ai_transcribed",
      text: "new orleans",
      modelId: "mock-whisper-turbo",
    });
    expect(rev.intakeAnswerId).toBe(answer.id);
    expect(rev.level).toBe("ai_transcribed");
    expect(rev.text).toBe("new orleans");
    expect(rev.modelId).toBe("mock-whisper-turbo");
    expect(rev.promptText).toBeNull();
    expect(rev.actorPersonId).toBeNull();
  });

  it("a second append for the same answer gets a larger seq; listIntakeRevisions returns them in seq order", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    const answer = await saveIntakeText(db, {
      personId, questionKey: "hometown", promptQuestion: "Q", text: "x",
    });
    const first = await appendIntakeRevision(db, {
      intakeAnswerId: answer.id, level: "ai_transcribed", text: "raw",
    });
    const second = await appendIntakeRevision(db, {
      intakeAnswerId: answer.id, level: "human_corrected", text: "edited", actorPersonId: personId,
    });
    expect(second.seq).toBeGreaterThan(first.seq);
    const rows = await listIntakeRevisions(db, answer.id);
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(rows.map((r) => r.level)).toEqual(["ai_transcribed", "human_corrected"]);
  });

  it("deleting the parent intake_answers row cascades its revisions", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    const answer = await saveIntakeText(db, {
      personId, questionKey: "hometown", promptQuestion: "Q", text: "x",
    });
    await appendIntakeRevision(db, { intakeAnswerId: answer.id, level: "ai_transcribed", text: "raw" });
    expect(await listIntakeRevisions(db, answer.id)).toHaveLength(1);
    await db.delete(intakeAnswers).where(eq(intakeAnswers.id, answer.id));
    const remaining = await db
      .select()
      .from(intakeRevisions)
      .where(eq(intakeRevisions.intakeAnswerId, answer.id));
    expect(remaining).toHaveLength(0);
  });
});
