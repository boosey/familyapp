/**
 * Narrator-memory extraction. Pulls a set of durable, cross-session "memories" (small titled facts
 * about the narrator) from a block of transcript text, so the interviewer can recall them later.
 *
 * `extractNarratorMemory` returns an array of well-formed `ExtractedMemory` — the LLM is asked for a
 * raw JSON array, but the parse is defensive in the same spirit as extract-biography/render-story:
 * an unparseable response (or a non-array, or malformed elements) yields `[]` rather than throwing.
 * A failed inference must never corrupt the store or block whatever write path invoked it.
 */
import type { LanguageModel } from "./contracts";
import {
  NARRATOR_MEMORY_EXTRACT_LLM_TEMPERATURE,
  NARRATOR_MEMORY_EXTRACT_MAX_OUTPUT_TOKENS,
} from "./constants";

export interface ExtractedMemory {
  title: string;
  summary: string;
  tags: string[];
  confidence: number;
}

const SYSTEM_PROMPT = `You extract durable, cross-session memories about a narrator from a transcript of them talking about their life.
Return ONLY raw JSON: an array of objects, each with exactly these keys: title (string), summary (string), tags (array of strings), confidence (number between 0 and 1).
Each memory is a small, self-contained fact worth remembering across future conversations. Omit anything trivial or uncertain.
Return an empty array [] if there is nothing worth remembering. No markdown, no prose.`;

export async function extractNarratorMemory(
  text: string,
  llm: LanguageModel,
): Promise<ExtractedMemory[]> {
  if (!text.trim()) return [];
  const res = await llm.complete({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `TRANSCRIPT:\n${text}` },
    ],
    responseFormat: "text",
    temperature: NARRATOR_MEMORY_EXTRACT_LLM_TEMPERATURE,
    maxOutputTokens: NARRATOR_MEMORY_EXTRACT_MAX_OUTPUT_TOKENS,
  });
  try {
    const parsed = JSON.parse(res.text.trim()) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ExtractedMemory[] = [];
    for (const el of parsed) {
      const memory = coerceMemory(el);
      if (memory) out.push(memory);
    }
    return out;
  } catch {
    return [];
  }
}

/** Keep only well-formed elements; coerce tags/confidence to safe values. Returns null to drop. */
function coerceMemory(el: unknown): ExtractedMemory | null {
  if (!el || typeof el !== "object" || Array.isArray(el)) return null;
  const rec = el as Record<string, unknown>;
  if (typeof rec.title !== "string" || rec.title.length === 0) return null;
  if (typeof rec.summary !== "string") return null;
  const tags = Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string") : [];
  const rawConfidence =
    typeof rec.confidence === "number" && Number.isFinite(rec.confidence) ? rec.confidence : 0;
  const confidence = Math.min(1, Math.max(0, rawConfidence));
  return { title: rec.title, summary: rec.summary, tags, confidence };
}
