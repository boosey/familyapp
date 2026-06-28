/**
 * Mock AuthProvider — the LOCAL/DEV stand-in for Clerk's user store.
 *
 * Clerk owns its own credential store in production; locally we don't have that, so this provider
 * plays both halves: it keeps a credentials table (`mock_auth_users`) AND resolves a session into a
 * Person exactly the way the Clerk adapter does. The split is deliberate and load-bearing:
 *
 *   - `accounts` stores ONLY the opaque `auth_provider_user_id` — NEVER a password. Identity in our
 *     domain is "an Account points at a Person"; the password is the auth vendor's concern.
 *   - `mock_auth_users` is that vendor's concern made local: { email, scrypt password hash,
 *     auth_provider_user_id }. It is the thing Clerk would own. Nothing in core/db depends on it.
 *
 * Session: an httpOnly cookie `chronicle_mock_session` whose value is the `auth_provider_user_id`
 * (opaque — same role as a Clerk session resolving to a Clerk userId). `getCurrentAuthContext`
 * mirrors auth-clerk.ts: cookie → Account.auth_provider_user_id → Person.accountId → Person id,
 * via a single inner join, and NEVER throws (anonymous on any failure).
 *
 * Password hashing: node:crypto scrypt, stored as `scrypt$<saltHex>$<hashHex>`, verified with a
 * constant-time compare. The hashing helpers are pure and exported so they (and the DB-backed
 * credential lookup) are unit-testable without a live Next request context.
 *
 * In production Clerk is configured and runtime.ts never constructs this provider.
 */
import "server-only";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { accounts, mockAuthUsers, persons } from "@chronicle/db/schema";
import type { AuthContext } from "@chronicle/core";
import type { Database, MockAuthUser } from "@chronicle/db";
import type { AuthProvider } from "./auth";

/** httpOnly session cookie name. Value = the Account's `auth_provider_user_id` (opaque). */
export const DEV_MOCK_SESSION_COOKIE = "chronicle_mock_session";

const SCRYPT_KEYLEN = 64;

// --------------------------------------------------------------------------
// Password hashing — pure, no DB, no cookies. Exported for direct unit testing.
// --------------------------------------------------------------------------

/** Hash a password with a fresh random salt. Format: `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time verify against a stored `scrypt$salt$hash` string. False on any malformed input. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length === 0) return false;
    // Derive the candidate at the stored hash's length so timingSafeEqual gets equal-length buffers.
    const candidate = scryptSync(
      password,
      Buffer.from(saltHex, "hex"),
      expected.length,
    );
    return timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

/** Normalize an email for storage + lookup so case/whitespace differences can't fork a credential. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Postgres/PGlite unique-violation (SQLSTATE 23505) — used to map a racing email collision. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ((err as { code?: unknown }).code === "23505") return true;
  const msg = String((err as { message?: unknown }).message ?? err);
  return /unique|duplicate key/i.test(msg);
}

/** DB-backed credential lookup by (normalized) email. No cookies — testable directly. */
async function findCredentialByEmail(
  db: Database,
  email: string,
): Promise<MockAuthUser | undefined> {
  const [row] = await db
    .select()
    .from(mockAuthUsers)
    .where(eq(mockAuthUsers.email, normalizeEmail(email)))
    .limit(1);
  return row;
}

/**
 * Resolve an `auth_provider_user_id` to a Person id via the same inner join the Clerk adapter uses.
 * Null unless BOTH the Account exists for that id AND a Person points at it (no fabricated identity).
 */
async function resolvePersonId(
  db: Database,
  authProviderUserId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ personId: persons.id })
    .from(accounts)
    .innerJoin(persons, eq(persons.accountId, accounts.id))
    .where(eq(accounts.authProviderUserId, authProviderUserId))
    .limit(1);
  return row?.personId ?? null;
}

async function setSessionCookie(authProviderUserId: string): Promise<void> {
  const jar = await cookies();
  jar.set(DEV_MOCK_SESSION_COOKIE, authProviderUserId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
}

// --------------------------------------------------------------------------
// AuthProvider
// --------------------------------------------------------------------------

/**
 * The DEV/local AuthProvider. Reads the session cookie and resolves it the same way the Clerk
 * adapter resolves a Clerk session: cookie → Account → Person. Never throws — a missing cookie, a
 * stale/forged cookie, an orphaned Account, or a transient DB error all degrade to anonymous.
 */
export function createMockAuthProvider(db: Database): AuthProvider {
  return {
    async getCurrentAuthContext(): Promise<AuthContext> {
      try {
        const jar = await cookies();
        const authProviderUserId = jar.get(DEV_MOCK_SESSION_COOKIE)?.value;
        if (!authProviderUserId) return { kind: "anonymous" };
        const personId = await resolvePersonId(db, authProviderUserId);
        if (!personId) return { kind: "anonymous" };
        return { kind: "account", personId };
      } catch (err) {
        // Mirror auth-clerk: the caller swallows throws (Next's error pipeline doesn't surface
        // caught errors), so log here or a downed DB looks like a silent forced-logout.
        console.error(
          "auth-mock: failed to resolve mock session → falling back to anonymous",
          err,
        );
        return { kind: "anonymous" };
      }
    },
    async establishAccountSession(personId: string): Promise<void> {
      // Magic-link sign-in (ADR-0003): resolve the Person to their Account's opaque
      // `auth_provider_user_id` (the mock session value, exactly what a Clerk session would carry)
      // and set the session cookie. Throws if the Person has no Account — the caller must only
      // magic-link a Person who has one.
      const [row] = await db
        .select({ authProviderUserId: accounts.authProviderUserId })
        .from(persons)
        .innerJoin(accounts, eq(accounts.id, persons.accountId))
        .where(eq(persons.id, personId))
        .limit(1);
      if (!row) {
        throw new Error(
          `establishAccountSession: Person ${personId} has no Account to sign in as`,
        );
      }
      await setSessionCookie(row.authProviderUserId);
    },
  };
}

// --------------------------------------------------------------------------
// Server-action helpers (set/clear the cookie via next/headers cookies()).
// --------------------------------------------------------------------------

export type MockSignUpResult =
  | { ok: true; personId: string }
  | { ok: false; error: "email_taken" | "invalid" };

/**
 * Register a new mock user: claim the email in `mock_auth_users`, mint an `auth_provider_user_id`,
 * create the Account+Person via core, and sign the new session in. The new Person's `onboarded_at`
 * stays NULL — the onboarding gate routes them to /welcome on first sign-in.
 */
export async function mockSignUp(
  db: Database,
  input: { email: string; password: string; displayName: string },
): Promise<MockSignUpResult> {
  const email = normalizeEmail(input.email);
  if (await findCredentialByEmail(db, email)) {
    return { ok: false, error: "email_taken" };
  }

  const authProviderUserId = `mock:${randomUUID()}`;

  // Lazy import of the core write path: keeps this module loadable (and the rest of the test suite
  // green) before TASK 2's `createAccountWithPerson` lands, mirroring auth-clerk's lazy vendor
  // import. Once core exports it, this resolves with no further change.
  const { createAccountWithPerson } = await import("@chronicle/core");

  // BOTH writes in ONE transaction so the credential and the Account/Person commit or roll back
  // together. If createAccountWithPerson throws, the mock_auth_users row is rolled back too — no
  // orphaned credential that would permanently lock that email out of a retry. (Passing `tx` nests
  // createAccountWithPerson's own transaction as a savepoint, which PGlite/Postgres support.)
  let personId: string;
  try {
    personId = await db.transaction(async (tx) => {
      await tx.insert(mockAuthUsers).values({
        email,
        passwordHash: hashPassword(input.password),
        authProviderUserId,
      });
      const created = await createAccountWithPerson(tx as Database, {
        authProviderUserId,
        email,
        displayName: input.displayName,
      });
      return created.personId;
    });
  } catch (err) {
    // A racing duplicate email trips the unique index (the pre-check above is just for a clean
    // error on the common path); anything else is a genuine failure to provision the account.
    if (isUniqueViolation(err)) return { ok: false, error: "email_taken" };
    return { ok: false, error: "invalid" };
  }

  await setSessionCookie(authProviderUserId);
  return { ok: true, personId };
}

export type MockSignInResult =
  | { ok: true; personId: string }
  | { ok: false; error: "invalid_credentials" };

/** Verify email+password against `mock_auth_users`, then sign the session in. */
export async function mockSignIn(
  db: Database,
  input: { email: string; password: string },
): Promise<MockSignInResult> {
  const cred = await findCredentialByEmail(db, input.email);
  // Unknown email and wrong password both return the same opaque error (the API doesn't reveal
  // which). This is NOT a timing-safe check — scrypt is skipped when the email isn't found — but
  // this provider is dev-only; production identity is Clerk.
  if (!cred || !verifyPassword(input.password, cred.passwordHash)) {
    return { ok: false, error: "invalid_credentials" };
  }
  const personId = await resolvePersonId(db, cred.authProviderUserId);
  if (!personId) return { ok: false, error: "invalid_credentials" };

  await setSessionCookie(cred.authProviderUserId);
  return { ok: true, personId };
}

/** Clear the session cookie. */
export async function mockSignOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(DEV_MOCK_SESSION_COOKIE);
}

/**
 * DEV-SEED helper: give an already-seeded Account a known password by inserting its credential row.
 * Does NOT create an Account/Person (the seed already did) — it only links a login to an existing
 * `auth_provider_user_id`. Lets dev-seed hand Sofia/Marco a password like "password".
 */
export async function seedMockCredential(
  db: Database,
  input: { email: string; password: string; authProviderUserId: string },
): Promise<void> {
  await db.insert(mockAuthUsers).values({
    email: normalizeEmail(input.email),
    passwordHash: hashPassword(input.password),
    authProviderUserId: input.authProviderUserId,
  });
}
