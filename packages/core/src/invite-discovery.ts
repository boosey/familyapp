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
import { and, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  accountContacts,
  families,
  invitationDismissals,
  invitations,
  memberships,
  persons,
} from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import type { ResolvedInvitation } from "./invitations";

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
 * Find the single live (pending, unexpired) invitation from ONE family addressed to a VERIFIED
 * contact of the requester's account (#354) — the machine-check behind "an invited person who took
 * the discovery 'request to join' route should be auto-approved, not re-approved by hand." Mirrors
 * {@link listPendingInvitationsForPerson}'s match rules exactly (verified contacts only; email
 * case-insensitive; excludes invites this account already dismissed with "Not me"), but scoped to
 * `familyId` and returning the {@link ResolvedInvitation} fields the accept core needs. Newest
 * invite wins if several match. Returns null when there is no confident match — the caller then
 * falls back to the normal steward-approval gate.
 *
 * Additionally CONSUMABILITY-gated: only returns an invitation whose invitee anchor is safe to fold
 * into the requester (a disposable ADR-0006 provisional, or an invite already person-bound to the
 * requester). An invite anchored to a REAL tree node that is a DIFFERENT Person (a person-bound
 * `mention`/`self` invite, #333) is skipped — consuming it would need a two-Person merge (the
 * duplicate-at-signup problem, out of scope), and acceptance would throw; skipping keeps the request
 * on the normal steward gate instead of blocking it.
 *
 * Accepts a tx handle so it can run inside `createJoinRequest`'s transaction.
 */
export async function findLiveInvitationForRequester(
  db: Pick<Database, "select">,
  input: { familyId: string; requesterPersonId: string },
): Promise<ResolvedInvitation | null> {
  const [self] = await db
    .select({ accountId: persons.accountId })
    .from(persons)
    .where(eq(persons.id, input.requesterPersonId))
    .limit(1);
  if (!self?.accountId) return null;
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
  if (emails.length === 0 && phones.length === 0) return null;

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
      id: invitations.id,
      familyId: invitations.familyId,
      role: invitations.role,
      inviteePersonId: invitations.inviteePersonId,
      inviterPersonId: invitations.inviterPersonId,
      inviteRelationship: invitations.inviteRelationship,
      dismissedId: invitationDismissals.id,
      anchorOrigin: persons.origin,
      anchorAccountId: persons.accountId,
    })
    .from(invitations)
    .innerJoin(persons, eq(persons.id, invitations.inviteePersonId))
    .leftJoin(
      invitationDismissals,
      and(
        eq(invitationDismissals.invitationId, invitations.id),
        eq(invitationDismissals.accountId, accountId),
      ),
    )
    .where(
      and(
        eq(invitations.familyId, input.familyId),
        eq(invitations.status, "pending"),
        or(isNull(invitations.expiresAt), gt(invitations.expiresAt, new Date())),
        or(...contactClauses),
      ),
    )
    .orderBy(desc(invitations.createdAt));

  const match = rows.find((r) => {
    if (r.dismissedId !== null) return false;
    // CONSUMABILITY (mirrors acceptResolvedInvitation's merge guard as a predicate, not a throw):
    // auto-approve may only consume an invitation whose invitee anchor is safe to fold into the
    // requester — either the invite is already anchored to the requester's own Person (person-bound
    // self-accept, #333) or the anchor is a disposable ADR-0006 provisional (`origin === "invitee"`,
    // Account-less). If the anchor is a REAL tree node (a `mention`/`self` Person that is NOT the
    // requester — e.g. an already-placed relative who was person-bound-invited), consuming it would
    // require merging two distinct Persons (the known duplicate-at-signup problem), which acceptance
    // deliberately refuses. We must NOT throw here (that would block the whole join request): we skip
    // auto-approve and let the request fall through to the normal steward-approval gate.
    return (
      r.inviteePersonId === input.requesterPersonId ||
      (r.anchorOrigin === "invitee" && r.anchorAccountId === null)
    );
  });
  if (!match) return null;
  return {
    id: match.id,
    familyId: match.familyId,
    role: match.role,
    inviteePersonId: match.inviteePersonId,
    inviterPersonId: match.inviterPersonId,
    inviteRelationship: match.inviteRelationship,
  };
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
