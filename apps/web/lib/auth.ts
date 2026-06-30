/**
 * AuthProvider seam — the production identity surface for the account-holder hub.
 *
 * Per the spec (Part IV) auth is a BOUGHT commodity behind an interface, and the named
 * production adapter is Clerk (DECISIONS.md). This file defines the interface and a DEV cookie
 * stub that the local hub uses to "sign in" without standing up Clerk. The real Clerk adapter is
 * out of scope for Phase 0/1 (requires a paid signup — see OPEN-QUESTIONS) and slots in here
 * without touching any consumer of `getCurrentAuthContext`.
 *
 * Identity contract: an AuthProvider resolves the inbound request to ONE of:
 *   - anonymous (no cookie / no provider session) — read-only public surface
 *   - account { personId } — an Account mapped to its Person id
 *
 * The hub NEVER constructs a `link_session` AuthContext — that path is the token-on-the-URL
 * surface at /s/[token], handled exclusively by @chronicle/capture.
 */
import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import type { AuthContext } from "@chronicle/core";
import type { Database } from "@chronicle/db";

const DEV_COOKIE = "chronicle_dev_person_id";

/**
 * Result of establishing a magic-link account session (ADR-0003).
 *  - "established": the provider set a server-side session cookie. Caller redirects to the destination.
 *  - "handoff": the provider minted a one-time, browser-redeemable credential (a Clerk sign-in token
 *    a.k.a. "ticket"). Clerk forbids forging a session server-side from a userId, so the BROWSER must
 *    redeem it; the caller hands off to the client redemption route carrying this ticket.
 */
export type EstablishAccountSessionResult =
  | { kind: "established" }
  | { kind: "handoff"; ticket: string };

export interface AuthProvider {
  /** Resolve the inbound request to an AuthContext. Never throws — anonymous on failure. */
  getCurrentAuthContext(): Promise<AuthContext>;
  /**
   * Establish (sign in) an account session for the given Person — the magic-link path (ADR-0003):
   * a texted deep link whose token resolves to a Person who HAS an Account becomes a passwordless
   * login to that account. The dev/mock adapters set the session cookie and signal "established";
   * the Clerk adapter mints a one-time Clerk sign-in token (Clerk forbids forging a session
   * server-side from a userId) and signals "handoff" so the BROWSER redeems it (see auth-clerk.ts).
   *
   * Throws if the Person has no Account to sign in as (the caller — the `/a/[token]` route — must
   * only call this for a Person with an Account; a Person without one stays on the login-free
   * `/s/[token]` link-session surface).
   */
  establishAccountSession(
    personId: string,
  ): Promise<EstablishAccountSessionResult>;
}

/**
 * Dev/local AuthProvider — reads a Person id from a cookie. The cookie is set by /dev/sign-in.
 * Production swaps in a ClerkAuthProvider that reads Clerk's session and joins to Account →
 * Person (Account.id is the Clerk user id). No consumer of this interface changes.
 */
export function createDevCookieAuthProvider(db: Database): AuthProvider {
  return {
    async getCurrentAuthContext(): Promise<AuthContext> {
      const jar = await cookies();
      const raw = jar.get(DEV_COOKIE)?.value;
      if (!raw) return { kind: "anonymous" };
      // Defense in depth: confirm the cookie actually maps to a Person row before trusting it
      // as identity. A stale or hand-forged cookie resolves to anonymous, not to "some Person".
      const [p] = await db
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.id, raw))
        .limit(1);
      if (!p) return { kind: "anonymous" };
      return { kind: "account", personId: p.id };
    },
    async establishAccountSession(
      personId: string,
    ): Promise<EstablishAccountSessionResult> {
      // The dev-cookie provider's session value IS the Person id. Confirm the Person exists before
      // writing a session for them (never sign in a phantom).
      const [p] = await db
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.id, personId))
        .limit(1);
      if (!p) {
        throw new Error(
          `establishAccountSession: no Person ${personId} to sign in as`,
        );
      }
      const jar = await cookies();
      jar.set(DEV_COOKIE, p.id, { httpOnly: true, sameSite: "lax", path: "/" });
      // Cookie is set on this response — the caller may redirect straight to the destination.
      return { kind: "established" };
    },
  };
}

export const DEV_AUTH_COOKIE_NAME = DEV_COOKIE;
