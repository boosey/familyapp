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
import type {
  Database,
  InvitationStatus,
  InviteRelationship,
  MembershipRole,
} from "@chronicle/db";
import {
  AlreadyFamilyMemberError,
  AuthorizationError,
  InvariantViolation,
  ThrottleError,
} from "./errors";
import { findActiveFamilyMemberByContact } from "./invite-member-guard";
import { placeInvitedMemberOnAccept } from "./kinship-write";
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
  /**
   * Structured, machine-readable relationship (#164, ADR-0023) — the PLACEMENT signal. On acceptance
   * a direct primitive (`wife`/`husband`/`mother`/`father`/`son`/`daughter`) auto-creates the matching
   * kinship edge and sets the invitee's sex; `other` records "no auto-edge" (unplaced, handled by
   * #161). Absent leaves the invite with no placement signal — `relationshipLabel` stays display-only.
   */
  relationship?: InviteRelationship;
  role?: MembershipRole;
  /** Time to live in ms. Defaults to 14 days. */
  ttlMs?: number;
  /**
   * Person-bound Invitation (issue #333, ADR-0028): binds the invitation to this EXISTING Person
   * on create instead of minting a fresh provisional one — the Dedup-on-invite guarantee extended
   * beyond cold contact matching to an invite started from an existing List/Tree Person. The Person
   * must be identified and living; create refuses (`InvariantViolation`) otherwise, or if it does
   * not exist. Create also refuses (`AlreadyFamilyMemberError`) when this Person already holds an
   * ACTIVE membership in `familyId`. Omitted => the ADR-0006 cold path (mints a provisional Person)
   * runs unchanged.
   */
  existingInviteePersonId?: string;
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

    // Person-bound Invitation (#333, ADR-0028): resolve + validate the existing Person up front —
    // before any throttle counting, mirroring the placement of the contact-based already-member
    // refusal below (a refused invite must never burn the inviter's generous throttle budget).
    let boundPerson: { id: string; displayName: string | null } | null = null;
    if (input.existingInviteePersonId) {
      const [person] = await tx
        .select({
          id: persons.id,
          displayName: persons.displayName,
          identified: persons.identified,
          lifeStatus: persons.lifeStatus,
        })
        .from(persons)
        .where(eq(persons.id, input.existingInviteePersonId))
        .limit(1);
      if (!person) {
        throw new InvariantViolation(
          `person-bound invitation target ${input.existingInviteePersonId} does not exist`,
        );
      }
      if (!person.identified || person.lifeStatus !== "living") {
        throw new InvariantViolation(
          "person-bound invitation requires an identified, living person",
        );
      }
      // Same-family duplicate-member guard, direct form (#119/#333): a precise personId+familyId
      // check, stronger than (and in place of) the contact-based guard below for this path.
      if (await isActiveMember(tx, person.id, input.familyId)) {
        throw new AlreadyFamilyMemberError(
          `${person.displayName ?? "this person"} is already an active member of this family`,
        );
      }
      boundPerson = { id: person.id, displayName: person.displayName };
    }

    // Invite-send throttle (issue #105) — a GENEROUS accident guard, not a rate-limit against
    // determined abuse. Two independent arms, each a rolling window counted over the invitations
    // table. Dedup (#117) refreshes one row in place instead of inserting per send, so the count
    // sums `sendCount` (1 on create, +1 per refresh) rather than rows — every (re)send counts:
    //   1. Per INVITER: caps a bulk-paste/scripting accident (a whole spreadsheet's worth of
    //      invites in one sitting) across all families the inviter belongs to.
    //   2. Per DESTINATION (email OR phone): protects the RECIPIENT from being spammed — app-wide,
    //      so it holds even when different inviters (or families) address the same person.
    // Both run inside the creation tx so a burst of concurrent submissions sees one consistent
    // count. Exceeding either arm refuses the invite with ThrottleError; nothing is written.
    const trimmedName = input.inviteeName?.trim() || null;
    const trimmedEmail = input.inviteeEmail?.trim() || null;
    const trimmedPhone = input.inviteePhone?.trim() || null;

    // Same-family duplicate-member guard (issue #119): if the invitee's email or phone already
    // resolves to an ACTIVE member of this family (via their verified account contacts), inviting
    // them is a mistake — refuse before any throttle counting or dedup refresh. Runs before the
    // throttle so a refused invite never burns the inviter's generous budget. Skipped for the
    // person-bound path (#333) — the direct personId+familyId check above already covers it more
    // precisely, and the bound Person may itself legitimately hold the matching contact.
    if (!boundPerson) {
      const conflictingMember = await findActiveFamilyMemberByContact(tx, {
        familyId: input.familyId,
        email: trimmedEmail,
        phone: trimmedPhone,
      });
      if (conflictingMember) {
        throw new AlreadyFamilyMemberError(
          `${conflictingMember.displayName ?? "this person"} is already an active member of this family (matched on ${conflictingMember.matchedOn})`,
        );
      }
    }

    const inviterWindowStart = new Date(
      Date.now() - INVITE_THROTTLE_INVITER_WINDOW_MS,
    );
    const [inviterCount] = await tx
      .select({ n: sql<number>`coalesce(sum(${invitations.sendCount}), 0)::int` })
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
        .select({ n: sql<number>`coalesce(sum(${invitations.sendCount}), 0)::int` })
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

    // Person-bound create (#333, ADR-0028): skip the provisional-mint path entirely — anchor
    // directly on the existing Person. If a live-or-dead pending invite already targets this exact
    // (family, Person) pair, refresh it in place (mirrors the cold path's one-durable-link and
    // refresh-in-place rules) instead of inserting a second row for the same invitee.
    if (boundPerson) {
      const [existingBound] = await tx
        .select({
          id: invitations.id,
          tokenSealed: invitations.tokenSealed,
          status: invitations.status,
          expiresAt: invitations.expiresAt,
        })
        .from(invitations)
        .where(
          and(
            eq(invitations.familyId, input.familyId),
            eq(invitations.inviteePersonId, boundPerson.id),
            ne(invitations.status, "accepted"),
          ),
        )
        .orderBy(desc(invitations.createdAt))
        .limit(1);

      const isLive =
        existingBound !== undefined &&
        existingBound.status === "pending" &&
        (existingBound.expiresAt === null ||
          existingBound.expiresAt.getTime() > Date.now());

      if (existingBound) {
        // Recover the durable token for a live invite; null forces rotation (dead invite, or a
        // legacy row with nothing sealed under the active key) — same rule as the cold path (#116).
        const durableToken = isLive ? openToken(existingBound.tokenSealed) : null;
        await tx
          .update(invitations)
          .set({
            inviterPersonId: input.inviterPersonId,
            createdAt: new Date(),
            sendCount: sql`${invitations.sendCount} + 1`,
            ...(durableToken === null
              ? {
                  tokenHash: hashToken(token),
                  tokenSealed: sealToken(token),
                  status: "pending" as const,
                  expiresAt,
                }
              : {}),
            ...(input.inviteeName !== undefined
              ? { inviteeName: input.inviteeName ?? null }
              : {}),
            ...(input.inviteeEmail !== undefined
              ? { inviteeEmail: trimmedEmail }
              : {}),
            ...(input.inviteePhone !== undefined
              ? { inviteePhone: trimmedPhone }
              : {}),
            ...(input.deliveryChannels !== undefined
              ? { deliveryChannels: input.deliveryChannels ?? null }
              : {}),
            ...(input.relationshipLabel !== undefined
              ? { relationshipLabel: input.relationshipLabel ?? null }
              : {}),
            ...(input.relationship !== undefined
              ? { inviteRelationship: input.relationship ?? null }
              : {}),
            ...(input.role !== undefined ? { role: input.role } : {}),
          })
          .where(eq(invitations.id, existingBound.id));

        return {
          invitationId: existingBound.id,
          token: durableToken ?? token,
          inviteePersonId: boundPerson.id,
        };
      }

      // No pending invite yet for this (family, Person) pair — insert one anchored directly on the
      // existing Person. Prefill the invitee name from the Person's displayName when the caller
      // supplied none, so the delivery/welcome copy always has a name to show.
      const [row] = await tx
        .insert(invitations)
        .values({
          tokenHash: hashToken(token),
          tokenSealed: sealToken(token),
          familyId: input.familyId,
          inviterPersonId: input.inviterPersonId,
          inviteePersonId: boundPerson.id,
          inviteeName: input.inviteeName ?? boundPerson.displayName ?? null,
          inviteeEmail: trimmedEmail,
          inviteePhone: trimmedPhone,
          deliveryChannels: input.deliveryChannels ?? null,
          relationshipLabel: input.relationshipLabel ?? null,
          inviteRelationship: input.relationship ?? null,
          role: input.role ?? "member",
          status: "pending",
          expiresAt,
        })
        .returning({ id: invitations.id });

      return { invitationId: row!.id, token, inviteePersonId: boundPerson.id };
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
    // Match key: the invitee's EMAIL (case-insensitive) OR PHONE (exact — the web layer normalizes
    // to E.164 before create). Both are reliable contact identities; matching on either dedups the
    // re-invite. Invites with NEITHER identifier are deliberately NOT deduped: matching on name
    // alone would risk silently merging two different real people who share a name (e.g. two
    // cousins both entered as "Sal") with no undo — a worse failure than the duplicate row we are
    // fixing. Such repeat invites simply mint a fresh provisional Person, which the reaper cleans
    // up when it dies. `accepted` invites are excluded: their anchor is a real Account Person, not
    // a reusable provisional. The persons join re-asserts that.
    const matchClauses = [
      trimmedEmail
        ? sql`lower(${invitations.inviteeEmail}) = ${trimmedEmail.toLowerCase()}`
        : null,
      trimmedPhone ? eq(invitations.inviteePhone, trimmedPhone) : null,
    ].filter((c) => c !== null);

    if (matchClauses.length > 0) {
      // Match sets are tiny (one row per invitee identifier in one family) — no limit, so legacy
      // duplicate rows are all seen and the merge loop below can clean up every dead loser.
      const matches = await tx
        .select({
          id: invitations.id,
          inviteePersonId: invitations.inviteePersonId,
          inviteeEmail: invitations.inviteeEmail,
          inviteePhone: invitations.inviteePhone,
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
            or(...matchClauses),
          ),
        )
        .orderBy(desc(invitations.createdAt));

      // The winner carries the combined identifiers forward. Winner selection prefers a LIVE match
      // (pending + unexpired) so a merge never kills an invite whose link was already delivered
      // (#116's durable-link promise): live email match, else the first live match, else a dead
      // email match (email is the stronger identity, #117), else the most recent match.
      const isLiveMatch = (m: (typeof matches)[number]): boolean =>
        m.status === "pending" &&
        (m.expiresAt === null || m.expiresAt.getTime() > Date.now());
      const emailMatch = trimmedEmail
        ? matches.find(
            (m) => m.inviteeEmail?.toLowerCase() === trimmedEmail.toLowerCase(),
          )
        : undefined;
      const existing =
        (emailMatch && isLiveMatch(emailMatch) ? emailMatch : undefined) ??
        matches.find(isLiveMatch) ??
        emailMatch ??
        matches[0];

      if (existing) {
        // Merge-on-collision (#117): the other identifier matched a DIFFERENT provisional Person.
        // Re-point the loser's queued asks onto the winner, delete the loser's invitation rows
        // (one invite row per invitee — the reaper invariant above), then delete the now-empty
        // loser Person. Mirrors acceptInvitation's re-point+delete primitive.
        const losers = matches.filter(
          (m) => m.inviteePersonId !== existing.inviteePersonId,
        );
        for (const loser of losers) {
          // A LIVE loser is NEVER merged away: its link may already have been delivered, and
          // deleting the row would 404 a working link (#116). It keeps its row/Person/token — the
          // duplicate self-heals when that invite expires and a later re-invite merges it as a
          // dead loser.
          if (isLiveMatch(loser)) continue;
          const [loserPerson] = await tx
            .select({ accountId: persons.accountId })
            .from(persons)
            .where(eq(persons.id, loser.inviteePersonId))
            .limit(1);
          if (!loserPerson || loserPerson.accountId !== null) {
            // The match join guarantees an Account-less provisional; anything else signals a
            // corrupted anchor we must not silently delete (same guard as acceptInvitation).
            throw new InvariantViolation(
              "merge-on-collision: loser invitee anchor is missing or Account-bearing — refusing to merge",
            );
          }
          await tx
            .update(asks)
            .set({ targetPersonId: existing.inviteePersonId })
            .where(eq(asks.targetPersonId, loser.inviteePersonId));
          await tx
            .delete(invitations)
            .where(eq(invitations.inviteePersonId, loser.inviteePersonId));
          await tx.delete(persons).where(eq(persons.id, loser.inviteePersonId));
        }

        // Recover the durable token for a live invite; null forces the rotation path (dead invite,
        // or a legacy row with nothing sealed under the active key).
        const durableToken = isLiveMatch(existing)
          ? openToken(existing.tokenSealed)
          : null;

        await tx
          .update(invitations)
          .set({
            inviterPersonId: input.inviterPersonId,
            // A refresh IS a re-send: `createdAt` on a refreshed invite means "last (re)sent at",
            // keeping the row inside the rolling throttle window, and sendCount accumulates each
            // (re)send so both #105 throttle arms count it (rows ≈ sends survives dedup).
            createdAt: new Date(),
            sendCount: sql`${invitations.sendCount} + 1`,
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
            // not wipe a name/label/role captured on the original. The surviving invite ends up
            // carrying the FULL identifier set entered this time (#117). Contacts are stored in
            // their TRIMMED form (the same form used as the match key), never verbatim.
            ...(input.inviteeName !== undefined
              ? { inviteeName: input.inviteeName ?? null }
              : {}),
            ...(input.inviteeEmail !== undefined
              ? { inviteeEmail: trimmedEmail }
              : {}),
            ...(input.inviteePhone !== undefined
              ? { inviteePhone: trimmedPhone }
              : {}),
            ...(input.deliveryChannels !== undefined
              ? { deliveryChannels: input.deliveryChannels ?? null }
              : {}),
            ...(input.relationshipLabel !== undefined
              ? { relationshipLabel: input.relationshipLabel ?? null }
              : {}),
            ...(input.relationship !== undefined
              ? { inviteRelationship: input.relationship ?? null }
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
        // Store contacts in their TRIMMED form — the same form the dedup/throttle match keys use,
        // so a later re-invite matches this row exactly.
        inviteeEmail: trimmedEmail,
        inviteePhone: trimmedPhone,
        deliveryChannels: input.deliveryChannels ?? null,
        relationshipLabel: input.relationshipLabel ?? null,
        inviteRelationship: input.relationship ?? null,
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
        inviterPersonId: invitations.inviterPersonId,
        inviteRelationship: invitations.inviteRelationship,
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

    // #164 (ADR-0023): auto-place the new member on the family tree from the invite's STRUCTURED
    // relationship — the exact fact the inviter supplied, no longer discarded (the production
    // incident this prevents). Only the six DIRECT primitives place an edge here; `other` and a
    // nullish relationship write nothing (the member is left unplaced for #161, never guessed). The
    // edge is a normal `asserted` edge, actor = the inviter, subject to the same hide/steward overlay.
    // Runs on the REAL accepting Person (the provisional is already merged away) inside this tx.
    if (
      invite.inviteRelationship !== null &&
      invite.inviteRelationship !== "other"
    ) {
      await placeInvitedMemberOnAccept(tx, {
        familyId: invite.familyId,
        inviterPersonId: invite.inviterPersonId,
        inviteePersonId: input.acceptedPersonId,
        relationship: invite.inviteRelationship,
      });
    }

    return { membershipId, familyId: invite.familyId };
  });
}
