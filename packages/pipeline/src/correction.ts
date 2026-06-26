/**
 * Voice correction (spec Part III): "a correction the elder voices is applied to the prose (a
 * regeneration of the derived field) before sharing; the audio is untouched."
 *
 * This is a tiny coordinator that ties together the two narrow seams that already exist:
 *   1. `applyTranscriptCorrection` (audited core write) — replaces the transcript and CLEARS
 *      prose/title/summary/tags so the derived layer regenerates.
 *   2. `renderStoryFromTranscript` (the in-house prompt over the bought LLM) — re-renders the
 *      derived fields from the corrected transcript.
 *   3. `updateDerivedFields` (audited core write) — persists the new derived rendering.
 *
 * The canonical audio is never accessed here. There is no storage read, no Media write — the
 * recording pointer is structurally immutable through these seams. State stays `pending_approval`
 * throughout; the elder's NEXT voice action (approval) is what advances the story.
 */
import {
  applyTranscriptCorrection,
  getElderBiographicalContext,
  updateDerivedFields,
} from "@chronicle/core";
import type { Database, Story } from "@chronicle/db";
import { renderStoryFromTranscript } from "./render-story";
import type { LanguageModel } from "./contracts";

export interface ApplyVoiceCorrectionInput {
  db: Database;
  languageModel: LanguageModel;
  storyId: string;
  /** The post-correction transcript (the prior transcript plus the elder's spoken fix). */
  correctedTranscript: string;
  /** Original prompt question, passed back into the renderer so framing is preserved. */
  promptQuestion?: string | null;
}

export async function applyVoiceCorrection(
  input: ApplyVoiceCorrectionInput,
): Promise<Story> {
  // 1. Persist the corrected transcript and clear derived fields — also gates on pending_approval.
  const cleared = await applyTranscriptCorrection(
    input.db,
    input.storyId,
    input.correctedTranscript,
  );

  // 2. Re-render the prose from the corrected transcript. Owner profile gives the renderer the
  //    same lightly-held context (spoken name, birth year) it had on first render — never to
  //    invent facts, only to set tone.
  const elder = await getElderBiographicalContext(input.db, cleared.ownerPersonId);
  const render = await renderStoryFromTranscript(input.languageModel, {
    transcript: input.correctedTranscript,
    promptQuestion: input.promptQuestion ?? null,
    ...(elder?.spokenName ? { elderSpokenName: elder.spokenName } : {}),
    ...(elder && elder.birthYear !== null
      ? { elderBirthYear: elder.birthYear }
      : {}),
  });

  // 3. Persist the regenerated derived fields. State stays `pending_approval`; the elder must
  //    still speak the approval, which is what triggers the consent ledger entry.
  return updateDerivedFields(input.db, input.storyId, {
    prose: render.prose,
    title: render.title,
    summary: render.summary,
    tags: render.tags,
  });
}
