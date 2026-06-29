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
