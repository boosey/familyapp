/**
 * Shared verified-email → accounts.email resolution for outbound pings (#270 / #276).
 *
 * Extracted from `story-shared-pings.ts` so every outbound ping resolver (story-shared, and now
 * questions-for-me) uses the SAME rule: prefer a verified `account_contacts` email; fall back to
 * `accounts.email`. Metadata only — never touches Story/Media content.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { accountContacts, accounts, persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";

/** Prefer verified email contacts; fall back to accounts.email. */
export async function resolvePersonEmails(
  db: Database,
  personIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (personIds.length === 0) return out;

  const personRows = await db
    .select({
      personId: persons.id,
      accountId: persons.accountId,
      accountEmail: accounts.email,
    })
    .from(persons)
    .leftJoin(accounts, eq(accounts.id, persons.accountId))
    .where(inArray(persons.id, personIds));

  const accountIds = personRows
    .map((r) => r.accountId)
    .filter((id): id is string => id !== null);

  const verifiedByAccount = new Map<string, string>();
  if (accountIds.length > 0) {
    const contacts = await db
      .select({
        accountId: accountContacts.accountId,
        value: accountContacts.value,
      })
      .from(accountContacts)
      .where(
        and(
          inArray(accountContacts.accountId, accountIds),
          eq(accountContacts.kind, "email"),
          isNotNull(accountContacts.verifiedAt),
        ),
      );
    for (const c of contacts) {
      if (!verifiedByAccount.has(c.accountId)) {
        verifiedByAccount.set(c.accountId, c.value);
      }
    }
  }

  for (const row of personRows) {
    if (row.accountId) {
      const verified = verifiedByAccount.get(row.accountId);
      if (verified) {
        out.set(row.personId, verified);
        continue;
      }
    }
    if (row.accountEmail && row.accountEmail.length > 0) {
      out.set(row.personId, row.accountEmail);
    }
  }
  return out;
}
