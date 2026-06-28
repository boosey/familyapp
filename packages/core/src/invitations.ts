/**
 * Member invitations — the account-creating join link (distinct from the elder session token).
 *
 * An invitation leads a NEW younger-generation person to create an Account and join a family. Like
 * the elder session, the raw token is sent in the link and NEVER stored: only its SHA-256 hash
 * lives in the DB, so a database leak does not expose working invites (mirrors
 * `@chronicle/capture`'s `hashToken`). The raw token is returned exactly once, at creation.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { families, invitations, persons } from "@chronicle/db/schema";
import type { Database, InvitationStatus, MembershipRole } from "@chronicle/db";
import { AuthorizationError, InvariantViolation } from "./errors";
import { insertActiveMembership, isActiveMember } from "./memberships";

const DEFAULT_TTL_MS = 14 * 86_400_000; // 14 days

/** SHA-256 of the raw token. Lookups hash the incoming token and match on this. */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export interface CreateInvitationInput {
  familyId: string;
  inviterPersonId: string;
  inviteeName?: string;
  inviteeEmail?: string;
  relationshipLabel?: string;
  role?: MembershipRole;
  /** Time to live in ms. Defaults to 14 days. */
  ttlMs?: number;
}

export interface CreateInvitationResult {
  invitationId: string;
  /** The raw token — returned ONCE, to be embedded in the invite link. Never persisted. */
  token: string;
}

/**
 * Create a pending invitation. The inviter must be an ACTIVE member of the family (else
 * `AuthorizationError`) — you cannot invite into a family you are not in.
 */
export async function createInvitation(
  db: Database,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const token = randomBytes(32).toString("base64url"); // 256 bits of entropy
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  // One tx so the membership check and the insert see a consistent snapshot — a membership
  // revoked between the check and the write cannot slip an invitation through.
  return db.transaction(async (tx) => {
    const inviterIsMember = await isActiveMember(
      tx,
      input.inviterPersonId,
      input.familyId,
    );
    if (!inviterIsMember) {
      throw new AuthorizationError(
        "only an active member of the family may send an invitation",
      );
    }

    const [row] = await tx
      .insert(invitations)
      .values({
        tokenHash: hashToken(token),
        familyId: input.familyId,
        inviterPersonId: input.inviterPersonId,
        inviteeName: input.inviteeName ?? null,
        inviteeEmail: input.inviteeEmail ?? null,
        relationshipLabel: input.relationshipLabel ?? null,
        role: input.role ?? "member",
        status: "pending",
        expiresAt,
      })
      .returning({ id: invitations.id });

    return { invitationId: row!.id, token };
  });
}

export interface InvitationView {
  invitationId: string;
  familyId: string;
  familyName: string;
  /** The inviter's display name. */
  inviterName: string;
  inviteeName: string | null;
  relationshipLabel: string | null;
  status: InvitationStatus;
  /** True when the invite's `expiresAt` is in the past. */
  expired: boolean;
}

/**
 * Resolve a raw token to the safe welcome-screen payload, or null if the token is unknown. The
 * invitee's email is deliberately omitted (the welcome screen does not need it; only the inviter
 * ever sees who was emailed).
 */
export async function getInvitationByToken(
  db: Database,
  token: string,
): Promise<InvitationView | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      invitationId: invitations.id,
      familyId: invitations.familyId,
      familyName: families.name,
      inviterName: persons.displayName,
      inviteeName: invitations.inviteeName,
      relationshipLabel: invitations.relationshipLabel,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(families, eq(families.id, invitations.familyId))
    .innerJoin(persons, eq(persons.id, invitations.inviterPersonId))
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  const expired = row.expiresAt !== null && row.expiresAt.getTime() < Date.now();
  return {
    invitationId: row.invitationId,
    familyId: row.familyId,
    familyName: row.familyName,
    inviterName: row.inviterName,
    inviteeName: row.inviteeName,
    relationshipLabel: row.relationshipLabel,
    status: row.status,
    expired,
  };
}

/**
 * Accept an invitation atomically. Inside one transaction we re-read the invitation by token hash,
 * re-check it is still `pending` and unexpired (so a double-submit cannot create two memberships),
 * create the accepting person's ACTIVE membership with the invite's role, and flip the invitation
 * to `accepted` (recording the accepted person + time). A non-pending or expired invitation is
 * rejected with `InvariantViolation`. An edited `relationshipLabel` overrides the stored one (the
 * welcome screen lets the user correct it) before the row is persisted.
 */
export async function acceptInvitation(
  db: Database,
  input: { token: string; acceptedPersonId: string; relationshipLabel?: string },
): Promise<{ membershipId: string; familyId: string }> {
  const tokenHash = hashToken(input.token);

  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select({
        id: invitations.id,
        familyId: invitations.familyId,
        role: invitations.role,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash))
      .limit(1);
    if (!invite) {
      throw new InvariantViolation("invitation not found for token");
    }
    if (invite.status !== "pending") {
      throw new InvariantViolation(
        `invitation is ${invite.status}, not pending — cannot accept`,
      );
    }
    if (invite.expiresAt !== null && invite.expiresAt.getTime() < Date.now()) {
      throw new InvariantViolation("invitation has expired");
    }

    const { membershipId } = await insertActiveMembership(tx, {
      personId: input.acceptedPersonId,
      familyId: invite.familyId,
      role: invite.role,
    });

    await tx
      .update(invitations)
      .set({
        status: "accepted",
        acceptedPersonId: input.acceptedPersonId,
        acceptedAt: new Date(),
        ...(input.relationshipLabel !== undefined
          ? { relationshipLabel: input.relationshipLabel.trim() || null }
          : {}),
      })
      .where(eq(invitations.id, invite.id));

    return { membershipId, familyId: invite.familyId };
  });
}
