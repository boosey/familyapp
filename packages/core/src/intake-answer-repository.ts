/**
 * Audited intake-answer write/read path. `intake_answers` is a non-content table, but this file
 * ALSO writes the kept-audio `media` row (a guarded content table), so it lives inside the
 * architecture allowlist. Intake answers are private-to-owner (never shared), so reads need no
 * tier authorization — the owner is the only reader.
 *
 * Storage-first invariant: the audio bytes must already be in object storage before
 * createIntakeRecording is called (the caller — @chronicle/capture's ingestIntakeRecording —
 * guarantees this), exactly as persistRecordingAndCreateDraft assumes for stories.
 */
import { and, eq } from "drizzle-orm";
import { media } from "@chronicle/db/content";
import { intakeAnswers } from "@chronicle/db/schema";
import type { Database, IntakeAnswer } from "@chronicle/db";

export interface CreateIntakeRecordingInput {
  personId: string;
  questionKey: string;
  promptQuestion: string;
  /** Object-storage key where the immutable audio bytes already live. */
  storageKey: string;
  contentType: string;
  durationSeconds?: number;
  checksum: string;
}

/**
 * Persist the kept audio as an immutable media row, then upsert the voice intake answer pointing
 * at it (text seeded empty, pending transcription). Upsert on (personId, questionKey): re-recording
 * an already-answered question replaces the pointer. (Known limitation, capture-only scope: the
 * previously-referenced media row is orphaned on re-record; a cleanup/delete pass is a follow-up.)
 */
export async function createIntakeRecording(
  db: Database,
  input: CreateIntakeRecordingInput,
): Promise<IntakeAnswer> {
  return db.transaction(async (tx) => {
    const [rec] = await tx
      .insert(media)
      .values({
        ownerPersonId: input.personId,
        kind: "intake_audio",
        storageKey: input.storageKey,
        contentType: input.contentType,
        durationSeconds: input.durationSeconds ?? null,
        checksum: input.checksum,
      })
      .returning();
    const [row] = await tx
      .insert(intakeAnswers)
      .values({
        personId: input.personId,
        questionKey: input.questionKey,
        promptQuestion: input.promptQuestion,
        origin: "voice",
        mediaId: rec!.id,
        transcript: null,
        text: "",
      })
      .onConflictDoUpdate({
        target: [intakeAnswers.personId, intakeAnswers.questionKey],
        set: {
          promptQuestion: input.promptQuestion,
          origin: "voice",
          mediaId: rec!.id,
          transcript: null,
          text: "",
          updatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  });
}

/** After transcription: write the raw transcript and seed the editable `text` with it. */
export async function saveIntakeTranscript(
  db: Database,
  input: { personId: string; questionKey: string; transcript: string },
): Promise<IntakeAnswer> {
  const [row] = await db
    .update(intakeAnswers)
    .set({ transcript: input.transcript, text: input.transcript, updatedAt: new Date() })
    .where(
      and(eq(intakeAnswers.personId, input.personId), eq(intakeAnswers.questionKey, input.questionKey)),
    )
    .returning();
  if (!row) throw new Error(`intake answer not found: ${input.personId}/${input.questionKey}`);
  return row;
}

/**
 * Save the final answer text. Upsert: a fresh typed answer inserts a `typed` row; editing an
 * existing (voice or typed) row updates ONLY `text` (origin/media/transcript preserved).
 */
export async function saveIntakeText(
  db: Database,
  input: { personId: string; questionKey: string; promptQuestion: string; text: string },
): Promise<IntakeAnswer> {
  const [row] = await db
    .insert(intakeAnswers)
    .values({
      personId: input.personId,
      questionKey: input.questionKey,
      promptQuestion: input.promptQuestion,
      origin: "typed",
      mediaId: null,
      transcript: null,
      text: input.text,
    })
    .onConflictDoUpdate({
      target: [intakeAnswers.personId, intakeAnswers.questionKey],
      set: { text: input.text, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function getIntakeAnswer(
  db: Database,
  personId: string,
  questionKey: string,
): Promise<IntakeAnswer | null> {
  const [row] = await db
    .select()
    .from(intakeAnswers)
    .where(and(eq(intakeAnswers.personId, personId), eq(intakeAnswers.questionKey, questionKey)))
    .limit(1);
  return row ?? null;
}

export async function listAnsweredQuestionKeys(db: Database, personId: string): Promise<string[]> {
  const rows = await db
    .select({ questionKey: intakeAnswers.questionKey })
    .from(intakeAnswers)
    .where(eq(intakeAnswers.personId, personId));
  return rows.map((r) => r.questionKey);
}
