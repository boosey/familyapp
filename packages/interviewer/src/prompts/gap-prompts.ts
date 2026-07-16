/**
 * Gap-detection & gap-follow-up prompt WORDING as DATA (issue #80).
 *
 * The repo's principle — "prompts are data, not code" — is honored here without heavy runtime-
 * registry infra: the OUTPUT CONTRACT stays in code (the JSON shape + gap-kind enum live in
 * `gap-detection.ts`), and the WORDING lives in this small typed, versioned record keyed by
 * `purpose × vendor × version`. A caller resolves a prompt by that triple at runtime, so the
 * wording can be swapped (a new version, a vendor-specific phrasing) WITHOUT touching the logic
 * that parses the model's output. This mirrors `docs/DECISIONS.md` § "prompts are data" and the
 * existing follow-up-evaluator SYSTEM_PROMPT split, just made lookup-addressable.
 *
 * DECISION: gap-detection is the ONLY NEW prompt this feature introduces. The gap follow-up is
 * PHRASED by the existing `phraser.ts` (its `follow_up` intent block), so there is no second new
 * prompt to version here — the gap flows through the already-versioned phraser. See the module
 * comment in `gap-detection.ts` for how the two compose.
 */

/** The vendors a prompt may be tuned for. `default` = vendor-neutral wording (the base). */
export type PromptVendor = "default" | "anthropic";

/** The purposes this data module covers. Extend as new prompt-backed features land. */
export type PromptPurpose = "gap_detection";

/** A resolved prompt: the system text plus the coordinates it was found at (for provenance). */
export interface ResolvedPrompt {
  purpose: PromptPurpose;
  vendor: PromptVendor;
  version: string;
  systemPrompt: string;
}

/**
 * The gap-detection system prompt, v1. Vendor-neutral (`default`). Concrete + conservative:
 * it PROPOSES missing/ambiguous facts as short seeds and does NOT ask anything or drive flow —
 * exactly like the follow-up evaluator, so the same downstream gates dispose of the output.
 */
const GAP_DETECTION_DEFAULT_V1 = `You help a warm family interviewer notice what a narrator's answer
LEFT UNSAID — the missing or ambiguous facts a gentle follow-up could fill in. You do NOT ask
anything and you do NOT decide the flow. You only NAME gaps; separate code chooses and gates them.

Read the narrator's answer and the question it responded to. Identify AT MOST 3 GAPS: concrete facts
that are (a) plausibly relevant to the story they are telling, (b) genuinely absent or ambiguous in
what they said (not already answered), and (c) worth gently asking about for a family memory.

Each gap has a kind:
- temporal: WHEN something happened, or how long / in what order (a date, an age, a season).
- relational: WHO else was there, or how people were connected.
- spatial: WHERE something happened (a place, a room, a town).
- causal: WHY or HOW something came about (a reason, a cause, what led to it).
- identity: WHAT or WHICH specific thing (a name, an object, a title left unspecified).

For each gap output:
- kind: one of temporal | relational | spatial | causal | identity.
- seed: a short (<=8 word) paraphrase of the MISSING fact (NOT a full question).
- sensitivity: low | medium | high (how tender asking about this would be).
- narratorOpened: true ONLY if the narrator's own words already gestured at this thread.

Never invent content the narrator did not gesture toward. Do not propose a gap the narrator
already answered. If nothing is meaningfully missing, return an empty list.
Output STRICT JSON: {"gaps":[{"kind":"...","seed":"...","sensitivity":"...","narratorOpened":false}]}`;

/**
 * The prompt store: `purpose → vendor → version → systemPrompt`. A plain typed const record —
 * auditable in one place, swappable by adding a version key, no build/deploy coupling. `default`
 * is always present per purpose; vendor-specific keys override only where they exist.
 */
const PROMPT_STORE: Record<PromptPurpose, Partial<Record<PromptVendor, Record<string, string>>>> = {
  gap_detection: {
    default: {
      v1: GAP_DETECTION_DEFAULT_V1,
    },
  },
};

/** The version resolved when a caller does not pin one — bump as new wording lands. */
export const CURRENT_GAP_DETECTION_VERSION = "v1";

/**
 * Resolve a prompt by purpose × vendor × version. Falls back vendor→`default` when the requested
 * vendor has no override, and throws if the (purpose, version) pair is genuinely absent — a missing
 * prompt is a programming error, not a silent empty string that would send a blank system message.
 */
export function resolveGapPrompt(opts?: {
  vendor?: PromptVendor;
  version?: string;
}): ResolvedPrompt {
  const purpose: PromptPurpose = "gap_detection";
  const version = opts?.version ?? CURRENT_GAP_DETECTION_VERSION;
  const requestedVendor: PromptVendor = opts?.vendor ?? "default";

  const byVendor = PROMPT_STORE[purpose];
  // Prefer the requested vendor's wording; fall back to the neutral `default` set.
  const vendorTable = byVendor[requestedVendor] ?? byVendor.default;
  const resolvedVendor: PromptVendor = byVendor[requestedVendor] ? requestedVendor : "default";
  const systemPrompt = vendorTable?.[version];
  if (!systemPrompt) {
    throw new Error(
      `No prompt registered for purpose=${purpose} vendor=${resolvedVendor} version=${version}`,
    );
  }
  return { purpose, vendor: resolvedVendor, version, systemPrompt };
}
