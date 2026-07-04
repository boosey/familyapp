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
import { and, asc, eq } from "drizzle-orm";
import { media } from "@chronicle/db/content";
import { intakeAnswers, intakeRevisions } from "@chronicle/db/schema";
import type { Database, IntakeAnswer, IntakeRevision, ProseRevisionLevel } from "@chronicle/db";

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

/**
 * After transcription: write the RAW `transcript` and seed the editable `text`. `text` defaults to
 * the raw transcript (verbatim seed) but the caller may pass an already-cleaned `text` while keeping
 * the raw words in `transcript` (ADR-0014 §2: raw stays canonical, the cleaned pass seeds the editor).
 */
export async function saveIntakeTranscript(
  db: Database,
  input: { personId: string; questionKey: string; transcript: string; text?: string },
): Promise<IntakeAnswer> {
  const [row] = await db
    .update(intakeAnswers)
    .set({ transcript: input.transcript, text: input.text ?? input.transcript, updatedAt: new Date() })
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

/** Owner-scoped point-read — no tier-auth check; intake answers are private-to-owner by design. */
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

/**
 * Append one immutable revision to an intake answer's edit-history ledger (ADR-0014 §8). The ledger
 * mirrors the story's prose lineage in shape but is a separate, owner-only table — intake is not a
 * Story. A correction is always a NEW row, never an edit (a trigger forbids UPDATE).
 */
export async function appendIntakeRevision(
  db: Database,
  input: {
    intakeAnswerId: string;
    level: ProseRevisionLevel;
    text: string;
    modelId?: string | null;
    promptText?: string | null;
    actorPersonId?: string | null;
  },
): Promise<IntakeRevision> {
  const [row] = await db
    .insert(intakeRevisions)
    .values({
      intakeAnswerId: input.intakeAnswerId,
      level: input.level,
      text: input.text,
      modelId: input.modelId ?? null,
      promptText: input.promptText ?? null,
      actorPersonId: input.actorPersonId ?? null,
    })
    .returning();
  return row!;
}

/** The intake answer's edit-history in provenance order (oldest first, by monotonic seq). */
export async function listIntakeRevisions(
  db: Database,
  intakeAnswerId: string,
): Promise<IntakeRevision[]> {
  return db
    .select()
    .from(intakeRevisions)
    .where(eq(intakeRevisions.intakeAnswerId, intakeAnswerId))
    .orderBy(asc(intakeRevisions.seq));
}

/** Owner-scoped list — returns only the caller's own answered keys; no tier-auth check needed. */
export async function listAnsweredQuestionKeys(db: Database, personId: string): Promise<string[]> {
  const rows = await db
    .select({ questionKey: intakeAnswers.questionKey })
    .from(intakeAnswers)
    .where(eq(intakeAnswers.personId, personId));
  return rows.map((r) => r.questionKey);
}
