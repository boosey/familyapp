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

/** Default TTL (ms) for member invitation tokens (14 days). */
export const MEMBER_INVITATION_DEFAULT_TTL_MS = 14 * 86_400_000;

/** Entropy (bytes) for member invitation token generation (256 bits). */
export const MEMBER_INVITATION_TOKEN_ENTROPY_BYTES = 32;
