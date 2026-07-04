/**
 * Per-take CLEANUP — the AUTOMATIC light pass over ONE freshly-transcribed voice take (ADR-0014 §2).
 *
 * This is the lighter sibling of `polishProse` (the manual, holistic ✨ Polish). Cleanup sees exactly
 * one take, never reorders, and only tidies within-take disfluency + within-take self-corrections.
 * De-rambling and cross-take corrections are the human-confirmed Polish's job — never Cleanup's — so
 * appending a new take can never silently rewrite earlier words (the pass-scope invariant).
 *
 * Output is plain text (the cleaned take only). An empty/whitespace transcript is a no-op that never
 * reaches the LLM (empty prose out). A non-empty take whose model output is empty falls back to the
 * raw transcript — Cleanup never deletes a take's words.
 */
import type { LanguageModel, LanguageModelMessage } from "./contracts";
import {
  STORY_RENDER_LLM_TEMPERATURE,
  STORY_RENDER_MAX_OUTPUT_TOKENS,
} from "./constants";

export interface CleanupTakeInput {
  /** ONE take's raw speech-to-text. Never a stitched multi-take transcript. */
  transcript: string;
  /** The question that prompted the telling, if any — framing only, never a source of new facts. */
  promptQuestion?: string | null;
  /** The narrator's spoken name, so the model keeps first-person voice consistent. */
  narratorSpokenName?: string;
}

export interface CleanupTakeOutput {
  /** The cleaned take. Empty string when the input was empty/whitespace (a no-op). */
  prose: string;
  /** The model that produced the cleanup (empty string on the no-op path — no model was called). */
  modelId: string;
  /** The exact system prompt used, recorded as `ai_cleaned` provenance. */
  systemPrompt: string;
}

export const CLEANUP_SYSTEM_PROMPT = `You are a careful oral-history editor preparing ONE spoken take
for a family member to read. This is the light, automatic cleanup pass — NOT a rewrite, and NOT the
stronger "Polish" pass.

You are given the raw speech-to-text of a SINGLE take. You never see any other take; do not assume
any context before or after this text.

WHAT YOU SHOULD DO:
- Remove obvious filler ("uh", "um", "you know"), false starts, and accidental repetition.
- Join broken-up sentences into coherent ones when the speaker's intent is clear.
- Resolve a WITHIN-TAKE self-correction: when the speaker corrects themselves inside this same take
  ("he was born in 1985 — oh wait, no, 1987"), keep ONLY the corrected version and drop the false
  start and the scaffolding ("oh wait", "no", "actually", "I mean"). If it is genuinely unclear which
  value they settled on, KEEP their own hedge rather than guessing.

WHAT YOU MUST NOT DO:
- Do NOT reorder, restructure, or de-ramble. Preserve the order in which things were said. Making
  rambling passages flow is the separate, human-confirmed Polish pass — it is NOT your job.
- Do NOT add facts, dates, names, places, feelings, or details that are not in this take. If the
  speaker is vague, stay vague — that is correct.
- Do NOT change the speaker's emotional register, soften difficult content, or moralize.
- Do NOT narrate ABOUT the speaker. Keep their first-person voice, their own words, and their idiom.

Return ONLY the cleaned text of this take as plain text. No preamble, no quotation marks around it,
no notes.`;

function buildMessages(input: CleanupTakeInput): LanguageModelMessage[] {
  const ctxLines: string[] = [];
  if (input.narratorSpokenName) ctxLines.push(`Speaker's spoken name: ${input.narratorSpokenName}`);
  if (input.promptQuestion) ctxLines.push(`Question that prompted the telling: ${input.promptQuestion}`);
  const ctxBlock = ctxLines.length ? `${ctxLines.join("\n")}\n\n` : "";
  const userContent = `${ctxBlock}Take transcript (verbatim, from speech-to-text):\n"""\n${input.transcript}\n"""`;
  return [
    { role: "system", content: CLEANUP_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

export async function cleanupTake(
  llm: LanguageModel,
  input: CleanupTakeInput,
): Promise<CleanupTakeOutput> {
  const raw = input.transcript.trim();
  if (raw.length === 0) {
    return { prose: "", modelId: "", systemPrompt: CLEANUP_SYSTEM_PROMPT };
  }
  const messages = buildMessages(input);
  const res = await llm.complete({
    messages,
    responseFormat: "text",
    temperature: STORY_RENDER_LLM_TEMPERATURE,
    maxOutputTokens: STORY_RENDER_MAX_OUTPUT_TOKENS,
  });
  const cleaned = res.text.trim();
  return {
    // Never delete the take: an empty model response falls back to the raw transcript. This is a
    // deliberate precedence — "never delete a take" (ADR-0014's never-silently-drop ethos) beats
    // "remove filler". A genuinely filler-only take therefore surfaces its raw filler rather than
    // vanishing; the safe failure mode, since we cannot distinguish "all filler" from "model failed".
    prose: cleaned.length > 0 ? cleaned : raw,
    modelId: res.modelId,
    systemPrompt: CLEANUP_SYSTEM_PROMPT,
  };
}
