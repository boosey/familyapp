/**
 * AuthProvider seam — the production identity surface for the younger-generation hub.
 *
 * Per the spec (Part IV) auth is a BOUGHT commodity behind an interface, and the named
 * production adapter is Clerk (DECISIONS.md). This file defines the interface and a DEV cookie
 * stub that the local hub uses to "sign in" without standing up Clerk. The real Clerk adapter is
 * out of scope for Phase 0/1 (requires a paid signup — see OPEN-QUESTIONS) and slots in here
 * without touching any consumer of `getCurrentAuthContext`.
 *
 * Identity contract: an AuthProvider resolves the inbound request to ONE of:
 *   - anonymous (no cookie / no provider session) — read-only public surface
 *   - account { personId } — a younger-generation Account mapped to its Person id
 *
 * The hub NEVER constructs an `elder_session` AuthContext — that path is the token-on-the-URL
 * surface at /s/[token], handled exclusively by @chronicle/capture.
 */
import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import type { AuthContext } from "@chronicle/core";
import type { Database } from "@chronicle/db";

const DEV_COOKIE = "chronicle_dev_person_id";

export interface AuthProvider {
  /** Resolve the inbound request to an AuthContext. Never throws — anonymous on failure. */
  getCurrentAuthContext(): Promise<AuthContext>;
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
  };
}

export const DEV_AUTH_COOKIE_NAME = DEV_COOKIE;
