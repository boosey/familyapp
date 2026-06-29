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
