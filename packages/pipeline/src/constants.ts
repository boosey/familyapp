/**
 * Domain numeric constants for @chronicle/pipeline. Tune here, not at call sites.
 */

/** LLM temperature for story rendering (low = faithful to transcript). */
export const STORY_RENDER_LLM_TEMPERATURE = 0.2;

/** Hard cap on output tokens for story rendering. */
export const STORY_RENDER_MAX_OUTPUT_TOKENS = 4000;

/** Char caps for parsed LLM story fields. */
export const STORY_TITLE_MAX_CHARS = 200;
export const STORY_SUMMARY_MAX_CHARS = 400;

/** Max number of tags per story. */
export const STORY_TAGS_MAX_COUNT = 8;

/** Char caps for fallback story fields when JSON parse fails. */
export const STORY_TITLE_FALLBACK_MAX_CHARS = 80;
export const STORY_SUMMARY_FALLBACK_MAX_CHARS = 200;

/** Max retry attempts per job id in the in-process queue (spin-loop guard). */
export const PIPELINE_JOB_MAX_ATTEMPTS = 8;

/** Bounds on audio time-stretch speed factor. */
export const AUDIO_SPEED_FACTOR_MIN = 1.0;
export const AUDIO_SPEED_FACTOR_MAX = 2.0;

/** LLM temperature for post-approval biographical extraction (0 = deterministic fact-pull). */
export const BIOGRAPHY_EXTRACT_LLM_TEMPERATURE = 0;

/** Hard cap on output tokens for biographical extraction (the JSON record is tiny). */
export const BIOGRAPHY_EXTRACT_MAX_OUTPUT_TOKENS = 300;

/** LLM temperature for narrator-memory extraction (0 = deterministic fact-pull). */
export const NARRATOR_MEMORY_EXTRACT_LLM_TEMPERATURE = 0;

/** Hard cap on output tokens for narrator-memory extraction (a short JSON array of facts). */
export const NARRATOR_MEMORY_EXTRACT_MAX_OUTPUT_TOKENS = 600;

/**
 * LLM temperature for the OPT-IN prose polish (slightly above story-render's 0.2 so it can smooth
 * rambling and resolve self-corrections, but still low enough that it never drifts into invention).
 */
export const PROSE_POLISH_LLM_TEMPERATURE = 0.3;

/** Hard cap on output tokens for a prose polish — a polish never lengthens; it tidies. */
export const PROSE_POLISH_MAX_OUTPUT_TOKENS = 4000;

/** LLM temperature for parsing a spoken date (0 = deterministic — a date is a fact, not a choice). */
export const SPOKEN_DATE_PARSE_LLM_TEMPERATURE = 0;

/** Hard cap on output tokens for the spoken-date parse (the JSON record is three integers). */
export const SPOKEN_DATE_PARSE_MAX_OUTPUT_TOKENS = 120;
