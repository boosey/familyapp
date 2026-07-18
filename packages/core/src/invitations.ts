/**
 * Member invitations — the account-creating join link (distinct from the link session token).
 *
 * An invitation leads a NEW person to create an Account and join a family. Like
 * the link session, the raw token is sent in the link and NEVER stored in plaintext: only its
 * SHA-256 hash plus an AES-256-GCM-sealed copy (issue #116 — one durable link per pending invite,
 * so the token must be recoverable for re-delivery without rotation) live in the DB. A database
 * leak yields no working invite as long as INVITE_TOKEN_ENC_KEY stays out of the database
 * (mirrors `@chronicle/capture`'s `hashToken`).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { asks, families, invitations, persons } from "@chronicle/db/schema";
import type { Database, InvitationStatus, MembershipRole } from "@chronicle/db";
import { AuthorizationError, InvariantViolation, ThrottleError } from "./errors";
import { insertActiveMembership, isActiveMember } from "./memberships";
import { defaultSpokenName } from "./names";
import { openToken, sealToken } from "./token-seal";
import {
  INVITE_THROTTLE_DESTINATION_LIMIT,
  INVITE_THROTTLE_DESTINATION_WINDOW_MS,
  INVITE_THROTTLE_INVITER_LIMIT,
  INVITE_THROTTLE_INVITER_WINDOW_MS,
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
  inviteePhone?: string;
  /**
   * Channels delivery was requested on at enqueue time (e.g. ["email","sms"]). Kept as `string[]`
   * here — core stays vendor-agnostic and does not import `@chronicle/notifications`' branded
   * `DeliveryChannel` type; the web layer narrows/produces it.
   */
  deliveryChannels?: string[];
  relationshipLabel?: string;
  role?: MembershipRole;
  /** Time to live in ms. Defaults to 14 days. */
  ttlMs?: number;
}

export interface CreateInvitationResult {
  invitationId: string;
  /**
   * The raw token — embedded in the invite link. Never persisted in plaintext (hash + sealed copy
   * only); for a LIVE pending re-invite this is the SAME token as before (issue #116 — one durable
   * link), freshly minted only on create or on rotation of a dead invite.
   */
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

    // Invite-send throttle (issue #105) — a GENEROUS accident guard, not a rate-limit against
    // determined abuse. Two independent arms, each a rolling window counted over the invitations
    // table (every creation is a row, so rows ≈ sends):
    //   1. Per INVITER: caps a bulk-paste/scripting accident (a whole spreadsheet's worth of
    //      invites in one sitting) across all families the inviter belongs to.
    //   2. Per DESTINATION (email OR phone): protects the RECIPIENT from being spammed — app-wide,
    //      so it holds even when different inviters (or families) address the same person.
    // Both run inside the creation tx so a burst of concurrent submissions sees one consistent
    // count. Exceeding either arm refuses the invite with ThrottleError; nothing is written.
    const trimmedName = input.inviteeName?.trim() || null;
    const trimmedEmail = input.inviteeEmail?.trim() || null;
    const trimmedPhone = input.inviteePhone?.trim() || null;

    const inviterWindowStart = new Date(
      Date.now() - INVITE_THROTTLE_INVITER_WINDOW_MS,
    );
    const [inviterCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invitations)
      .where(
        and(
          eq(invitations.inviterPersonId, input.inviterPersonId),
          gt(invitations.createdAt, inviterWindowStart),
        ),
      );
    if ((inviterCount?.n ?? 0) >= INVITE_THROTTLE_INVITER_LIMIT) {
      throw new ThrottleError(
        `inviter ${input.inviterPersonId} exceeded ${INVITE_THROTTLE_INVITER_LIMIT} invitations per hour`,
      );
    }

    if (trimmedEmail || trimmedPhone) {
      const destinationWindowStart = new Date(
        Date.now() - INVITE_THROTTLE_DESTINATION_WINDOW_MS,
      );
      // Match whichever contacts were supplied: email case-insensitively, phone exactly (callers
      // normalize to E.164 before create — see the web action's normalizePhone).
      const destinationClauses = [
        trimmedEmail
          ? sql`lower(${invitations.inviteeEmail}) = ${trimmedEmail.toLowerCase()}`
          : null,
        trimmedPhone ? eq(invitations.inviteePhone, trimmedPhone) : null,
      ].filter((c) => c !== null);
      const [destinationCount] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(invitations)
        .where(
          and(
            or(...destinationClauses),
            gt(invitations.createdAt, destinationWindowStart),
          ),
        );
      if ((destinationCount?.n ?? 0) >= INVITE_THROTTLE_DESTINATION_LIMIT) {
        throw new ThrottleError(
          `destination already received ${INVITE_THROTTLE_DESTINATION_LIMIT} invitations in the last 24 hours`,
        );
      }
    }

    // Re-invite dedup: a re-send to someone who was already invited but never joined must NOT mint a
    // second provisional Person (the old bug left duplicate `origin='invitee'` rows behind). If an
    // unaccepted invitation to this same invitee already exists in this family, we REFRESH that one
    // row in place, reusing its provisional Person.
    //
    // Refresh-in-place (not a second invitation row) is load-bearing: the housekeeping reaper deletes
    // ALL invitations pointing at a reaped provisional Person, so a stale dead invite left beside a
    // fresh one would let the reaper destroy the live invite. One invite row per invitee keeps that safe.
    //
    // ONE DURABLE LINK per pending invite (issue #116): the matched invite's token is ROTATED only
    // when it is DEAD (expired or no longer pending) — or unrecoverable (a pre-#116 row with no
    // sealed copy). When it is still LIVE we return the SAME token (opened from its sealed copy), so
    // a link already sent by email keeps working when the inviter later sends it by SMS or copies it.
    //
    // Match key: the email, matched case-insensitively — the ONLY reliable contact identity we have.
    // Email-less invites are deliberately NOT deduped: without a contact key, matching on name alone
    // would risk silently merging two different real people who share a name (e.g. two cousins both
    // entered as "Sal") with no undo — a worse failure than the duplicate row we are fixing. Such
    // repeat invites simply mint a fresh provisional Person, which the reaper cleans up when it dies.
    // `accepted` invites are excluded: their anchor is a real Account Person, not a reusable
    // provisional. The persons join re-asserts that.
    const matchKey = trimmedEmail
      ? sql`lower(${invitations.inviteeEmail}) = ${trimmedEmail.toLowerCase()}`
      : null;

    if (matchKey) {
      const [existing] = await tx
        .select({
          id: invitations.id,
          inviteePersonId: invitations.inviteePersonId,
          tokenSealed: invitations.tokenSealed,
          status: invitations.status,
          expiresAt: invitations.expiresAt,
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
        const isLive =
          existing.status === "pending" &&
          (existing.expiresAt === null ||
            existing.expiresAt.getTime() > Date.now());
        // Recover the durable token for a live invite; null forces the rotation path (dead invite,
        // or a legacy row with nothing sealed under the active key).
        const durableToken = isLive ? openToken(existing.tokenSealed) : null;

        await tx
          .update(invitations)
          .set({
            inviterPersonId: input.inviterPersonId,
            // Rotation (dead invite only): fresh token, hash, sealed copy, back to pending, new
            // expiry. On the durable path NONE of the token fields are touched — the previously
            // sent link keeps working.
            ...(durableToken === null
              ? {
                  tokenHash: hashToken(token),
                  tokenSealed: sealToken(token),
                  status: "pending" as const,
                  expiresAt,
                }
              : {}),
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
          token: durableToken ?? token,
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
        tokenSealed: sealToken(token),
        familyId: input.familyId,
        inviterPersonId: input.inviterPersonId,
        inviteePersonId: provisional!.id,
        inviteeName: input.inviteeName ?? null,
        inviteeEmail: input.inviteeEmail ?? null,
        inviteePhone: input.inviteePhone ?? null,
        deliveryChannels: input.deliveryChannels ?? null,
        relationshipLabel: input.relationshipLabel ?? null,
        role: input.role ?? "member",
        status: "pending",
        expiresAt,
      })
      .returning({ id: invitations.id });

    return { invitationId: row!.id, token, inviteePersonId: provisional!.id };
  });
}

/**
 * Recover the raw token of a LIVE pending invitation for (re-)delivery over another channel
 * (issue #116 — the durable link is delivered, never rotated, by the deliver path). Returns null
 * for a missing, non-pending, expired, or unrecoverable (legacy/unsealed) invitation — callers
 * must treat null as "create/rotate instead", never fall back to a fresh send silently.
 */
export async function getInvitationTokenForDelivery(
  db: Database,
  invitationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      tokenSealed: invitations.tokenSealed,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1);
  if (!row || row.status !== "pending") return null;
  if (row.expiresAt !== null && row.expiresAt.getTime() < Date.now()) return null;
  return openToken(row.tokenSealed);
}

export interface InvitationDeliveryContext {
  inviterName: string;
  familyName: string;
  inviteeName: string | null;
  inviteeEmail: string | null;
  inviteePhone: string | null;
}

/** Safe projection for composing a delivery message: inviter + family names and the invitee contacts. */
export async function getInvitationDeliveryContext(
  db: Database,
  invitationId: string,
): Promise<InvitationDeliveryContext | null> {
  const [row] = await db
    .select({
      inviterName: persons.displayName,
      familyName: families.name,
      inviteeName: invitations.inviteeName,
      inviteeEmail: invitations.inviteeEmail,
      inviteePhone: invitations.inviteePhone,
    })
    .from(invitations)
    .innerJoin(families, eq(families.id, invitations.familyId))
    .innerJoin(persons, eq(persons.id, invitations.inviterPersonId))
    .where(eq(invitations.id, invitationId))
    .limit(1);
  if (!row) return null;
  return {
    inviterName: row.inviterName ?? "Someone",
    familyName: row.familyName,
    inviteeName: row.inviteeName,
    inviteeEmail: row.inviteeEmail,
    inviteePhone: row.inviteePhone,
  };
}

/**
 * Record a delivery attempt outcome on the invitation. Increments deliveryAttempts; sets deliveredAt
 * when at least one channel succeeded and/or deliveryError with the failure summary. Idempotent-safe
 * to call once per worker run.
 */
export async function recordInviteDelivery(
  db: Database,
  invitationId: string,
  outcome: { deliveredAt?: Date; deliveryError?: string },
): Promise<void> {
  // Atomic increment (mirrors the `processingAttempt` idiom in story-repository) — no read-then-write
  // race. An UPDATE on a missing invitation is a harmless no-op, so no existence check is needed.
  await db
    .update(invitations)
    .set({
      deliveryAttempts: sql`${invitations.deliveryAttempts} + 1`,
      ...(outcome.deliveredAt !== undefined ? { deliveredAt: outcome.deliveredAt } : {}),
      ...(outcome.deliveryError !== undefined ? { deliveryError: outcome.deliveryError } : {}),
    })
    .where(eq(invitations.id, invitationId));
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
