/**
 * FINISH-TIME METADATA derivation (ADR-0014 §5). One short LM call over the WHOLE final composed text
 * that returns title/summary/tags only — NO prose (the prose is authored, never regenerated, §7) and
 * NO eraYear (deferred inference; v1 uses a supplied era). Runs synchronously in the Finish action;
 * the durable queue is reserved for background work.
 *
 * The JSON parse + fallbacks + length/count caps are shared with the legacy render path via
 * `parseRenderResponse` (we ask for {title, summary, tags}; its `prose` is ignored). This keeps one
 * parser and one set of caps, and leaves `render-story.ts` untouched for the old flow Inc 3 retires.
 */
import type { LanguageModel, LanguageModelMessage } from "./contracts";
import {
  STORY_RENDER_LLM_TEMPERATURE,
  STORY_RENDER_MAX_OUTPUT_TOKENS,
} from "./constants";
import { parseRenderResponse } from "./render-story";

export interface DeriveMetadataInput {
  /** The whole final composed prose (all takes + edits), as sealed at Finish. */
  fullText: string;
  /** The question that prompted the telling, if any — framing only. */
  promptQuestion?: string | null;
  /** The narrator's spoken name, for faithful titling. */
  narratorSpokenName?: string;
}

export interface DeriveMetadataOutput {
  title: string;
  summary: string;
  tags: string[];
  modelId: string;
  /** The exact system prompt used, for provenance/eval. */
  systemPrompt: string;
}

export const METADATA_SYSTEM_PROMPT = `You are a careful oral-history archivist. You are given the
FINAL written text of a family member's story (already cleaned and edited — do not change it). Produce
only catalog metadata for it, drawn strictly FROM the text.

ABSOLUTE RULES:
- Do NOT rewrite, summarize away, or alter the story text. You only produce metadata.
- Draw the title, summary, and tags ONLY from what the text actually says. Do NOT add facts, names,
  dates, places, or themes that are not present. If the text is vague, the metadata is vague.
- Keep the speaker's own words and register where possible; a title in their own phrase is best.

Return STRICT JSON with exactly these fields:
  title:   a short title in the speaker's own words where possible (string, <= 80 chars)
  summary: one faithful sentence (string, <= 200 chars)
  tags:    a short array of theme/entity tags drawn FROM the text (string[], <= 8)

Return ONLY the JSON object. No prose around it.`;

function buildMessages(input: DeriveMetadataInput): LanguageModelMessage[] {
  const ctxLines: string[] = [];
  if (input.narratorSpokenName) ctxLines.push(`Speaker's spoken name: ${input.narratorSpokenName}`);
  if (input.promptQuestion) ctxLines.push(`Question that prompted the telling: ${input.promptQuestion}`);
  const ctxBlock = ctxLines.length ? `${ctxLines.join("\n")}\n\n` : "";
  const userContent = `${ctxBlock}Final story text:\n"""\n${input.fullText}\n"""`;
  return [
    { role: "system", content: METADATA_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

export async function deriveMetadata(
  llm: LanguageModel,
  input: DeriveMetadataInput,
): Promise<DeriveMetadataOutput> {
  const messages = buildMessages(input);
  const res = await llm.complete({
    messages,
    responseFormat: "json",
    temperature: STORY_RENDER_LLM_TEMPERATURE,
    maxOutputTokens: STORY_RENDER_MAX_OUTPUT_TOKENS,
  });
  // Reuse the render parser's JSON/plain-text tolerance + caps; discard its `prose`.
  const { title, summary, tags } = parseRenderResponse(res.text, input.fullText);
  return { title, summary, tags, modelId: res.modelId, systemPrompt: METADATA_SYSTEM_PROMPT };
}
