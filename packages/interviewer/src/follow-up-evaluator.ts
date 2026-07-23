/**
 * LLM-backed FollowUpEvaluator. Rides the existing LanguageModel seam (the same one phraser.ts
 * uses) — so it is NOT a vendor adapter and the architecture test permits it here. The model only
 * PROPOSES tagged candidates; decideFollowUp (behavior.ts) disposes. The system prompt is versioned
 * human text (prompts-as-data): the OUTPUT CONTRACT is fixed in code (the JSON shape + our enums);
 * the WORDING is meant to be swappable without a redeploy in a later prompt store.
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type { FollowUpCandidate, FollowUpType, FollowUpSensitivity } from "@chronicle/db";
import type { FollowUpEvaluator, FollowUpEvaluationInput, FollowUpEvaluation } from "./contracts";

const SYSTEM_PROMPT = `You help a warm family interviewer decide whether a narrator's answer contains
a thread worth gently deepening with ONE short follow-up question. You do NOT ask anything and you
do NOT decide the flow — you only propose candidate threads; separate code chooses and gates them.

Read the narrator's answer and the question it responded to. Propose AT MOST 3 candidate threads that
are (a) genuinely present in what they said, (b) NOVEL (not already covered — you are told what is),
and (c) worth deepening for a family memory. For each candidate output:
- threadSeed: a short (<=8 word) paraphrase of the thread (NOT a full question).
- type: one of factual | sensory | temporal | relational | emotional.
- sensitivity: low | medium | high (how tender the topic is).
- confidence: 0..1, how sure you are it is worth asking.
- narratorOpened: true ONLY if the narrator's OWN words already surfaced this feeling/topic. For any
  emotional thread, set this truthfully — a closed emotional door will be vetoed downstream.

Never invent content the narrator did not say. Never propose a brand-new interview topic, scene, or
question bank item — only deepen a thread already opened in THEIR ANSWER. If nothing in the answer
warrants deepening, return an empty list.
Output STRICT JSON: {"candidates":[{"threadSeed":"...","type":"...","sensitivity":"...","confidence":0.0,"narratorOpened":false}]}`;

const TYPES: ReadonlySet<string> = new Set(["factual", "sensory", "temporal", "relational", "emotional"]);
const SENS: ReadonlySet<string> = new Set(["low", "medium", "high"]);

export function createLlmFollowUpEvaluator(llm: LanguageModel): FollowUpEvaluator {
  return {
    async evaluate(input: FollowUpEvaluationInput): Promise<FollowUpEvaluation> {
      const user = [
        `QUESTION THEY ANSWERED:\n${input.promptText}`,
        `THEIR ANSWER (transcript):\n${input.answerTranscript}`,
        input.alreadyAskedSeeds.length
          ? `ALREADY ASKED THIS SITTING (do not repeat):\n- ${input.alreadyAskedSeeds.join("\n- ")}`
          : "",
        input.coveredCategories.length
          ? `ALREADY COVERED CATEGORIES:\n${input.coveredCategories.join(", ")}`
          : "",
      ].filter(Boolean).join("\n\n");

      const res = await llm.complete({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        responseFormat: "json",
        temperature: 0.3,
        maxOutputTokens: 500,
      });
      return { candidates: parseCandidates(res.text), modelId: res.modelId };
    },
  };
}

/** Defensive parse: tolerate fenced/raw JSON, drop malformed candidates, clamp confidence. */
export function parseCandidates(text: string): FollowUpCandidate[] {
  const jsonStr = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  const raw = (parsed as { candidates?: unknown })?.candidates;
  if (!Array.isArray(raw)) return [];
  const out: FollowUpCandidate[] = [];
  for (const c of raw) {
    if (typeof c !== "object" || c === null) continue;
    const o = c as Record<string, unknown>;
    if (typeof o.threadSeed !== "string" || !o.threadSeed.trim()) continue;
    if (typeof o.type !== "string" || !TYPES.has(o.type)) continue;
    if (typeof o.sensitivity !== "string" || !SENS.has(o.sensitivity)) continue;
    const confidence = typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0;
    out.push({
      threadSeed: o.threadSeed.trim(),
      type: o.type as FollowUpType,
      sensitivity: o.sensitivity as FollowUpSensitivity,
      confidence,
      narratorOpened: o.narratorOpened === true,
    });
  }
  return out;
}
