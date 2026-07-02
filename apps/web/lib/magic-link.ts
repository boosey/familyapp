/**
 * Magic-link redirect helpers (ADR-0003, Slice 2 Task B) — PURE string logic.
 *
 * No `server-only`, no DB, no Clerk: the client redeem route (`/auth/redeem`) re-imports
 * `safeInternalDest` to re-sanitize the destination on the browser before navigating, so this
 * module must stay importable from client code. Keep it dependency-free.
 *
 * The seam result (`EstablishAccountSessionResult`) decides where the `/a/[token]` route sends the
 * browser: a mock/dev "established" session goes straight to the destination; a Clerk "handoff"
 * carries the minted sign-in token to the client redemption route.
 */
import type { EstablishAccountSessionResult } from "./auth";

/**
 * Open-redirect guard. Returns `dest` ONLY if it is a safe internal absolute path; else `fallback`.
 * Safe = starts with a single "/", NOT "//" (protocol-relative), NOT "/\" (backslash trick browsers
 * normalize into a host), contains no "://" scheme and no control chars / backslashes. Used to
 * sanitize the destination before it is handed to the browser AND again on the client redeem route.
 */
export function safeInternalDest(
  dest: string | null | undefined,
  fallback: string,
): string {
  if (!dest) return fallback;
  // Defense vs percent-encoded slash/scheme tricks (e.g. "/%2F%2Fevil.com" → "//evil.com" after the
  // App Router decodes it during route matching). Decode to a fixed point and re-validate the decoded
  // form, so the literal checks below see the same string the browser/router ultimately resolves.
  // Malformed encoding (decodeURIComponent throws) is itself rejected.
  let decoded: string;
  try {
    decoded = decodeURIComponent(dest);
  } catch {
    return fallback;
  }
  if (decoded !== dest) return safeInternalDest(decoded, fallback);
  // Must be an absolute internal path.
  if (!dest.startsWith("/")) return fallback;
  // Protocol-relative ("//host") and the backslash variant ("/\host") both resolve to an external
  // origin in a browser — reject them.
  if (dest.startsWith("//") || dest.startsWith("/\\")) return fallback;
  // Any backslash can be normalized to "/" by a browser, re-opening the "//"/scheme tricks; reject.
  if (dest.includes("\\")) return fallback;
  // A scheme like "javascript:" or "http:" must never survive (even behind a leading-slash trick).
  if (dest.includes(":")) return fallback;
  // Control chars (incl. tab/newline/CR) can be stripped by a browser, changing where the path
  // points; reject anything with a char below 0x20. Scanned by code point rather than a
  // control-char regex (which linters flag as an easy source of accidental range bugs).
  for (let i = 0; i < dest.length; i++) {
    if (dest.charCodeAt(i) < 0x20) return fallback;
  }
  return dest;
}

/** Build the client redemption URL: `/auth/redeem?ticket=..&dest=..&token=..` (URLSearchParams-encoded). */
export function buildRedeemUrl(input: {
  ticket: string;
  dest: string;
  token: string;
}): string {
  const params = new URLSearchParams({
    ticket: input.ticket,
    dest: input.dest,
    token: input.token,
  });
  return `/auth/redeem?${params.toString()}`;
}

/**
 * The route's redirect target given the seam result:
 *   established → ctx.destination (the cookie is already set; go straight there)
 *   handoff    → the client redeem URL carrying the minted ticket (the browser redeems it)
 */
export function resolveMagicLinkTarget(
  result: EstablishAccountSessionResult,
  ctx: { destination: string; token: string },
): string {
  if (result.kind === "established") return ctx.destination;
  return buildRedeemUrl({
    ticket: result.ticket,
    dest: ctx.destination,
    token: ctx.token,
  });
}
