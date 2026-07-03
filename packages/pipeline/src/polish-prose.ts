/**
 * OPT-IN prose polish — the in-house prompt that wraps the bought LLM for the "Polish with AI"
 * affordance the narrator taps on the review/approve surfaces.
 *
 * This is DELIBERATELY a stronger transform than the default story render (render-story.ts), which
 * only removes disfluencies and is applied automatically. Polish is user-initiated, reversible in the
 * editor (undo/redo), and NEVER canonical — the audio recording remains the source of truth. So it is
 * allowed to do the two things the narrator explicitly asked for: make rambling prose more coherent,
 * and RESOLVE spoken self-corrections (turn "he was born in '85 — oh wait, 1987" into "he was born in
 * 1987"). It still may not invent facts, change the register, or leave the first person.
 *
 * Output is plain text (the rewritten prose only). An empty/whitespace input never reaches the LLM —
 * it is returned unchanged, so the button is a safe no-op on an empty editor.
 */
import type { LanguageModel, LanguageModelMessage } from "./contracts";
import {
  PROSE_POLISH_LLM_TEMPERATURE,
  PROSE_POLISH_MAX_OUTPUT_TOKENS,
} from "./constants";

export interface PolishProseInput {
  /** The current (possibly hand-edited) prose to tidy. */
  prose: string;
  /** The question that prompted the telling, if any — framing only, never a source of new facts. */
  promptQuestion?: string | null;
  /** The narrator's spoken name, so the model keeps first-person voice consistent. */
  narratorSpokenName?: string;
}

export interface PolishProseOutput {
  /** The polished prose. Equals the input verbatim when the input was empty/whitespace. */
  prose: string;
  /** The model that produced the polish (empty string on the no-op path — no model was called). */
  modelId: string;
  /** The exact system prompt used, for provenance/eval. */
  systemPrompt: string;
}

export const POLISH_SYSTEM_PROMPT = `You are a careful oral-history editor. A family member has a
written rendering of something they said aloud, and they have ASKED you to tidy it up so it reads
more clearly for their family. The audio recording remains the canonical artifact; your output is a
clearly-secondary written rendering they will review and can revert.

WHAT YOU SHOULD DO:
- Make rambling or circular passages more coherent and easier to read, while keeping the speaker's
  own words, idiom, dialect, and meaning. This is light editing, NOT a literary rewrite.
- RESOLVE spoken self-corrections. When the speaker corrects themselves ("he was born in 1985 — oh
  wait, no, 1987", "we moved in, um, it was '62, actually '63"), keep ONLY the corrected version and
  remove the false start and the correction scaffolding ("oh wait", "no", "actually", "I mean").
- Remove obvious filler ("uh", "um", "you know"), accidental repetition, and false starts.
- Join broken-up sentences into coherent ones when the speaker's intent is clear.

WHAT YOU MUST NOT DO:
- Do NOT add facts, dates, names, places, feelings, or details that are not already in the text. If
  the speaker is vague, stay vague — that is correct.
- Do NOT change the speaker's emotional register, soften difficult content, or moralize.
- Do NOT narrate ABOUT the speaker in the third person. Keep their first-person voice.
- Do NOT invent a resolution to a self-correction: if it is genuinely unclear which value the
  speaker settled on, keep their own hedge rather than picking one.

Return ONLY the polished prose as plain text. No preamble, no quotation marks around it, no notes.`;

function buildMessages(input: PolishProseInput): LanguageModelMessage[] {
  const ctxLines: string[] = [];
  if (input.narratorSpokenName) ctxLines.push(`Speaker's spoken name: ${input.narratorSpokenName}`);
  if (input.promptQuestion) ctxLines.push(`Question that prompted the telling: ${input.promptQuestion}`);
  const ctxBlock = ctxLines.length ? `${ctxLines.join("\n")}\n\n` : "";
  const userContent = `${ctxBlock}Prose to polish:\n"""\n${input.prose}\n"""`;
  return [
    { role: "system", content: POLISH_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

/**
 * Run the opt-in polish. The empty/whitespace input is a no-op (no LLM call) so the affordance is
 * always safe to tap. On a non-empty input the model returns the rewritten prose as plain text; if
 * the model returns nothing usable we fall back to the original prose (a polish never DELETES the
 * narrator's words — the worst case is "no change").
 */
export async function polishProse(
  llm: LanguageModel,
  input: PolishProseInput,
): Promise<PolishProseOutput> {
  if (input.prose.trim().length === 0) {
    return { prose: input.prose, modelId: "", systemPrompt: POLISH_SYSTEM_PROMPT };
  }
  const messages = buildMessages(input);
  const res = await llm.complete({
    messages,
    responseFormat: "text",
    temperature: PROSE_POLISH_LLM_TEMPERATURE,
    maxOutputTokens: PROSE_POLISH_MAX_OUTPUT_TOKENS,
  });
  const polished = stripWrappingQuotes(res.text.trim());
  return {
    prose: polished.length > 0 ? polished : input.prose,
    modelId: res.modelId,
    systemPrompt: POLISH_SYSTEM_PROMPT,
  };
}

/**
 * A model instructed to "return only the prose" occasionally still wraps the whole thing in one pair
 * of quotes. Strip a single symmetric wrapping pair (straight or curly) so the narrator doesn't have
 * to. Anything else — internal quotes, a single stray quote — is left untouched.
 */
function stripWrappingQuotes(text: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["“", "”"],
    ["'", "'"],
  ];
  for (const [open, close] of pairs) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(1, -1);
      // Only strip when there is no other unescaped occurrence of the same quote inside, so we don't
      // mangle prose that legitimately opens and closes on a quote mark.
      if (!inner.includes(open) && !inner.includes(close)) return inner.trim();
    }
  }
  return text;
}
