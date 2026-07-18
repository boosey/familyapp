/**
 * Member invitations — the account-creating join link (distinct from the link session token).
 *
 * An invitation leads a NEW person to create an Account and join a family. Like
 * the link session, the raw token is sent in the link and NEVER stored: only its SHA-256 hash
 * lives in the DB, so a database leak does not expose working invites (mirrors
 * `@chronicle/capture`'s `hashToken`). The raw token is returned exactly once, at creation.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { asks, families, invitations, persons } from "@chronicle/db/schema";
import type { Database, InvitationStatus, MembershipRole } from "@chronicle/db";
import { AuthorizationError, InvariantViolation } from "./errors";
import { insertActiveMembership, isActiveMember } from "./memberships";
import { defaultSpokenName } from "./names";
import {
  MEMBER_INVITATION_DEFAULT_TTL_MS,
  MEMBER_INVITATION_TOKEN_ENTROPY_BYTES,
} from "./constants";

/** Placeholder display name for a provisional invitee whose inviter did not supply a name. */
const PROVISIONAL_PERSON_FALLBACK_NAME = "Invited member";

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
  /**
   * The provisional (Account-less) Person minted for this invitee (ADR-0006). An Ask may target
   * this id immediately, before the invitee has joined; on acceptance it is merged into the
   * accepting Person.
   */
  inviteePersonId: string;
}

/**
 * Create a pending invitation. The inviter must be an ACTIVE member of the family (else
 * `AuthorizationError`) — you cannot invite into a family you are not in.
 *
 * ADR-0006: a provisional Account-less Person is inserted up front and the invitation anchors to it,
 * so questions can accumulate against a pending invitee before they join. Acceptance later merges
 * this provisional Person into the accepting Person.
 */
export async function createInvitation(
  db: Database,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const token = randomBytes(MEMBER_INVITATION_TOKEN_ENTROPY_BYTES).toString("base64url"); // 256 bits of entropy
  const ttl = input.ttlMs ?? MEMBER_INVITATION_DEFAULT_TTL_MS;
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

    // Re-invite dedup: a re-send to someone who was already invited but never joined must NOT mint a
    // second provisional Person (the old bug left duplicate `origin='invitee'` rows behind). If an
    // unaccepted invitation to this same invitee already exists in this family, we REFRESH that one
    // row in place — new token, back to `pending`, new expiry — reusing its provisional Person.
    //
    // Refresh-in-place (not a second invitation row) is load-bearing: the housekeeping reaper deletes
    // ALL invitations pointing at a reaped provisional Person, so a stale dead invite left beside a
    // fresh one would let the reaper destroy the live invite. One invite row per invitee keeps that safe.
    //
    // Match key: the email, matched case-insensitively — the ONLY reliable contact identity we have.
    // Email-less invites are deliberately NOT deduped: without a contact key, matching on name alone
    // would risk silently merging two different real people who share a name (e.g. two cousins both
    // entered as "Sal") with no undo — a worse failure than the duplicate row we are fixing. Such
    // repeat invites simply mint a fresh provisional Person, which the reaper cleans up when it dies.
    // `accepted` invites are excluded: their anchor is a real Account Person, not a reusable
    // provisional. The persons join re-asserts that.
    const trimmedName = input.inviteeName?.trim() || null;
    const trimmedEmail = input.inviteeEmail?.trim() || null;
    const matchKey = trimmedEmail
      ? sql`lower(${invitations.inviteeEmail}) = ${trimmedEmail.toLowerCase()}`
      : null;

    if (matchKey) {
      const [existing] = await tx
        .select({
          id: invitations.id,
          inviteePersonId: invitations.inviteePersonId,
        })
        .from(invitations)
        .innerJoin(persons, eq(persons.id, invitations.inviteePersonId))
        .where(
          and(
            eq(invitations.familyId, input.familyId),
            ne(invitations.status, "accepted"),
            eq(persons.origin, "invitee"),
            isNull(persons.accountId),
            matchKey,
          ),
        )
        .orderBy(desc(invitations.createdAt))
        .limit(1);

      if (existing) {
        await tx
          .update(invitations)
          .set({
            tokenHash: hashToken(token),
            inviterPersonId: input.inviterPersonId,
            status: "pending",
            expiresAt,
            // Only overwrite invitee metadata the caller actually supplied, so a bare re-invite does
            // not wipe a name/label/role captured on the original.
            ...(input.inviteeName !== undefined
              ? { inviteeName: input.inviteeName ?? null }
              : {}),
            ...(input.inviteeEmail !== undefined
              ? { inviteeEmail: input.inviteeEmail ?? null }
              : {}),
            ...(input.relationshipLabel !== undefined
              ? { relationshipLabel: input.relationshipLabel ?? null }
              : {}),
            ...(input.role !== undefined ? { role: input.role } : {}),
          })
          .where(eq(invitations.id, existing.id));

        // Keep the provisional Person's placeholder name in step when a fresh name is supplied.
        if (trimmedName) {
          await tx
            .update(persons)
            .set({
              displayName: trimmedName,
              spokenName: defaultSpokenName(trimmedName),
            })
            .where(eq(persons.id, existing.inviteePersonId));
        }

        return {
          invitationId: existing.id,
          token,
          inviteePersonId: existing.inviteePersonId,
        };
      }
    }

    // ADR-0006: mint the provisional (Account-less) Person the invitation anchors to. It carries the
    // inviter-supplied name as a placeholder; the real display/spoken name arrive when the invitee
    // signs up (their Person's names win on merge — see acceptInvitation).
    const provisionalDisplayName =
      input.inviteeName?.trim() || PROVISIONAL_PERSON_FALLBACK_NAME;
    const [provisional] = await tx
      .insert(persons)
      .values({
        displayName: provisionalDisplayName,
        spokenName: defaultSpokenName(provisionalDisplayName),
        // ADR-0016: provenance = invitee. This is the discriminator the housekeeping reaper keys
        // off (`reapUnacceptedInvitees`) — it is what makes an abandoned invite reapable while a
        // `mention` (deceased ancestor / structural bridge) is not.
        origin: "invitee",
        // ADR-0021: the inviter created this provisional Person — record it as immutable
        // `createdByPersonId` provenance (backs the `creator` arm of `canEditPerson`).
        createdByPersonId: input.inviterPersonId,
        accountId: null,
      })
      .returning({ id: persons.id });

    const [row] = await tx
      .insert(invitations)
      .values({
        tokenHash: hashToken(token),
        familyId: input.familyId,
        inviterPersonId: input.inviterPersonId,
        inviteePersonId: provisional!.id,
        inviteeName: input.inviteeName ?? null,
        inviteeEmail: input.inviteeEmail ?? null,
        relationshipLabel: input.relationshipLabel ?? null,
        role: input.role ?? "member",
        status: "pending",
        expiresAt,
      })
      .returning({ id: invitations.id });

    return { invitationId: row!.id, token, inviteePersonId: provisional!.id };
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
    // The inviter is a named self-person; displayName is nullable only for placeholder mentions
    // (ADR-0016), never an inviter. `?? ""` is a compiler guard.
    inviterName: row.inviterName ?? "",
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
 *
 * ADR-0006 merge: the invitation anchored a provisional Account-less Person. Acceptance folds that
 * provisional Person into `acceptedPersonId` — queued Asks that targeted the provisional Person are
 * re-pointed to the accepting Person (so questions raised before the invitee joined actually reach
 * them), the invitation's anchor is re-pointed, and the now-empty provisional row is deleted. This
 * is the "acceptance is a link, not a create" outcome (ADR-0006) achieved by merge rather than an
 * in-place account link, so the ADR-0005 JIT provisioning path is left untouched.
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
        inviteePersonId: invitations.inviteePersonId,
      })
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash))
      // Lock the invitation row for the life of this transaction. Without it, two concurrent accepts
      // of the same (bearer) token under READ COMMITTED both pass the pending check below and each
      // create a membership — redeeming a single-use invite twice. FOR UPDATE serializes them: the
      // loser blocks here until the winner commits, then re-reads status='accepted' and is rejected.
      .for("update")
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

    // Merge the provisional invitee Person into the accepting Person, unless the invite already
    // anchors to them (a no-op re-point). Guard: never destroy a Person that carries an Account —
    // the provisional row is Account-less by construction, and anything else signals a corrupted
    // anchor we must not silently delete.
    const provisionalId = invite.inviteePersonId;
    if (provisionalId !== input.acceptedPersonId) {
      const [provisional] = await tx
        .select({ accountId: persons.accountId })
        .from(persons)
        .where(eq(persons.id, provisionalId))
        .limit(1);
      if (!provisional) {
        throw new InvariantViolation(
          "invitation's provisional invitee Person is missing — cannot merge",
        );
      }
      if (provisional.accountId !== null) {
        throw new InvariantViolation(
          "invitation's invitee anchor is an Account-bearing Person — refusing to merge/delete",
        );
      }
      // Move any Asks queued against the provisional invitee onto the real Person.
      await tx
        .update(asks)
        .set({ targetPersonId: input.acceptedPersonId })
        .where(eq(asks.targetPersonId, provisionalId));
    }

    await tx
      .update(invitations)
      .set({
        status: "accepted",
        acceptedPersonId: input.acceptedPersonId,
        // Re-point the anchor to the real Person before the provisional row is deleted (the FK
        // would otherwise dangle). If it already pointed there this is a harmless self-set.
        inviteePersonId: input.acceptedPersonId,
        acceptedAt: new Date(),
        ...(input.relationshipLabel !== undefined
          ? { relationshipLabel: input.relationshipLabel.trim() || null }
          : {}),
      })
      .where(eq(invitations.id, invite.id));

    if (provisionalId !== input.acceptedPersonId) {
      await tx.delete(persons).where(eq(persons.id, provisionalId));
    }

    return { membershipId, familyId: invite.familyId };
  });
}
