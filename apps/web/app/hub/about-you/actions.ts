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
import {
  saveIntakeText,
  saveIntakeTranscript,
  listAnsweredQuestionKeys,
  getIntakeAnswer,
  appendIntakeRevision,
} from "@chronicle/core";
import {
  transcribeIntakeAudio,
  cleanupTake,
  polishProse,
  plogError,
} from "@chronicle/pipeline";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";

export interface NextQuestion {
  key: string;
  text: string;
}

/**
 * Record path: persist audio, transcribe (RAW), run the light per-take Cleanup, seed the editor with
 * the CLEANED text, and log the provenance ledger (ADR-0014 §2/§8). The raw transcript stays in
 * `transcript` (canonical); the cleaned pass seeds `text`. Two revisions are appended: `ai_transcribed`
 * (raw) then `ai_cleaned` (cleaned). Return the CLEANED text — same shape the client already seeds.
 */
export async function submitIntakeRecording(
  key: string,
  formData: FormData,
): Promise<{ transcript: string }> {
  const { db, storage, auth, transcriber, languageModel } = await getRuntime();
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
    const { text: raw, modelId: transcribeModelId } = await transcribeIntakeAudio(transcriber, {
      bytes,
      contentType,
    });
    // Empty/whitespace transcript is a no-op: nothing to seed and nothing to log (no empty revisions).
    if (raw.trim().length === 0) return { transcript: "" };

    // Cleanup is best-effort: on any failure fall back to the raw transcript (never lose the words).
    // A successful cleanup returns a non-empty modelId; a failure leaves cleanupModelId "" so the
    // `ai_cleaned` revision is skipped (we only log a pass the model actually performed).
    let cleaned = raw;
    let cleanupModelId = "";
    let cleanupPrompt: string | undefined;
    try {
      const out = await cleanupTake(languageModel, { transcript: raw, promptQuestion });
      cleaned = out.prose;
      cleanupModelId = out.modelId;
      cleanupPrompt = out.systemPrompt;
    } catch {
      // Cleanup failed → keep the raw transcript as the seed; provenance still records ai_transcribed.
    }

    const row = await saveIntakeTranscript(db, {
      personId: ctx.personId,
      questionKey: key,
      transcript: raw,
      text: cleaned,
    });

    // Provenance logging is best-effort: a ledger write must never fail the capture request.
    try {
      await appendIntakeRevision(db, {
        intakeAnswerId: row.id,
        level: "ai_transcribed",
        text: raw,
        modelId: transcribeModelId,
      });
      if (cleanupModelId !== "") {
        await appendIntakeRevision(db, {
          intakeAnswerId: row.id,
          level: "ai_cleaned",
          text: cleaned,
          modelId: cleanupModelId,
          promptText: cleanupPrompt,
        });
      }
    } catch (e) {
      plogError("about-you", "submitIntakeRecording: revision logging failed (non-fatal)", {
        person: ctx.personId,
        question: key,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }

    return { transcript: cleaned };
  } catch {
    return { transcript: "" };
  }
}

/**
 * OPT-IN "Polish with AI" for the intake editor (ADR-0014 Inc 4, slice 2) — mirrors the story
 * `polishAnswerProseAction`. Takes the current intake prose (typed or edited) and returns a tidied
 * version. A REAL polish (non-empty modelId) persists `text` AND appends an `ai_polished` revision.
 * Owner-resolved server-side (never the client). Empty-prose taps are a safe no-op (no model, no log).
 */
export async function polishIntakeAnswerAction(
  formData: FormData,
): Promise<{ prose: string } | { error: string }> {
  const { db, auth, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const questionKey = formData.get("questionKey");
  const prose = formData.get("prose");
  if (typeof questionKey !== "string" || !questionKey || typeof prose !== "string") {
    return { error: hub.actions.invalidInput };
  }
  const promptQuestionRaw = formData.get("promptQuestion");
  const question = INTAKE_QUESTIONS.find((q) => q.key === questionKey);
  const promptQuestion =
    typeof promptQuestionRaw === "string" ? promptQuestionRaw : (question?.text ?? null);

  try {
    const result = await polishProse(languageModel, { prose, promptQuestion });
    // Empty/whitespace tap: polishProse returns modelId === "" (no model ran). No-op — persisting an
    // empty/no-model revision would poison the intake edit-history lineage. Mirrors the story action.
    if (result.modelId === "") {
      return { prose: result.prose };
    }
    const row = await getIntakeAnswer(db, ctx.personId, questionKey);
    if (row) {
      // A saved answer exists: persist the polished text and record the ai_polished provenance.
      await saveIntakeText(db, {
        personId: ctx.personId,
        questionKey,
        promptQuestion: promptQuestion ?? questionKey,
        text: result.prose,
      });
      await appendIntakeRevision(db, {
        intakeAnswerId: row.id,
        level: "ai_polished",
        text: result.prose,
        modelId: result.modelId,
        promptText: result.systemPrompt,
      });
    }
    // No saved row yet (a typed answer the user hasn't "Next"-ed): the one real edge. Do NOT crash and
    // do NOT log — there is no answer row to attach a revision to. Return the polished text; the
    // eventual saveIntakeAnswer captures provenance at save time.
    return { prose: result.prose };
  } catch (err) {
    plogError("about-you", "polishIntakeAnswer: failed", {
      person: ctx.personId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.answer.genericError };
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
