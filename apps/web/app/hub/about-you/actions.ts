"use server";

/**
 * Intake surface server actions — the single front door for the biographical "introduce yourself"
 * walk reached from /welcome door 2 and the hub reminder. Each call re-resolves the auth context
 * server-side (the client never passes a personId) and keeps @chronicle/interviewer entirely on the
 * server: its index transitively pulls core-adapters → db, which cannot be in a client bundle.
 *
 * The turn loop's per-session `askedIntakeKeys` is made STATELESS across HTTP by threading
 * `askedKeys` from the client. Extraction is best-effort: a failed/empty extraction leaves the field
 * null (re-askable next session) and never throws to the user.
 */
import type { BiographicalProfile } from "@chronicle/db";
import {
  INTAKE_QUESTIONS,
  nextIntakeQuestion,
  extractIntakeAnswer,
  createCoreAnchorSource,
} from "@chronicle/interviewer";
import { getRuntime } from "@/lib/runtime";

export interface NextQuestion {
  key: string;
  text: string;
}

/**
 * Extract ONE biographical field from the narrator's answer, write it if present, then compute the
 * next question from FRESH db truth plus the keys the client has already shown this session. Returns
 * `{ nextQuestion: null }` once intake is complete (or if the profile can't be loaded).
 */
export async function submitIntakeAnswer(
  askedKeys: string[],
  key: string,
  answer: string,
): Promise<{ nextQuestion: NextQuestion | null }> {
  const { db, auth, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");

  const question = INTAKE_QUESTIONS.find((q) => q.key === key);
  if (question) {
    try {
      const value = await extractIntakeAnswer(languageModel, question, answer);
      if (value !== null && value !== undefined) {
        // `value as never`: K is the keyof-union here, so the value type narrows to an intersection
        // TS can't satisfy from the string|boolean union — the runtime value is correct by hint.
        await createCoreAnchorSource(db).writeProfileField(ctx.personId, question.key, value as never);
      }
    } catch {
      // Best-effort: field stays null, question re-askable next session.
    }
  }

  // Recompute from fresh DB truth + the keys the client has already shown this session. Building the
  // asked-set from the typed bank keeps every key a `keyof BiographicalProfile` (no client casts).
  const fresh = await createCoreAnchorSource(db).loadForNarrator(ctx.personId);
  const askedSet = new Set<keyof BiographicalProfile>();
  for (const q of INTAKE_QUESTIONS) {
    if (q.key === key || askedKeys.includes(q.key)) askedSet.add(q.key);
  }
  const next = fresh ? nextIntakeQuestion(fresh.profile, askedSet) : null;
  return { nextQuestion: next ? { key: next.key, text: next.text } : null };
}
