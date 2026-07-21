/**
 * Gap-detection (issue #80, C2a) — the THIN extraction pass that makes the interviewer's
 * follow-ups gap-driven.
 *
 * After the narrator answers, we run one short LLM read that NAMES the missing or ambiguous facts
 * in what they said (a "when", a "who", a "where", a "why", a "which"). It PROPOSES gaps and decides
 * nothing about the loop — exactly like `follow-up-evaluator.ts`. That symmetry is deliberate: each
 * detected gap is mapped to the EXISTING `FollowUpCandidate` shape, so the ALREADY-BUILT gate stack
 * in `decideFollowUp` (thin-answer, distress/off-ramp short-circuit, rapport gate, anti-repeat,
 * confidence floor, caps) disposes of gap follow-ups with no parallel policy path. The gap flow
 * therefore rides the controlled loop's one-question-at-a-time and safety guarantees for free.
 *
 * Scope discipline (out-of-scope per #80): this is NOT timeline/fact enrichment. We name at most a
 * few gaps as short seeds and stop. We do not persist facts, build a timeline, or resolve entities.
 * The OUTPUT CONTRACT (the JSON shape + gap-kind enum) lives here in code; the WORDING lives in the
 * versioned `prompts/gap-prompts.ts` data module and is resolved by purpose × vendor × version.
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type { FollowUpCandidate, FollowUpSensitivity } from "@chronicle/db";
import {
  GAP_DETECTION_MAX_GAPS,
  GAP_DETECTION_MAX_OUTPUT_TOKENS,
  GAP_DETECTION_TEMPERATURE,
  GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE,
} from "./constants";
import { GAP_KIND_TO_FOLLOW_UP_TYPE } from "./follow-up-mapping";
import { resolveGapPrompt, type PromptVendor } from "./prompts/gap-prompts";

/** The kind of missing/ambiguous fact a gap names. Maps onto the persisted `FollowUpType`. */
export type GapKind = "temporal" | "relational" | "spatial" | "causal" | "identity";

/** One missing/ambiguous fact the detector found in the narrator's answer. */
export interface Gap {
  kind: GapKind;
  /** Short (<=8 word) paraphrase of the MISSING fact — not a full question. */
  seed: string;
  /** How tender asking about this gap would be — passes through to the existing sensitivity gate. */
  sensitivity: FollowUpSensitivity;
  /** True iff the narrator's own words already gestured at this thread (emotional-door input). */
  narratorOpened: boolean;
}

export interface GapDetectionInput {
  /** The question the narrator was answering (context for what counts as "missing"). */
  questionText: string;
  /** The narrator's answer transcript — the primary input. */
  answerTranscript: string;
}

export interface GapDetectionResult {
  gaps: Gap[];
  /** Vendor model id (provenance for the decision record). */
  modelId: string;
  /** Which prompt-data version was used (provenance; prompts-as-data audit trail). */
  promptVersion: string;
  /** Which vendor wording actually resolved (may fall back to `default`). */
  promptVendor: PromptVendor;
}

const KINDS: ReadonlySet<string> = new Set([
  "temporal",
  "relational",
  "spatial",
  "causal",
  "identity",
]);
const SENS: ReadonlySet<string> = new Set(["low", "medium", "high"]);

/**
 * Run the thin gap-detection pass. Never throws for a bad model reply — a malformed response yields
 * an empty gap set (the loop simply falls through to its next intent). The caller decides whether to
 * even run this (it gates on answer length + the policy short-circuits first).
 */
export async function extractGaps(
  llm: LanguageModel,
  input: GapDetectionInput,
  promptOpts?: { vendor?: PromptVendor; version?: string },
): Promise<GapDetectionResult> {
  const prompt = resolveGapPrompt(promptOpts);
  const user = [
    `QUESTION THEY ANSWERED:\n${input.questionText}`,
    `THEIR ANSWER (transcript):\n${input.answerTranscript}`,
  ].join("\n\n");

  const res = await llm.complete({
    messages: [
      { role: "system", content: prompt.systemPrompt },
      { role: "user", content: user },
    ],
    responseFormat: "json",
    temperature: GAP_DETECTION_TEMPERATURE,
    maxOutputTokens: GAP_DETECTION_MAX_OUTPUT_TOKENS,
  });

  return {
    gaps: parseGaps(res.text),
    modelId: res.modelId,
    promptVersion: prompt.version,
    promptVendor: prompt.vendor,
  };
}

/** Defensive parse: tolerate fenced/raw JSON, drop malformed gaps, cap the count. */
export function parseGaps(text: string): Gap[] {
  const jsonStr = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  const raw = (parsed as { gaps?: unknown })?.gaps;
  if (!Array.isArray(raw)) return [];
  const out: Gap[] = [];
  for (const g of raw) {
    if (out.length >= GAP_DETECTION_MAX_GAPS) break;
    if (typeof g !== "object" || g === null) continue;
    const o = g as Record<string, unknown>;
    if (typeof o.kind !== "string" || !KINDS.has(o.kind)) continue;
    if (typeof o.seed !== "string" || !o.seed.trim()) continue;
    if (typeof o.sensitivity !== "string" || !SENS.has(o.sensitivity)) continue;
    out.push({
      kind: o.kind as GapKind,
      seed: o.seed.trim(),
      sensitivity: o.sensitivity as FollowUpSensitivity,
      narratorOpened: o.narratorOpened === true,
    });
  }
  return out;
}

/**
 * Bridge detected gaps into the EXISTING `FollowUpCandidate` shape so `decideFollowUp` gates them.
 * Type mapping lives in `follow-up-mapping.ts` (single source for both directions).
 * This is the "compose, don't duplicate" seam: every gate the answer-surface follow-up already
 * enforces applies to gap follow-ups verbatim. Confidence is a single tuned constant (a gap has no
 * numeric self-assessment); sensitivity + narratorOpened pass through so the gates see real inputs.
 */
export function gapsToFollowUpCandidates(gaps: ReadonlyArray<Gap>): FollowUpCandidate[] {
  return gaps.map((g) => ({
    threadSeed: g.seed,
    type: GAP_KIND_TO_FOLLOW_UP_TYPE[g.kind],
    sensitivity: g.sensitivity,
    confidence: GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE,
    narratorOpened: g.narratorOpened,
  }));
}
