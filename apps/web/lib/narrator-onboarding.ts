/**
 * Narrator onboarding (issue #79) — the testable core of the Invite tab's "Invite a narrator to
 * record" action. A logged-in relative DESIGNATES an existing active member as the family's narrator
 * and mints the login-free `/s/[token]` capture link in one atomic step.
 *
 * Why a helper and not inline in the server action: the action itself is bound to `redirect()` +
 * flash cookies (untestable in isolation). This function is the pure domain wiring — it takes `db`
 * explicitly so the #79 regression test can drive it against PGlite, and the action is a thin shell
 * that resolves auth + runtime and calls it.
 *
 * Ordering + atomicity (load-bearing): everything runs in ONE transaction, inviter-gate FIRST.
 *   (1) the inviter must be an active member of the family (else nothing happens — no role change,
 *       no link). This mirrors createLinkSession's own gate, but we assert it up front so a failed
 *       gate never leaves a dangling role promotion.
 *   (2) designate the narrator (core.designateNarrator) — promotes the narrator's ACTIVE membership
 *       to role=narrator; itself rejects a non-member, so a bad narrator target rolls the tx back.
 *   (3) mint the link session (capture.createLinkSession) — re-checks both gates transactionally.
 * A throw anywhere rolls back the whole thing: no half-applied designation, no orphan link.
 */
import "server-only";
import { createLinkSession } from "@chronicle/capture";
import { AuthorizationError, designateNarrator, isActiveMember } from "@chronicle/core";
import type { Database } from "@chronicle/db";

export interface DesignateAndCreateNarratorLinkInput {
  /** The logged-in relative minting the link (must be an active member of `familyId`). */
  inviterPersonId: string;
  /** The person being set up as narrator (must already be an active member of `familyId`). */
  narratorPersonId: string;
  familyId: string;
}

export interface NarratorLinkResult {
  /** The raw session token — returned ONCE, to be embedded in the `/s/[token]` link. Never stored raw. */
  token: string;
}

export async function designateAndCreateNarratorLink(
  db: Database,
  input: DesignateAndCreateNarratorLinkInput,
): Promise<NarratorLinkResult> {
  return db.transaction(async (tx) => {
    // (1) Gate FIRST on the inviter, before any mutation — a non-member relative changes nothing.
    if (!(await isActiveMember(tx, input.inviterPersonId, input.familyId))) {
      throw new AuthorizationError(
        "only an active member of the family may set up a narrator",
      );
    }
    // (2) Designate — promotes the narrator's active membership to role=narrator (idempotent; throws
    //     AuthorizationError if the narrator is not an active member, rolling back the transaction).
    await designateNarrator(tx as unknown as Database, {
      personId: input.narratorPersonId,
      familyId: input.familyId,
    });
    // (3) Mint the login-free capture link (createLinkSession re-checks both membership gates).
    const { token } = await createLinkSession(tx as unknown as Database, {
      personId: input.narratorPersonId,
      familyId: input.familyId,
      invitedByPersonId: input.inviterPersonId,
    });
    return { token };
  });
}
