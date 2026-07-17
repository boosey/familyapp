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
  resolveAccountByIdentity,
  resolveAccountIdByVerifiedEmail,
  attachIdentity,
} from "@chronicle/core";
import type { Database } from "@chronicle/db";

/** One of a Clerk user's email addresses, reduced to the two facts linking cares about. */
export interface ClerkEmail {
  emailAddress: string;
  /** True only when the provider marks this email verified — the sole match-key gate. */
  verified: boolean;
}

/** The slice of a Clerk `User` we depend on. Narrow on purpose — a Clerk SDK bump is a non-event. */
export interface ClerkUserLite {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** Clerk's convenience getter — the primary email, or null. */
  primaryEmailAddress?: { emailAddress: string } | null;
  /** ALL emails with verification status — the candidate match keys for linking. */
  emailAddresses: ClerkEmail[];
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
    emailAddresses: (user.emailAddresses ?? []).map((e) => ({
      emailAddress: e.emailAddress,
      // FAIL-CLOSED gate: only Clerk's literal "verified" status counts. transferable/null/
      // missing/unverified all → false, so an unverified email can never link to an account.
      verified: e.verification?.status === "verified",
    })),
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
 * Resolve a Clerk `userId` to our Person id via the provider-agnostic 4-step identity engine
 * (model B). The whole point is that a vendor user id is NOT the account key — a verified email is —
 * so the same human landing under a fresh Clerk instance (dev→prod, or a provider swap) links to
 * their existing account instead of forking a duplicate.
 *
 *   1. KNOWN IDENTITY → fast path. An `account_identities` row for (provider, userId) already exists;
 *      resolve straight to its Person without ever touching Clerk.
 *   2. VERIFIED-EMAIL LINK. Unknown vendor id, but one of the user's *verified* emails already keys
 *      an existing account → attach this vendor id as a new identity on that account and resolve.
 *      Only VERIFIED emails are match keys — an unverified/attacker-controlled email can never take
 *      over someone else's account (see the SECURITY test).
 *   3. FRESH ACCOUNT. No known id and no verified-email match → create a new Account + Person. The
 *      identity row is written here; an email *contact* is written only if the primary email is
 *      verified (unverified primary → identity but no contact, so no unique-constraint collision).
 *
 * Race safety (4, the catch): two concurrent `/auth/callback` landings for the same brand-new user
 * both miss steps 1–2 and both try to create; one wins, the other loses on the identity/account
 * uniqueness guard and re-resolves the winner's Person — so the identity is never forked. The
 * loser's failure surfaces in TWO shapes depending on isolation:
 *   - serialized transactions (e.g. PGlite, or a SERIALIZABLE retry): the in-transaction SELECT in
 *     `createAccountWithPerson` sees the committed row → `InvariantViolation`.
 *   - a true concurrent race under READ COMMITTED (prod Postgres): both SELECTs miss, both INSERT,
 *     the loser trips the unique INDEX → a raw driver error (SQLSTATE 23505), NOT InvariantViolation.
 * So the catch re-resolves by identity on ANY error when a row now exists — covering both shapes —
 * and only rethrows if provisioning genuinely failed (no account materialized).
 */
export async function provisionOrResolveClerkUser(
  db: Database,
  userId: string,
  opts: { getClerkUser?: GetClerkUser } = {},
): Promise<string> {
  const PROVIDER = "clerk";

  // 1. Known identity → fast path.
  const known = await resolveAccountByIdentity(db, PROVIDER, userId);
  if (known) return known.personId;

  const getClerkUser = opts.getClerkUser ?? defaultGetClerkUser;
  const user = await getClerkUser(userId);
  const displayName = clerkDisplayName(user);
  const primaryEmail = user.primaryEmailAddress?.emailAddress ?? "";
  const verifiedEmails = user.emailAddresses.filter((e) => e.verified).map((e) => e.emailAddress);

  // 2. Unknown id but a VERIFIED email matches an existing account → attach + resolve.
  for (const email of verifiedEmails) {
    const accountId = await resolveAccountIdByVerifiedEmail(db, email);
    if (accountId) {
      await attachIdentity(db, accountId, PROVIDER, userId);
      const attached = await resolveAccountByIdentity(db, PROVIDER, userId);
      if (attached) return attached.personId;
    }
  }

  // 3. Otherwise create a fresh account (identity + contact written inside).
  try {
    const { personId } = await createAccountWithPerson(db, {
      provider: PROVIDER,
      authProviderUserId: userId,
      email: primaryEmail,
      emailVerified: verifiedEmails.includes(primaryEmail),
      displayName,
    });
    return personId;
  } catch (err) {
    // Concurrent landing provisioned this id between our checks — re-resolve by identity.
    const retry = await resolveAccountByIdentity(db, PROVIDER, userId);
    if (retry) return retry.personId;
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
