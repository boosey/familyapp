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
