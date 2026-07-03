/**
 * Spoken-date parse — turns a short transcript of someone SAYING a date ("March third, nineteen
 * fifty-two", "3/3/52", "the third of March 1952") into a structured {year, month, day}. Used by the
 * onboarding voice control so a narrator can speak their birthday instead of working three dropdowns.
 *
 * It is intentionally conservative: any field the speaker did not clearly state comes back null, and
 * the caller (the DOB step) only PRE-FILLS the dropdowns — the narrator still confirms/edits and the
 * authoritative validation stays in core's completeOnboarding. A field we are unsure about is left
 * for the human, never guessed.
 */
import type { LanguageModel, LanguageModelMessage } from "./contracts";
import {
  SPOKEN_DATE_PARSE_LLM_TEMPERATURE,
  SPOKEN_DATE_PARSE_MAX_OUTPUT_TOKENS,
} from "./constants";

export interface SpokenDate {
  /** Four-digit year, or null when not clearly stated. */
  year: number | null;
  /** Month 1-12, or null when not clearly stated. */
  month: number | null;
  /** Day 1-31, or null when not clearly stated. */
  day: number | null;
}

const SYSTEM_PROMPT = `You extract a single calendar date that a person spoke aloud, usually their
date of birth. You are given a short speech-to-text transcript. Return the date as STRICT JSON:
  {"year": <four-digit integer or null>, "month": <integer 1-12 or null>, "day": <integer 1-31 or null>}

RULES:
- Only fill a field the speaker clearly stated. If they gave a month and year but no day, day is null.
- Expand spoken numbers ("nineteen fifty-two" -> 1952, "the third" -> 3, "oh five" -> a day/month 5).
- A two-digit year is ambiguous; interpret "'52" or "fifty-two" as 1952 (assume 1900s for a birth
  year unless the speaker clearly means a 2000s year).
- Month names and abbreviations map to 1-12 (January/Jan -> 1).
- If the transcript contains no date at all, return {"year": null, "month": null, "day": null}.
- Return ONLY the JSON object, nothing else.`;

function buildMessages(transcript: string): LanguageModelMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Transcript (verbatim, from speech-to-text):\n"""\n${transcript}\n"""` },
  ];
}

/**
 * Parse a spoken date. An empty transcript is a no-op (no LLM call) returning all-null. On any parse
 * failure the result is all-null — the caller degrades to "voice didn't catch a date, use the fields".
 */
export async function parseSpokenDate(
  llm: LanguageModel,
  transcript: string,
): Promise<SpokenDate> {
  if (transcript.trim().length === 0) return { year: null, month: null, day: null };
  const res = await llm.complete({
    messages: buildMessages(transcript),
    responseFormat: "json",
    temperature: SPOKEN_DATE_PARSE_LLM_TEMPERATURE,
    maxOutputTokens: SPOKEN_DATE_PARSE_MAX_OUTPUT_TOKENS,
  });
  return parseSpokenDateResponse(res.text);
}

/**
 * Tolerant parse of the model's response into a validated {year, month, day}. Exported for direct
 * unit testing. Accepts strict JSON or JSON wrapped in ```fences```; anything out of range (a Feb-31,
 * a five-digit year) is clamped back to null so an implausible field can never seed the dropdown.
 */
export function parseSpokenDateResponse(text: string): SpokenDate {
  const json = tryParseJson(text);
  if (!json) return { year: null, month: null, day: null };
  return {
    year: intInRange(json.year, 1000, 9999),
    month: intInRange(json.month, 1, 12),
    day: intInRange(json.day, 1, 31),
  };
}

function intInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidates = [text, fenced ? fenced[1]! : text];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next
    }
  }
  return null;
}
