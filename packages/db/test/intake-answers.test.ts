import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDatabase } from "@chronicle/db";
import { intakeAnswers, persons } from "@chronicle/db/schema";

// `media` is a guarded content table — NOT exported from @chronicle/db/schema. Import it from the
// content subpath for test seeding of the FK target. (Test files are exempt from the architecture
// allowlist scan, so this content import is fine here.)
import { media as contentMedia } from "@chronicle/db/content";

async function seedPerson(db: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [p] = await db
    .insert(persons)
    .values({ spokenName: "Test", displayName: "Test", lifeStatus: "living" })
    .returning();
  return p!.id;
}

describe("intake_answers table", () => {
  it("stores a typed answer (no media, no transcript)", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    const [row] = await db
      .insert(intakeAnswers)
      .values({
        personId,
        questionKey: "hometown",
        promptQuestion: "Where did you grow up?",
        origin: "typed",
        text: "New Orleans",
      })
      .returning();
    expect(row!.origin).toBe("typed");
    expect(row!.mediaId).toBeNull();
    expect(row!.transcript).toBeNull();
    expect(row!.text).toBe("New Orleans");
  });

  it("upserts on (personId, questionKey): re-answering replaces text", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    const base = {
      personId,
      questionKey: "hometown",
      promptQuestion: "Where did you grow up?",
      origin: "typed" as const,
    };
    await db.insert(intakeAnswers).values({ ...base, text: "first" });
    await db
      .insert(intakeAnswers)
      .values({ ...base, text: "second" })
      .onConflictDoUpdate({
        target: [intakeAnswers.personId, intakeAnswers.questionKey],
        set: { text: "second" },
      });
    const rows = await db
      .select()
      .from(intakeAnswers)
      .where(and(eq(intakeAnswers.personId, personId), eq(intakeAnswers.questionKey, "hometown")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("second");
  });

  it("permits deleting intake media after the answer row is removed (no consent link)", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    const [m] = await db
      .insert(contentMedia)
      .values({
        ownerPersonId: personId,
        kind: "intake_audio",
        storageKey: "intake-audio/x/y.webm",
        contentType: "audio/webm",
        checksum: "sha256:deadbeef",
      })
      .returning();
    const [row] = await db
      .insert(intakeAnswers)
      .values({
        personId,
        questionKey: "hometown",
        promptQuestion: "Where did you grow up?",
        origin: "voice",
        mediaId: m!.id,
        text: "spoken words",
      })
      .returning();
    // answer-first, then media (mirrors discardDraftStory ordering; media trigger allows it
    // because the row is not consent-linked).
    await db.delete(intakeAnswers).where(eq(intakeAnswers.id, row!.id));
    await expect(
      db.delete(contentMedia).where(eq(contentMedia.id, m!.id)),
    ).resolves.not.toThrow();
  });
});
