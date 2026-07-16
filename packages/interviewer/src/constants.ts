/**
 * Domain numeric constants for @chronicle/interviewer. Tune here, not at call sites.
 */

/**
 * Minimum completed turns before a high-sensitivity question may be asked — the "gentle
 * sequencing" guarantee (sensitive topics only after rapport). A future, more sophisticated
 * policy could use signals other than a count, but the count is auditable.
 */
export const RAPPORT_THRESHOLD_TURNS = 4;

/**
 * How long to wait through silence before nudging the narrator. Silence IS thinking — this is well
 * past what a generic voice assistant uses. The surface honors this; the policy names it.
 */
export const SILENCE_TOLERANCE_MS = 12_000;

/**
 * How many prior stories the picker considers when composing memory / de-duplication. Keeping
 * this small caps prompt size and surfaces only recent salience.
 */
export const MEMORY_LOOKBACK_COUNT = 8;

/** LLM temperature for phrasing interviewer intents (warm but controlled). */
export const INTERVIEWER_PHRASE_LLM_TEMPERATURE = 0.4;

/** Hard cap on output tokens for interviewer question phrasing (brief conversational speech). */
export const INTERVIEWER_PHRASE_MAX_OUTPUT_TOKENS = 250;

// ---------------------------------------------------------------------------
// Gap-driven follow-up (issue #80). The gap-detection pass is deliberately THIN — a single
// short LLM read that NAMES missing facts. These knobs bound its cost and its aggressiveness so
// a gap can never turn the controlled loop into an open chat.
// ---------------------------------------------------------------------------

/** Max gaps the detector may propose per answer — a hard cap on the JSON it can return. */
export const GAP_DETECTION_MAX_GAPS = 3;

/** LLM temperature for the gap-detection pass (low — this is extraction, not creativity). */
export const GAP_DETECTION_TEMPERATURE = 0.2;

/** Output-token cap for the gap-detection JSON (a handful of short seeds, nothing more). */
export const GAP_DETECTION_MAX_OUTPUT_TOKENS = 400;

/**
 * Minimum words in the narrator's answer before the gap detector even runs. Below this the answer
 * is too thin to have meaningful gaps, and following up would feel like interrogation. Mirrors the
 * `thinAnswerWordFloor` policy gate but applies at the DETECTION boundary so we never spend an LLM
 * call on a trivially short answer.
 */
export const GAP_DETECTION_MIN_ANSWER_WORDS = 12;

/**
 * The confidence a gap-derived follow-up candidate is assigned when it feeds `decideFollowUp`.
 * The gap detector reports no numeric confidence (a gap is present or it isn't), so we assign a
 * single value at/above the default `confidenceThreshold` (0.6) — high enough to clear the gate,
 * without claiming false precision. Tune here, one place.
 */
export const GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE = 0.7;
