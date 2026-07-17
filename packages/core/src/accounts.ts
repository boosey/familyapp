/**
 * Account creation — the account login surface (spec Part IV).
 *
 * An Account is the OPTIONAL, severable login attached to a Person. It stores only the auth
 * provider's opaque user id (never a password — the provider owns credentials). The Person is the
 * spine; the Account points at it via the single `persons.account_id` FK (Account carries no
 * back-pointer, so the link cannot diverge). Sign-up therefore creates BOTH rows atomically and
 * sets that one FK — anything less leaves a half-formed identity.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import {
  accounts,
  persons,
  accountIdentities,
  accountContacts,
} from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { InvariantViolation } from "./errors";
import { defaultSpokenName } from "./names";

export interface SignUpAccountInput {
  /** The auth VENDOR (e.g. "clerk"). */
  provider: string;
  /** The vendor's opaque user id. */
  authProviderUserId: string;
  email: string;
  /** Whether the provider VERIFIED this email. Only a verified email becomes a match key. */
  emailVerified: boolean;
  displayName: string;
  /** Name the interviewer speaks aloud. Defaults to the first whitespace-delimited word. */
  spokenName?: string;
}

export interface AccountWithPerson {
  accountId: string;
  personId: string;
}

/**
 * Create an Account and its Person atomically, wiring `persons.account_id` to the new Account.
 * Rejects a duplicate `authProviderUserId` (one Account per provider identity) with
 * `InvariantViolation` — checked inside the transaction so a concurrent double sign-up cannot
 * leave two accounts for one provider id.
 */
export async function createAccountWithPerson(
  db: Database,
  input: SignUpAccountInput,
): Promise<AccountWithPerson> {
  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    throw new InvariantViolation("displayName is required");
  }
  const spokenName = input.spokenName?.trim() || defaultSpokenName(displayName);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.authProviderUserId, input.authProviderUserId))
      .limit(1);
    if (existing) {
      throw new InvariantViolation(
        `an account already exists for authProviderUserId ${input.authProviderUserId}`,
      );
    }

    const [account] = await tx
      .insert(accounts)
      .values({
        authProviderUserId: input.authProviderUserId,
        email: input.email,
        displayName,
      })
      .returning();

    const [person] = await tx
      .insert(persons)
      .values({
        displayName,
        spokenName,
        accountId: account!.id,
      })
      .returning();

    await tx.insert(accountIdentities).values({
      accountId: account!.id,
      provider: input.provider,
      providerUserId: input.authProviderUserId,
    });

    const normEmail = input.email.trim().toLowerCase();
    if (normEmail.length > 0) {
      await tx.insert(accountContacts).values({
        accountId: account!.id,
        kind: "email",
        value: normEmail,
        verifiedAt: input.emailVerified ? new Date() : null,
      });
    }

    return { accountId: account!.id, personId: person!.id };
  });
}

/**
 * Resolve a provider user id to the controlled Person id, by joining accounts -> persons on the
 * single FK. Returns null if no account holds that provider id, or no Person points at it.
 */
export async function findPersonIdByAuthProviderUserId(
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

export interface ReconcileAccountProfileInput {
  /** Opaque id from the auth provider — the row to reconcile (never changes; it is the join key). */
  authProviderUserId: string;
  /** New primary email. `undefined`/empty leaves the stored email untouched (never blanks it). */
  email?: string | null;
  /**
   * New identity name (e.g. from a Clerk `user.updated`). `undefined`/empty leaves the stored name
   * untouched — a Name-required provider can still momentarily emit a blank, and we must not overwrite
   * a good in-app-edited name with nothing.
   */
  displayName?: string | null;
}

export interface ReconcileAccountResult {
  /** false when no Account carries this provider id (e.g. an update for a never-provisioned user). */
  matched: boolean;
  /** The controlled Person id, present only when `matched`. */
  personId?: string;
}

/**
 * Reconcile a provider-side profile change (the `user.updated` webhook path) back onto the DB so a
 * rename in the auth provider does not leave a stale row. Updates the Account mirror (`email`,
 * `displayName`) AND the controlled Person's `displayName` — the user-facing identity name the app
 * reads everywhere. The provider is treated as the source of truth for a self-account's profile name.
 *
 * Deliberately does NOT touch `persons.spokenName`: that is a user-owned field (customized at
 * onboarding, e.g. spoken "Bob" for display "Robert") and must survive an unrelated email/name change.
 *
 * Idempotent by construction (declarative set-to-value), so a webhook replay or retry is a no-op —
 * no event-id ledger is needed. No match → `{ matched: false }` (event for a user we never provisioned,
 * or a soft-deleted account whose provider id was retired — see `deactivateAccountByAuthProviderUserId`).
 */
export async function reconcileAccountProfile(
  db: Database,
  input: ReconcileAccountProfileInput,
): Promise<ReconcileAccountResult> {
  const email = input.email?.trim();
  const displayName = input.displayName?.trim();

  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.authProviderUserId, input.authProviderUserId))
      .limit(1);
    if (!account) return { matched: false };

    const accountPatch: { email?: string; displayName?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (email && email.length > 0) accountPatch.email = email;
    if (displayName && displayName.length > 0) accountPatch.displayName = displayName;
    await tx.update(accounts).set(accountPatch).where(eq(accounts.id, account.id));

    // Propagate the name to the controlled Person (the identity the app renders). Only the Person
    // that this Account controls — matched via the single `persons.account_id` FK.
    if (displayName && displayName.length > 0) {
      await tx
        .update(persons)
        .set({ displayName, updatedAt: new Date() })
        .where(eq(persons.accountId, account.id));
    }

    const [person] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.accountId, account.id))
      .limit(1);
    return { matched: true, personId: person?.id };
  });
}

export interface DeactivateAccountResult {
  /** false when no Account carries this provider id (nothing to deactivate). */
  matched: boolean;
  /** The controlled Person id (preserved — only the login is severed), present only when `matched`. */
  personId?: string;
}

/**
 * Sever the login for a provider-side account deletion (the `user.deleted` webhook path). Policy
 * (documented in the issue #10 acceptance criteria): SOFT-delete. We flip `accounts.active = false`
 * and preserve the Person and ALL its expressive content — a login deletion must never erase family
 * stories that other members may depend on. Owner-initiated content erasure is the SEPARATE, explicit
 * ADR-0008 path; this webhook only detaches the credential.
 *
 * Idempotent: deactivating an already-inactive account is a harmless no-op, so a webhook replay/retry
 * is safe. No match → `{ matched: false }`.
 */
export async function deactivateAccountByAuthProviderUserId(
  db: Database,
  authProviderUserId: string,
): Promise<DeactivateAccountResult> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.authProviderUserId, authProviderUserId))
      .limit(1);
    if (!account) return { matched: false };

    await tx
      .update(accounts)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(accounts.id, account.id));

    const [person] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.accountId, account.id))
      .limit(1);
    return { matched: true, personId: person?.id };
  });
}

/** Resolve a vendor identity to its ACTIVE account's Person, or null. */
export async function resolveAccountByIdentity(
  db: Database,
  provider: string,
  providerUserId: string,
): Promise<{ personId: string } | null> {
  const [row] = await db
    .select({ personId: persons.id })
    .from(accountIdentities)
    .innerJoin(accounts, eq(accounts.id, accountIdentities.accountId))
    .innerJoin(persons, eq(persons.accountId, accounts.id))
    .where(
      and(
        eq(accountIdentities.provider, provider),
        eq(accountIdentities.providerUserId, providerUserId),
        eq(accounts.active, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Resolve a VERIFIED email to its ACTIVE account id, or null. Unverified never matches. */
export async function resolveAccountIdByVerifiedEmail(
  db: Database,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) return null;
  const [row] = await db
    .select({ accountId: accounts.id })
    .from(accountContacts)
    .innerJoin(accounts, eq(accounts.id, accountContacts.accountId))
    .where(
      and(
        eq(accountContacts.kind, "email"),
        eq(accountContacts.value, normalized),
        isNotNull(accountContacts.verifiedAt),
        eq(accounts.active, true),
      ),
    )
    .limit(1);
  return row?.accountId ?? null;
}

/** Attach a vendor identity to an existing account. Idempotent (no-op on conflict). */
export async function attachIdentity(
  db: Database,
  accountId: string,
  provider: string,
  providerUserId: string,
): Promise<void> {
  await db
    .insert(accountIdentities)
    .values({ accountId, provider, providerUserId })
    .onConflictDoNothing({
      target: [accountIdentities.provider, accountIdentities.providerUserId],
    });
}
