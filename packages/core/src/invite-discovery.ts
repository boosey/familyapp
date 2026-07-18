/**
 * Surface-and-confirm pending invites (issue #120).
 *
 * A person invited by email/phone who signs up or logs in NORMALLY (never taps the link) should
 * still discover the invite — but by EXPLICIT CONFIRM, never silent auto-join. The invitation's
 * contact is inviter-typed/unverified; the account's contact is provider-VERIFIED. A match (typo,
 * recycled number) does not prove the right human, so the hub surfaces "«Inviter» invited you to
 * the «Family» family — Join / Not me" and only runs `acceptInvitation` on Join.
 *
 * Matching is against the account's VERIFIED `account_contacts` only — an unverified contact is
 * never a match key. "Not me" writes a per-account dismissal row; it NEVER revokes the invite
 * (the link keeps working for the real invitee).
 */
import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  accountContacts,
  families,
  invitationDismissals,
  invitations,
  memberships,
  persons,
} from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";

/** One surfaced pending invite — enough to render the confirm card (never the invitee name). */
export interface PendingInvitationMatch {
  invitationId: string;
  familyId: string;
  familyName: string;
  inviterName: string;
}

/**
 * List live (pending, unexpired) invitations addressed to one of the account's VERIFIED contacts
 * (email case-insensitive, phone exact/E.164), for the account behind `personId`. Excludes:
 *   - invites this account already dismissed ("Not me"),
 *   - families the person is ALREADY an active member of (joining again would be a no-op error),
 *   - expired / non-pending invites (the link is dead — nothing to confirm).
 * Returns one row per match, so being invited to several families surfaces several cards.
 */
export async function listPendingInvitationsForPerson(
  db: Database,
  personId: string,
): Promise<PendingInvitationMatch[]> {
  const [self] = await db
    .select({ accountId: persons.accountId })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  if (!self?.accountId) return [];
  const accountId = self.accountId;

  const contacts = await db
    .select({ kind: accountContacts.kind, value: accountContacts.value })
    .from(accountContacts)
    .where(
      and(
        eq(accountContacts.accountId, accountId),
        isNotNull(accountContacts.verifiedAt),
      ),
    );
  const emails = contacts
    .filter((c) => c.kind === "email")
    .map((c) => c.value.toLowerCase());
  const phones = contacts.filter((c) => c.kind === "phone").map((c) => c.value);
  if (emails.length === 0 && phones.length === 0) return [];

  const contactClauses = [
    emails.length > 0
      ? sql`lower(${invitations.inviteeEmail}) in (${sql.join(
          emails.map((e) => sql`${e}`),
          sql`, `,
        )})`
      : null,
    phones.length > 0
      ? sql`${invitations.inviteePhone} in (${sql.join(
          phones.map((p) => sql`${p}`),
          sql`, `,
        )})`
      : null,
  ].filter((c) => c !== null);

  const rows = await db
    .select({
      invitationId: invitations.id,
      familyId: families.id,
      familyName: families.name,
      inviterName: persons.displayName,
      dismissedId: invitationDismissals.id,
      existingMembershipId: memberships.id,
    })
    .from(invitations)
    .innerJoin(families, eq(families.id, invitations.familyId))
    .innerJoin(persons, eq(persons.id, invitations.inviterPersonId))
    .leftJoin(
      invitationDismissals,
      and(
        eq(invitationDismissals.invitationId, invitations.id),
        eq(invitationDismissals.accountId, accountId),
      ),
    )
    .leftJoin(
      memberships,
      and(
        eq(memberships.familyId, invitations.familyId),
        eq(memberships.personId, personId),
        eq(memberships.status, "active"),
      ),
    )
    .where(
      and(
        eq(invitations.status, "pending"),
        or(
          isNull(invitations.expiresAt),
          gt(invitations.expiresAt, new Date()),
        ),
        or(...contactClauses),
      ),
    );

  return rows
    .filter((r) => r.dismissedId === null && r.existingMembershipId === null)
    .map((r) => ({
      invitationId: r.invitationId,
      familyId: r.familyId,
      familyName: r.familyName,
      inviterName: r.inviterName ?? "A family member",
    }));
}

/**
 * Record a per-account "Not me" dismissal for a surfaced invite. Idempotent (the unique index
 * makes a double-tap a no-op). NEVER touches the invitation itself — the link keeps working for
 * the real invitee.
 */
export async function dismissInvitationForAccount(
  db: Database,
  input: { invitationId: string; accountId: string },
): Promise<void> {
  await db
    .insert(invitationDismissals)
    .values({ invitationId: input.invitationId, accountId: input.accountId })
    .onConflictDoNothing({
      target: [
        invitationDismissals.invitationId,
        invitationDismissals.accountId,
      ],
    });
}
