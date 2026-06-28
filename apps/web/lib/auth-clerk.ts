/**
 * Clerk-backed AuthProvider — the production identity adapter for the account-holder hub.
 *
 * Per DECISIONS.md, Clerk is the named auth vendor. Account stores only the provider's opaque
 * user id (`accounts.authProviderUserId`), nothing expressive — so the adapter's job is purely:
 *   Clerk session  →  Clerk userId  →  Account.authProviderUserId  →  Person.accountId  →  Person id.
 *
 * Defense in depth: same posture as the DevCookie stub — failures NEVER throw. Anything other
 * than "Clerk says userId X AND we have an Account row for X AND a Person points at it" resolves
 * to anonymous. A stale Clerk session, a missing Account, an orphaned Account with no Person, or
 * a transient DB error all degrade to `{ kind: "anonymous" }` rather than leak content.
 *
 * The hub NEVER constructs an `link_session` AuthContext (that path is the token surface in
 * @chronicle/capture). This adapter therefore only emits `anonymous` or `account`.
 *
 * Env vars (set in production only — when unset, runtime.ts falls back to the DevCookie path):
 *   CLERK_SECRET_KEY                  — server-side Clerk SDK key
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — client-side publishable key
 *
 * Clerk's `auth()` is injectable so the unit tests need no Clerk install and never hit network.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { accounts, persons } from "@chronicle/db/schema";
import type { AuthContext } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type { AuthProvider } from "./auth";

/**
 * The shape of Clerk's `auth()` helper we depend on. We type only `userId` so a Clerk SDK bump
 * adding fields is a non-event, and the test double is a one-liner.
 */
export type ClerkAuthFn = () => Promise<{ userId: string | null | undefined }>;

export interface ClerkAuthProviderOptions {
  /** Inject Clerk's `auth()` (tests pass a stub; prod omits and we lazy-import the real one). */
  readonly auth?: ClerkAuthFn;
}

export function createClerkAuthProvider(
  db: Database,
  options: ClerkAuthProviderOptions = {},
): AuthProvider {
  const resolveAuthFn: () => Promise<ClerkAuthFn> = options.auth
    ? async () => options.auth!
    : async () => {
        // Dynamic import in the *server component* path is fine (Node runtime, not Edge); it
        // also lets unit tests inject `options.auth` and skip resolving @clerk/nextjs entirely.
        const mod = await import("@clerk/nextjs/server");
        return mod.auth as unknown as ClerkAuthFn;
      };

  return {
    async getCurrentAuthContext(): Promise<AuthContext> {
      try {
        const authFn = await resolveAuthFn();
        const { userId } = await authFn();
        if (!userId) return { kind: "anonymous" };

        // Single inner join: a row only comes back if BOTH the Account exists for this Clerk
        // userId AND a Person points at that Account. An orphan (Account with no Person, or
        // Person with no Account) resolves to anonymous — we never fabricate identity.
        const [row] = await db
          .select({ personId: persons.id })
          .from(accounts)
          .innerJoin(persons, eq(persons.accountId, accounts.id))
          .where(eq(accounts.authProviderUserId, userId))
          .limit(1);

        if (!row) return { kind: "anonymous" };
        return { kind: "account", personId: row.personId };
      } catch (err) {
        // Defense in depth: Clerk import failure, DB outage, schema drift — all become anonymous.
        // We log because the caller swallows the error (Next's error pipeline does NOT surface
        // caught throws); without this log, a downed DB would manifest as silent forced-logout.
        console.error(
          "auth-clerk: failed to resolve Clerk session → falling back to anonymous",
          err,
        );
        return { kind: "anonymous" };
      }
    },
    async establishAccountSession(_personId: string): Promise<void> {
      // ADR-0003 magic-link account login. Clerk does NOT permit forging a server-side session
      // from a Person id: a passwordless login goes through a Clerk *sign-in token* (createSignInToken)
      // that the browser redeems. Wiring that (Clerk Backend SDK + a redeem redirect) is out of
      // Phase-1 scope — Clerk itself is unconfigured in dev/CI, where the mock adapter is used. This
      // throws loudly rather than silently no-op so a production magic-link wire-up is a deliberate,
      // visible follow-up, not a quietly-broken path.
      throw new Error(
        "establishAccountSession is not supported by the Clerk adapter in Phase 1 " +
          "(magic-link login requires Clerk sign-in tokens redeemed client-side; see ADR-0003).",
      );
    },
  };
}
