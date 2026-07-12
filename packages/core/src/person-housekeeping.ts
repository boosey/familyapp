/**
 * Provisional-Person housekeeping — the invitee reaper (ADR-0016).
 *
 * An invitation mints an Account-less provisional Person up front to anchor it (ADR-0006,
 * `origin = 'invitee'`). On acceptance that provisional row is MERGED into the accepting Person and
 * deleted (see `acceptInvitation`). The ones that are never accepted linger; this reaper collects
 * them once their invitation is terminally dead (revoked, expired, or pending-past-expiry).
 *
 * The load-bearing rule (ADR-0016): the reaper keys off `origin = 'invitee'` and NEVER touches a
 * `mention`. A `mention` is a named-as-kin Person — a deceased ancestor or a deliberately anonymous
 * structural bridge node — and must persist forever even though it, too, is Account-less and
 * name-optional. Origin is the discriminator precisely so an accountless bridge is never mistaken
 * for an abandoned invite.
 */
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { askFamilies, asks, invitations, persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";

export interface ReapResult {
  /** Ids of the provisional invitee Persons deleted this run (empty when nothing was reapable). */
  reapedPersonIds: string[];
}

/**
 * Delete every provisional invitee Person whose invitation was never accepted and is now dead.
 * A `mention` (identified or placeholder) and a `self` are never candidates — the `origin` filter
 * is the guard. Runs in a single transaction: stale queued Asks and the anchoring invitation rows
 * are removed first (FK order), then the Persons.
 *
 * @param now clock for the pending-past-expiry check (injectable for tests); defaults to real time.
 */
export async function reapUnacceptedInvitees(
  db: Database,
  now: Date = new Date(),
): Promise<ReapResult> {
  return db.transaction(async (tx) => {
    // Candidate anchors: dead, never-accepted invitations whose invitee Person is `origin='invitee'`
    // and still Account-less. `mention`/`self` are excluded by the origin filter — the whole point.
    const deadInvites = await tx
      .select({ personId: invitations.inviteePersonId })
      .from(invitations)
      .innerJoin(persons, eq(persons.id, invitations.inviteePersonId))
      .where(
        and(
          eq(persons.origin, "invitee"),
          isNull(persons.accountId), // never converted into a real account
          ne(invitations.status, "accepted"),
          or(
            inArray(invitations.status, ["revoked", "expired"]),
            lt(invitations.expiresAt, now), // pending but past its TTL (expiry is applied lazily)
          ),
        ),
      );
    const candidateIds = [...new Set(deadInvites.map((r) => r.personId))];
    if (candidateIds.length === 0) return { reapedPersonIds: [] };

    // Defensive: never reap a Person that ALSO carries an accepted invitation. Acceptance deletes
    // the provisional anchor, so this set should be empty — but a corrupted anchor must not be reaped.
    const accepted = await tx
      .select({ personId: invitations.inviteePersonId })
      .from(invitations)
      .where(
        and(
          inArray(invitations.inviteePersonId, candidateIds),
          eq(invitations.status, "accepted"),
        ),
      );
    const acceptedIds = new Set(accepted.map((r) => r.personId));
    const reapIds = candidateIds.filter((id) => !acceptedIds.has(id));
    if (reapIds.length === 0) return { reapedPersonIds: [] };

    // Discard Asks anchored to a reaped provisional Person. On non-acceptance the invite never
    // converted, so any Asks queued to/from that anchor are stale (ADR-0006 only re-points them on
    // acceptance). Delete their ask_families join rows first (FK), then the asks, then the
    // invitations (FK to persons), then the persons themselves.
    const doomedAsks = await tx
      .select({ id: asks.id })
      .from(asks)
      .where(
        or(
          inArray(asks.targetPersonId, reapIds),
          inArray(asks.askerPersonId, reapIds),
        ),
      );
    const doomedAskIds = doomedAsks.map((r) => r.id);
    if (doomedAskIds.length > 0) {
      await tx.delete(askFamilies).where(inArray(askFamilies.askId, doomedAskIds));
      await tx.delete(asks).where(inArray(asks.id, doomedAskIds));
    }
    await tx.delete(invitations).where(inArray(invitations.inviteePersonId, reapIds));
    await tx.delete(persons).where(inArray(persons.id, reapIds));
    return { reapedPersonIds: reapIds };
  });
}
