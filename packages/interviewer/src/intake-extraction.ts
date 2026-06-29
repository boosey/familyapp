/**
 * Per-turn intake extraction. After the narrator answers an intake question, pull the ONE
 * structured value that question targets. Ephemeral: the answer text is not stored; only the
 * extracted value is written to the profile. Returns null when nothing confident is present.
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type { IntakeQuestion } from "./questions/intake";

const SYSTEM_PROMPT = `You extract ONE structured biographical value from a person's spoken answer.
Return ONLY raw JSON of the form {"value": ...} — no markdown, no prose.
Follow the extraction instruction exactly. If the value is not clearly present, return {"value": null}.`;

export async function extractIntakeAnswer(
  llm: LanguageModel,
  question: IntakeQuestion,
  answer: string,
): Promise<string | boolean | null> {
  const res = await llm.complete({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `EXTRACTION INSTRUCTION: ${question.extractionHint}\n\nThe person was asked: "${question.text}"\nTheir answer: """${answer}"""`,
      },
    ],
    responseFormat: "text",
    temperature: 0,
    maxOutputTokens: 200,
  });
  try {
    const parsed = JSON.parse(res.text.trim()) as { value?: unknown };
    const v = parsed.value;
    if (typeof v === "string") return v.trim() === "" ? null : v.trim();
    if (typeof v === "boolean") return v;
    return null;
  } catch {
    return null;
  }
}
