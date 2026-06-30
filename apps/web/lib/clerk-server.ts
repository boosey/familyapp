/**
 * Clerk Backend-API bridge — the server-side glue between a Clerk user and our domain Account/Person.
 *
 * Two jobs, both ONLY relevant when Clerk is configured:
 *
 *   1. JIT provisioning (ADR-0005): on the first authenticated landing at `/auth/callback`, turn a
 *      Clerk `userId` into a domain Account + Person if one doesn't exist yet. Idempotent and
 *      race-safe — two concurrent landings cannot fork an identity (the in-transaction uniqueness
 *      guard in `createAccountWithPerson` makes the loser re-resolve the winner's row).
 *
 *   2. Email → Clerk userId lookup, used by the Clerk-mode dev seed to BIND seeded personas to
 *      pre-created Clerk test users (DECISIONS.md: "Clerk-mode seed binds personas by email").
 *
 * The Clerk Backend SDK is reached through `@clerk/nextjs/server`'s async `clerkClient()` (v6:
 * `const client = await clerkClient(); client.users.getUser(id)`). Every external touch is behind an
 * injectable seam (`GetClerkUser` / `GetClerkUserIdByEmail`) so unit tests provision/bind with a stub
 * and never import Clerk or hit the network — the same discipline as `auth-clerk.ts`.
 *
 * NOTE: name comes FROM Clerk for net-new sign-ups (ADR-0005). The dashboard "Name" field is
 * required, so `firstName`/`lastName` are normally present; we stay defensive and fall back to the
 * email local-part, then a generic label, because `createAccountWithPerson` rejects an empty name.
 */
import "server-only";
import {
  createAccountWithPerson,
  findPersonIdByAuthProviderUserId,
} from "@chronicle/core";
import type { Database } from "@chronicle/db";

/** The slice of a Clerk `User` we depend on. Narrow on purpose — a Clerk SDK bump is a non-event. */
export interface ClerkUserLite {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** Clerk's convenience getter — the primary email, or null. */
  primaryEmailAddress?: { emailAddress: string } | null;
}

/** Inject Clerk's `users.getUser` (tests stub; prod resolves the real Backend client). */
export type GetClerkUser = (userId: string) => Promise<ClerkUserLite>;

/**
 * Inject "first Clerk userId whose account carries this email, or null" (tests stub; prod queries
 * `users.getUserList({ emailAddress })`). Email match is how the Clerk-mode seed binds personas.
 */
export type GetClerkUserIdByEmail = (email: string) => Promise<string | null>;

/**
 * Inject Clerk's `signInTokens.createSignInToken` (tests stub; prod resolves the real Backend
 * client). Returns the SignInToken's `.token` — the opaque ticket the browser redeems via the
 * Clerk `ticket` sign-in strategy.
 */
export type MintSignInToken = (userId: string) => Promise<string>;

async function defaultMintSignInToken(userId: string): Promise<string> {
  // Same dynamic-import discipline as defaultGetClerkUser: keep @clerk/nextjs out of any path that
  // doesn't actually call Clerk, and let tests inject a stub without resolving the module.
  //
  // This reaches the Clerk Backend API via the secret key, NOT a request-scoped Clerk session — so
  // it works fine even though the `/a/[token]` magic-link route is middleware-excluded (the
  // middleware only establishes the *frontend* `auth()` session; backend minting needs no middleware).
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  // 600s = a momentary redirect-hop credential: it only has to survive the bounce to the client
  // redemption route. OUR OWN link token is the reusable / time-boxed one per ADR-0003.
  const token = await client.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 600,
  });
  return token.token;
}

/**
 * Mint a one-time Clerk sign-in token (ticket) for a Clerk userId. The browser redeems it via the
 * `ticket` strategy to establish a real Clerk session — the server cannot forge one from a userId.
 * The `mint` seam is injected in tests; prod resolves the real Clerk Backend client.
 */
export async function mintSignInToken(
  userId: string,
  opts: { mint?: MintSignInToken } = {},
): Promise<string> {
  const mint = opts.mint ?? defaultMintSignInToken;
  return mint(userId);
}

async function defaultGetClerkUser(userId: string): Promise<ClerkUserLite> {
  // Dynamic import keeps @clerk/nextjs out of any code path that doesn't actually call Clerk, and
  // lets tests inject a stub without resolving the module at all.
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    primaryEmailAddress: user.primaryEmailAddress
      ? { emailAddress: user.primaryEmailAddress.emailAddress }
      : null,
  };
}

async function defaultGetClerkUserIdByEmail(email: string): Promise<string | null> {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ emailAddress: [email] });
  return data[0]?.id ?? null;
}

/** Best display name for a Clerk user: "First Last" → email local-part → a generic fallback. */
export function clerkDisplayName(user: ClerkUserLite): string {
  const full = [user.firstName, user.lastName]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" ");
  if (full.length > 0) return full;
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const local = email.split("@")[0]?.trim();
  if (local && local.length > 0) return local;
  return "Family member";
}

/**
 * Resolve a Clerk `userId` to our Person id, provisioning an Account + Person if this is the first
 * landing for that user. Idempotent: an already-provisioned user fast-paths to its existing Person.
 *
 * Race safety (ADR-0005): two concurrent `/auth/callback` requests for the same brand-new user both
 * pass the initial "no Person yet" read; one wins `createAccountWithPerson`, the other loses on the
 * `accounts.authProviderUserId` uniqueness constraint and re-resolves the winner's Person — so the
 * identity is never forked. The loser's failure surfaces in TWO shapes depending on isolation:
 *   - serialized transactions (e.g. PGlite, or a SERIALIZABLE retry): the in-transaction SELECT in
 *     `createAccountWithPerson` sees the committed row → `InvariantViolation`.
 *   - a true concurrent race under READ COMMITTED (prod Postgres): both SELECTs miss, both INSERT,
 *     the loser trips the unique INDEX → a raw driver error (SQLSTATE 23505), NOT InvariantViolation.
 * So the catch re-resolves on ANY error when a Person now exists — covering both shapes — and only
 * rethrows if provisioning genuinely failed (no Person materialized).
 */
export async function provisionOrResolveClerkUser(
  db: Database,
  userId: string,
  opts: { getClerkUser?: GetClerkUser } = {},
): Promise<string> {
  const existing = await findPersonIdByAuthProviderUserId(db, userId);
  if (existing) return existing;

  const getClerkUser = opts.getClerkUser ?? defaultGetClerkUser;
  const user = await getClerkUser(userId);
  const displayName = clerkDisplayName(user);
  const email = user.primaryEmailAddress?.emailAddress ?? "";

  try {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: userId,
      email,
      displayName,
    });
    return personId;
  } catch (err) {
    // A concurrent landing may have provisioned this userId between our read and our write. If a
    // Person now exists, return it (this covers BOTH the InvariantViolation and the raw 23505
    // unique-violation shapes — see the race note above). Otherwise the failure is real: rethrow.
    const personId = await findPersonIdByAuthProviderUserId(db, userId);
    if (personId) return personId;
    throw err;
  }
}

/** Look up the Clerk userId bound to an email (for the Clerk-mode seed), or null if none. */
export async function getClerkUserIdByEmail(
  email: string,
  opts: { getByEmail?: GetClerkUserIdByEmail } = {},
): Promise<string | null> {
  const getByEmail = opts.getByEmail ?? defaultGetClerkUserIdByEmail;
  return getByEmail(email);
}
