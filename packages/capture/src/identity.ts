/**
 * Identity resolution for the capture orchestrator (ADR-0003).
 *
 * Translates a CaptureActor into the resolved { personId } that the
 * storage-first capture path needs — the ONLY divergence between the
 * link-session and in-hub account flows.
 */
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import type { CaptureActor } from "./capture";
import { InvalidSessionError } from "./capture";
import { resolveLinkSession } from "./sessions";

/**
 * Resolve a CaptureActor to the owning Person id, or throw InvalidSessionError.
 *
 * ## link_session
 * Hashes the raw token, looks it up in link_sessions, and rejects anything
 * unknown, expired, or revoked — identical to the pre-ADR-0003 path.
 *
 * ## account
 * The web auth layer (Clerk cookie → middleware) has ALREADY authenticated
 * this person BEFORE the API route calls capture.  Capture trusts the
 * personId directly — it never re-authenticates a cookie or verifies a JWT.
 *
 * We still do one lightweight existence check (SELECT id FROM persons) to
 * reject a phantom personId (e.g. a stale id in a manually-crafted request
 * that bypassed the auth middleware, or a race against account deletion).
 * Persisting a draft for a non-existent person would violate the foreign key
 * and confuse the ownership model, so we fail-fast here with the same
 * InvalidSessionError rather than letting it propagate as a cryptic FK error.
 */
export async function resolveCaptureActor(
  db: Database,
  actor: CaptureActor,
  opts?: { now?: Date },
): Promise<{ personId: string; originatingFamilyId: string | null }> {
  if (actor.kind === "link_session") {
    const resolved = await resolveLinkSession(db, actor.token, opts);
    if (!resolved) throw new InvalidSessionError();
    // The link session is scoped to one family (NOT NULL) — that is the originating family context
    // the recording is captured FOR, threaded onto the draft story so approval can default-target
    // it (ADR-0010).
    return { personId: resolved.personId, originatingFamilyId: resolved.familyId };
  }

  // account branch: trust the personId (auth happened upstream) but reject phantoms. The in-hub
  // account flow carries no session family, so there is no originating family context here.
  const [row] = await db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.id, actor.personId))
    .limit(1);
  if (!row) throw new InvalidSessionError();
  return { personId: actor.personId, originatingFamilyId: null };
}
