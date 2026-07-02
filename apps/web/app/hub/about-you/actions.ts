"use server";

/**
 * Intake surface server actions — the single front door for the biographical "introduce yourself"
 * walk. Each call re-resolves auth server-side (the client never passes a personId). Two paths:
 *   - submitIntakeRecording: keep audio + transcribe, return the transcript for the user to edit.
 *   - saveIntakeAnswer: persist the final (edited or typed) text, extract the profile field
 *     (best-effort), and compute the next question from FRESH db truth.
 */
import type { BiographicalProfile } from "@chronicle/db";
import {
  INTAKE_QUESTIONS,
  nextIntakeQuestion,
  extractIntakeAnswer,
  createCoreAnchorSource,
} from "@chronicle/interviewer";
import { ingestIntakeRecording } from "@chronicle/capture";
import { saveIntakeText, saveIntakeTranscript, listAnsweredQuestionKeys } from "@chronicle/core";
import { transcribeIntakeAudio } from "@chronicle/pipeline";
import { getRuntime } from "@/lib/runtime";

export interface NextQuestion {
  key: string;
  text: string;
}

/** Record path: persist audio, transcribe, seed text; return the transcript for editing. */
export async function submitIntakeRecording(
  key: string,
  formData: FormData,
): Promise<{ transcript: string }> {
  const { db, storage, auth, transcriber } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");

  const question = INTAKE_QUESTIONS.find((q) => q.key === key);
  const promptQuestion = question?.text ?? key;

  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) throw new Error("no audio");
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const contentType = audio.type || "audio/webm";

  await ingestIntakeRecording(db, storage, {
    actor: { kind: "account", personId: ctx.personId },
    questionKey: key,
    promptQuestion,
    audio: { bytes, contentType },
  });

  // Transcribe (best-effort): a failure leaves transcript empty and the user types into an empty box.
  try {
    const { text } = await transcribeIntakeAudio(transcriber, { bytes, contentType });
    await saveIntakeTranscript(db, { personId: ctx.personId, questionKey: key, transcript: text });
    return { transcript: text };
  } catch {
    return { transcript: "" };
  }
}

/** Save the final text (edited transcript OR typed), extract the field, compute the next question. */
export async function saveIntakeAnswer(
  askedKeys: string[],
  key: string,
  text: string,
): Promise<{ nextQuestion: NextQuestion | null }> {
  const { db, auth, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");

  const question = INTAKE_QUESTIONS.find((q) => q.key === key);
  const promptQuestion = question?.text ?? key;

  // Persist the durable answer. Empty/whitespace text is a no-op skip (exit-without-typing).
  if (text.trim().length > 0) {
    await saveIntakeText(db, { personId: ctx.personId, questionKey: key, promptQuestion, text });
    if (question) {
      try {
        const value = await extractIntakeAnswer(languageModel, question, text);
        if (value !== null && value !== undefined) {
          // `value as never`: K is the keyof-union here, so the value type narrows to an intersection
          // TS can't satisfy from the string|boolean union — the runtime value is correct by hint.
          await createCoreAnchorSource(db).writeProfileField(ctx.personId, question.key, value as never);
        }
      } catch {
        // Best-effort: field stays null, re-askable; the saved text is unaffected.
      }
    }
  }

  // Next question from FRESH db truth: a question is "answered" if it has a saved intake row OR its
  // profile field is populated OR it was shown this session.
  const answeredKeys = new Set<string>(await listAnsweredQuestionKeys(db, ctx.personId));
  const fresh = await createCoreAnchorSource(db).loadForNarrator(ctx.personId);
  const askedSet = new Set<keyof BiographicalProfile>();
  for (const q of INTAKE_QUESTIONS) {
    if (q.key === key || askedKeys.includes(q.key) || answeredKeys.has(q.key)) askedSet.add(q.key);
  }
  const next = fresh ? nextIntakeQuestion(fresh.profile, askedSet) : null;
  return { nextQuestion: next ? { key: next.key, text: next.text } : null };
}
