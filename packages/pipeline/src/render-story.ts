/**
 * Speech-to-story render — the in-house prompt + parse logic that wraps the bought LLM.
 *
 * Behavior policy lives HERE, not in the vendor: "lightly clean false starts and filler while
 * preserving the narrator's actual words, idiom, and meaning. This is NOT a literary rewrite —
 * authenticity beats polish; an LLM left unconstrained will drift from how the person actually
 * speaks." The vendor only sees the assembled messages.
 *
 * Output is parsed defensively: we ask for JSON, but if the model returns plain text we still
 * produce a usable record (prose = full response, title/summary fall back to the first line,
 * tags = []). The render is regenerable — a future model can be re-run; only derived fields
 * change. The canonical audio is irrelevant to this stage and never accessed here.
 */
import type {
  LanguageModel,
  LanguageModelMessage,
} from "./contracts";

export interface RenderInput {
  transcript: string;
  /** The question that prompted the telling, if any — gives the model the framing the narrator heard. */
  promptQuestion?: string | null;
  /** Lightly-held narrator context the model may use to set names/tone (never to invent facts). */
  narratorSpokenName?: string;
  narratorBirthYear?: number;
}

export interface RenderOutput {
  prose: string;
  title: string;
  summary: string;
  tags: string[];
  modelId: string;
}

const SYSTEM_PROMPT = `You are a careful oral-history editor preparing a family member's spoken
recollection for the family to read. The audio recording is the canonical artifact; what you
produce is a clearly-secondary written rendering.

ABSOLUTE RULES — non-negotiable:
- Preserve the speaker's actual words, idiom, dialect, and meaning. Do NOT paraphrase, embellish,
  or "improve" the writing style. Authenticity beats polish.
- You may remove obvious filler ("uh", "um", "you know"), false starts, and accidental repetition.
  You may join broken-up sentences into coherent ones when the speaker's intent is clear.
- You may NOT add facts, dates, names, places, feelings, or details that are not in the
  transcript. If the speaker is vague, the prose is vague — that is correct.
- You may NOT change the speaker's emotional register, soften difficult content, or moralize.
- Keep the speaker's first-person voice. Do not narrate ABOUT them in the third person.
- Use the speaker's own phrases as section seeds where possible.

Return STRICT JSON with these fields:
  prose:   the lightly-cleaned prose rendering (string)
  title:   a short title in the speaker's own words where possible (string, <= 80 chars)
  summary: one sentence summary, also faithful (string, <= 200 chars)
  tags:    a short array of theme/entity tags drawn FROM the transcript (string[], <= 8)

Return ONLY the JSON object. No prose around it.`;

function buildMessages(input: RenderInput): LanguageModelMessage[] {
  const ctxLines: string[] = [];
  if (input.narratorSpokenName) ctxLines.push(`Speaker's spoken name: ${input.narratorSpokenName}`);
  if (input.narratorBirthYear) ctxLines.push(`Speaker's birth year: ${input.narratorBirthYear}`);
  if (input.promptQuestion) ctxLines.push(`Question that prompted the telling: ${input.promptQuestion}`);
  const ctxBlock = ctxLines.length ? `${ctxLines.join("\n")}\n\n` : "";
  const userContent = `${ctxBlock}Transcript (verbatim, from speech-to-text):\n"""\n${input.transcript}\n"""`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

export async function renderStoryFromTranscript(
  llm: LanguageModel,
  input: RenderInput,
): Promise<RenderOutput> {
  const messages = buildMessages(input);
  const res = await llm.complete({
    messages,
    responseFormat: "json",
    temperature: 0.2,
    maxOutputTokens: 4000,
  });
  return { ...parseRenderResponse(res.text, input.transcript), modelId: res.modelId };
}

/**
 * Tolerant parse: the model may return strict JSON, JSON wrapped in ```fences```, or plain prose
 * (an adapter without JSON-mode support). We try each in order so a stage can still succeed
 * even when a vendor mode misbehaves — the derived fields are regenerable anyway.
 */
export function parseRenderResponse(
  text: string,
  fallbackProse: string,
): Omit<RenderOutput, "modelId"> {
  const json = tryParseJson(text);
  if (json) {
    return {
      prose: typeof json.prose === "string" ? json.prose : fallbackProse,
      title:
        typeof json.title === "string" && json.title.trim()
          ? json.title.slice(0, 200)
          : firstLineFallback(fallbackProse, 80),
      summary:
        typeof json.summary === "string" && json.summary.trim()
          ? json.summary.slice(0, 400)
          : firstLineFallback(fallbackProse, 200),
      tags: Array.isArray(json.tags)
        ? json.tags
            .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
            .slice(0, 8)
        : [],
    };
  }
  // Plain-text fallback: treat the whole response as prose.
  return {
    prose: text.trim() || fallbackProse,
    title: firstLineFallback(text || fallbackProse, 80),
    summary: firstLineFallback(text || fallbackProse, 200),
    tags: [],
  };
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const candidates = [text, stripFences(text)];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      // Reject arrays + null — `typeof null === "object"` and arrays satisfy `typeof === "object"`
      // too, but the renderer expects a record-shaped response.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return m ? m[1]! : text;
}

function firstLineFallback(text: string, maxLen: number): string {
  const firstLine = text.split(/\n|[.!?]\s/)[0]?.trim() ?? "";
  return firstLine.slice(0, maxLen) || "Untitled";
}
