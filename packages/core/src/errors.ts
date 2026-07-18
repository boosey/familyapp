/** Domain errors for the spine. */

/** Raised when a read/operation is denied by the authorization function. */
export class AuthorizationError extends Error {
  readonly code = "AUTHORIZATION_DENIED";
  constructor(reason: string) {
    super(reason);
    this.name = "AuthorizationError";
  }
}

/** Raised when a state transition or write would violate a domain invariant. */
export class InvariantViolation extends Error {
  readonly code = "INVARIANT_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "InvariantViolation";
  }
}

/**
 * Raised when an abuse/cost guard refuses an otherwise-valid operation (issue #105) — e.g. an
 * inviter blowing past the generous invite-send ceiling. Distinct from InvariantViolation so the
 * web layer can map it to a friendly "slow down" message rather than a generic failure.
 */
export class ThrottleError extends Error {
  readonly code = "THROTTLED";
  constructor(message: string) {
    super(message);
    this.name = "ThrottleError";
  }
}
