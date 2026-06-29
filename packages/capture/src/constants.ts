/**
 * Domain numeric constants for @chronicle/capture. Tune here, not at call sites.
 */

/** Default TTL (days) for login-free link session tokens. */
export const LINK_SESSION_DEFAULT_TTL_DAYS = 30;

/** Milliseconds in one day — time-unit conversion. */
export const MILLISECONDS_PER_DAY = 86_400_000;

/** Entropy (bytes) for link-session token generation (256 bits). */
export const LINK_SESSION_TOKEN_ENTROPY_BYTES = 32;
