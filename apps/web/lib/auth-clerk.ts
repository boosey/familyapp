/**
 * Clerk-backed AuthProvider — the production identity adapter for the account-holder hub.
 *
 * Per DECISIONS.md, Clerk is the named auth vendor. A Clerk login is one of the account's
 * `account_identities` rows (provider='clerk'); the durable identity is the Account itself. The
 * adapter's job is purely:
 *   Clerk session  →  Clerk userId  →  account_identities  →  Account  →  Person.accountId  →  Person id.
 * Resolving through the identities table (not `accounts.authProviderUserId`) lets ANY of the account's
 * clerk identities authenticate it — including one attached AFTER account creation during a heal.
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
import { and, desc, eq } from "drizzle-orm";
import { accounts, persons, accountIdentities } from "@chronicle/db/schema";
import type { AuthContext } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type { AuthProvider, EstablishAccountSessionResult } from "./auth";
import { mintSignInToken, type MintSignInToken } from "./clerk-server";

/**
 * The shape of Clerk's `auth()` helper we depend on. We type only `userId` so a Clerk SDK bump
 * adding fields is a non-event, and the test double is a one-liner.
 */
export type ClerkAuthFn = () => Promise<{ userId: string | null | undefined }>;

export interface ClerkAuthProviderOptions {
  /** Inject Clerk's `auth()` (tests pass a stub; prod omits and we lazy-import the real one). */
  readonly auth?: ClerkAuthFn;
  /** Inject Clerk's sign-in token mint (tests stub; prod resolves the real Backend client). */
  readonly mint?: MintSignInToken;
}

/**
 * Resolve a Person to their Account's NEWEST Clerk identity (`account_identities.providerUserId`),
 * or null. A healed account (Model B) may hold MORE THAN ONE clerk identity — a dead dev-instance id
 * plus the live prod-instance id attached during the heal — so we mint the sign-in ticket for the
 * newest-attached one, which is the current-instance (live) id.
 *
 * Inner join: a value comes back ONLY if the Person has an ACTIVE Account with at least one clerk
 * identity. The `active` filter mirrors `resolvePersonRow`: a soft-deleted account (Clerk
 * `user.deleted`, issue #10) must not be able to establish a magic-link session either — it resolves
 * to null, and the caller `establishAccountSession` then declines to mint a sign-in ticket.
 *
 * Limitation: the newest-identity heuristic assumes the most recently attached clerk id is the live
 * one. Pruning dead identities on heal (so there is only ever one clerk id) is deferred; until then a
 * pathological re-attach ordering could mint against a stale id. Acceptable for the dev+prod overlap
 * this exists to survive.
 * Exported for unit testing.
 */
export async function resolveAuthProviderUserId(
  db: Database,
  personId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ providerUserId: accountIdentities.providerUserId })
    .from(persons)
    .innerJoin(accounts, eq(accounts.id, persons.accountId))
    .innerJoin(
      accountIdentities,
      and(
        eq(accountIdentities.accountId, accounts.id),
        eq(accountIdentities.provider, "clerk"),
      ),
    )
    .where(and(eq(persons.id, personId), eq(accounts.active, true)))
    .orderBy(desc(accountIdentities.createdAt))
    .limit(1);
  return row?.providerUserId ?? null;
}

/**
 * Neon (prod Postgres) scales to zero; the first query after an idle period can be slow OR drop the
 * connection while the compute wakes. This account→Person lookup is an idempotent READ, so we retry
 * a few times on ANY failure before giving up. Rationale: without a retry a transient cold-start blip
 * hits the caller's catch and degrades a genuinely SIGNED-IN user to `anonymous` — the spurious
 * "Not signed in" this exists to prevent. A truly-down DB simply exhausts the retries and the caller
 * still falls back to anonymous (defense in depth preserved), at the cost of ~300ms added latency
 * only while the DB is failing. We retry on any error rather than pattern-matching driver messages:
 * the call is a read, so a retry is never unsafe, and message-sniffing is brittle across driver bumps.
 */
const AUTH_LOOKUP_MAX_ATTEMPTS = 3;
const AUTH_LOOKUP_RETRY_BASE_MS = 100;

async function resolvePersonRow(
  db: Database,
  userId: string,
): Promise<{ personId: string } | null> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= AUTH_LOOKUP_MAX_ATTEMPTS; attempt++) {
    try {
      // Join anchored on account_identities: a row comes back only if SOME clerk identity holds this
      // userId AND its Account is active AND a Person points at that Account. Resolving through the
      // identities table (not `accounts.authProviderUserId`) means a login is authenticated by ANY of
      // the account's clerk identities — including one attached AFTER account creation during a Model B
      // heal (a prod-instance id grafted onto an account first created under a dead dev id). An orphan
      // (no Person) resolves to null → anonymous upstream.
      //
      // `accounts.active` is the load-bearing filter for the Clerk `user.deleted` webhook (issue #10):
      // that webhook SOFT-deletes by flipping `active = false` (it never erases the Person/content).
      // A Clerk session can outlive the deletion event (deletion and JWT invalidation are not
      // synchronous), so THIS is the chokepoint that actually severs the login — a deactivated account
      // resolves to null → anonymous, exactly like a missing account.
      const [row] = await db
        .select({ personId: persons.id })
        .from(accountIdentities)
        .innerJoin(accounts, eq(accounts.id, accountIdentities.accountId))
        .innerJoin(persons, eq(persons.accountId, accounts.id))
        .where(
          and(
            eq(accountIdentities.provider, "clerk"),
            eq(accountIdentities.providerUserId, userId),
            eq(accounts.active, true),
          ),
        )
        .limit(1);
      return row ?? null;
    } catch (err) {
      lastErr = err;
      if (attempt < AUTH_LOOKUP_MAX_ATTEMPTS) {
        console.warn(
          `[auth-clerk] account lookup attempt ${attempt}/${AUTH_LOOKUP_MAX_ATTEMPTS} failed; retrying: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await new Promise((r) => setTimeout(r, AUTH_LOOKUP_RETRY_BASE_MS * attempt));
      }
    }
  }
  // Retries exhausted — propagate so the caller degrades to anonymous (a real, sustained DB outage).
  throw lastErr;
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
      // [DIAG] Temporary auth-resolution tracing (album upload "Not signed in" investigation).
      // The two anonymous branches below used to return silently, leaving no trace in the logs.
      // Remove once the upload auth path is understood. Logs only a userId prefix + timings.
      const t0 = Date.now();
      try {
        const authFn = await resolveAuthFn();
        const { userId } = await authFn();
        const tAuth = Date.now();
        if (!userId) {
          console.warn(
            `[DIAG auth-clerk] anonymous: Clerk returned no userId clerkMs=${tAuth - t0}`,
          );
          return { kind: "anonymous" };
        }

        // Account→Person lookup, retrying transient DB failures (Neon cold-start blips) so a
        // signed-in user is never spuriously logged out. See resolvePersonRow.
        const row = await resolvePersonRow(db, userId);

        if (!row) {
          console.warn(
            `[DIAG auth-clerk] anonymous: no account/person row userId=${userId.slice(0, 8)} clerkMs=${tAuth - t0} dbMs=${Date.now() - tAuth}`,
          );
          return { kind: "anonymous" };
        }
        console.info(
          `[DIAG auth-clerk] account userId=${userId.slice(0, 8)} personId=${row.personId} clerkMs=${tAuth - t0} dbMs=${Date.now() - tAuth}`,
        );
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
    async establishAccountSession(
      personId: string,
    ): Promise<EstablishAccountSessionResult> {
      // ADR-0003 magic-link account login. Clerk does NOT permit forging a server-side session from
      // a Person id, so we mint a one-time Clerk *sign-in token* (ticket) here and hand off to the
      // client redemption route, which redeems it via the `ticket` strategy to establish the session.
      const userId = await resolveAuthProviderUserId(db, personId);
      if (!userId) {
        // Defensive: the `/a/[token]` route guards accountId before calling, so this only fires on a
        // genuine inconsistency (a Person lost its Account between the guard and here).
        throw new Error(
          "establishAccountSession: Person " +
            personId +
            " has no Clerk Account to sign in as",
        );
      }
      const ticket = await mintSignInToken(userId, { mint: options.mint });
      return { kind: "handoff", ticket };
    },
  };
}
