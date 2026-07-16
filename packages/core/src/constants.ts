/**
 * Domain numeric constants for @chronicle/core. Tune here, not at call sites.
 */

/** Default page size for pending asks returned to the interviewer. */
export const PENDING_ASKS_DEFAULT_LIMIT = 20;

/** Family-search scoring weights (name highest → member lowest). */
export const FAMILY_SEARCH_WEIGHT_NAME = 4;
export const FAMILY_SEARCH_WEIGHT_STEWARD = 3;
export const FAMILY_SEARCH_WEIGHT_DESCRIPTION = 2;
export const FAMILY_SEARCH_WEIGHT_MEMBER = 1;

/** Default number of family-search results returned. */
export const FAMILY_SEARCH_DEFAULT_LIMIT = 10;

/**
 * Default cap on the discoverable-family browse list. The find surface filters this list
 * client-side, so the cap bounds what crosses to the browser (name + steward only).
 */
export const DISCOVERABLE_FAMILIES_DEFAULT_LIMIT = 100;

/** Default cap on recently-decided join requests shown to a steward. */
export const DECIDED_JOIN_REQUESTS_DEFAULT_LIMIT = 20;

/** Default TTL (ms) for member invitation tokens (14 days). */
export const MEMBER_INVITATION_DEFAULT_TTL_MS = 14 * 86_400_000;

/** Entropy (bytes) for member invitation token generation (256 bits). */
export const MEMBER_INVITATION_TOKEN_ENTROPY_BYTES = 32;

/**
 * Max stored length of a terminal-pipeline-failure reason (issue #11). Keeps a runaway vendor
 * error/stack from bloating the `stories.processing_error` column; it is an ops breadcrumb, not
 * a full log.
 */
export const PROCESSING_ERROR_MAX_CHARS = 500;
