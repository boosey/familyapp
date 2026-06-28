/**
 * Account creation — the younger-generation login surface (spec Part IV).
 *
 * An Account is the OPTIONAL, severable login attached to a Person. It stores only the auth
 * provider's opaque user id (never a password — the provider owns credentials). The Person is the
 * spine; the Account points at it via the single `persons.account_id` FK (Account carries no
 * back-pointer, so the link cannot diverge). Sign-up therefore creates BOTH rows atomically and
 * sets that one FK — anything less leaves a half-formed identity.
 */
import { eq } from "drizzle-orm";
import { accounts, persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { InvariantViolation } from "./errors";

export interface SignUpAccountInput {
  /** Opaque id from the auth provider (mock or Clerk). */
  authProviderUserId: string;
  email: string;
  displayName: string;
  /** Name the interviewer speaks aloud. Defaults to the first whitespace-delimited word. */
  spokenName?: string;
}

export interface AccountWithPerson {
  accountId: string;
  personId: string;
}

/** First whitespace-delimited word of a display name (the spoken-name default). */
function defaultSpokenName(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : displayName.trim();
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
