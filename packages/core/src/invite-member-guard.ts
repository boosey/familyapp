/**
 * Same-family duplicate-member guard (issue #119).
 *
 * An invitation addressed to someone who is ALREADY an active member of the family is a
 * mistake — it would mint a provisional Person for an account that is already in. This guard
 * resolves the invitee's contact identifiers (email / phone) against VERIFIED `account_contacts`
 * only: an unverified contact is never a match key (schema invariant), so a typo'd or claimed-but-
 * unconfirmed address can never block an invite. Phone is matched exactly — callers normalize to
 * E.164 before create (the web layer's `normalizePhone`).
 */
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import {
  accountContacts,
  accounts,
  memberships,
  persons,
} from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";

export interface ConflictingFamilyMember {
  personId: string;
  displayName: string | null;
  /** Which supplied identifier resolved to the existing member. */
  matchedOn: "email" | "phone";
}

/**
 * Return the ACTIVE family member whose Account holds a verified contact matching the supplied
 * email or phone, or null when no such member exists (the common case — the invite may proceed).
 * A member of a DIFFERENT family, an ended/paused membership, and an unverified contact never
 * match.
 */
export async function findActiveFamilyMemberByContact(
  db: Database,
  input: { familyId: string; email?: string | null; phone?: string | null },
): Promise<ConflictingFamilyMember | null> {
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  const contactClauses = [
    email
      ? and(
          eq(accountContacts.kind, "email"),
          sql`lower(${accountContacts.value}) = ${email}`,
        )
      : null,
    phone
      ? and(eq(accountContacts.kind, "phone"), eq(accountContacts.value, phone))
      : null,
  ].filter((c) => c !== null);
  if (contactClauses.length === 0) return null;

  const [row] = await db
    .select({
      personId: persons.id,
      displayName: persons.displayName,
      kind: accountContacts.kind,
    })
    .from(accountContacts)
    .innerJoin(accounts, eq(accounts.id, accountContacts.accountId))
    .innerJoin(persons, eq(persons.accountId, accounts.id))
    .innerJoin(
      memberships,
      and(
        eq(memberships.personId, persons.id),
        eq(memberships.familyId, input.familyId),
      ),
    )
    .where(
      and(
        isNotNull(accountContacts.verifiedAt),
        eq(accounts.active, true),
        eq(memberships.status, "active"),
        or(...contactClauses),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    personId: row.personId,
    displayName: row.displayName,
    matchedOn: row.kind === "phone" ? "phone" : "email",
  };
}
