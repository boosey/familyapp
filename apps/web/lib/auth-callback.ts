/**
 * Pure helpers for the /auth/callback route handler — factored out so they can be
 * unit-tested without Next.js request context or Clerk network calls.
 *
 * `appendInviteParam` is a fully pure string function.
 * `resolveCallbackDestination` accepts a DB + the already-read invite (cookie read/clear
 * stay in the route handler) so tests can drive it with a PGlite instance.
 */
import "server-only";
import { acceptInvitation } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type { PendingInvite } from "./pending-invite";
import { resolvePostAuthRoute } from "./post-auth-route";

/**
 * Append `?from=invite` to a destination path, or `&from=invite` if the path already
 * carries a query string (e.g. `/hub?tab=stories` → `/hub?tab=stories&from=invite`).
 */
export function appendInviteParam(dest: string): string {
  return dest.includes("?") ? `${dest}&from=invite` : `${dest}?from=invite`;
}

/**
 * Apply a pending invite (if any) and resolve the final destination path.
 *
 * A stale, expired, or already-used invite must NOT block the landing — errors from
 * `acceptInvitation` are logged and swallowed so the freshly-provisioned user is never
 * turned away because their invite token was already consumed by a prior attempt.
 *
 * Returns the path from `resolvePostAuthRoute` with `?from=invite` (or `&from=invite`)
 * appended when an invite was actually accepted, or the bare path otherwise.
 */
export async function resolveCallbackDestination(
  db: Database,
  personId: string,
  invite: PendingInvite | null,
): Promise<string> {
  let inviteApplied = false;

  if (invite) {
    try {
      await acceptInvitation(db, {
        token: invite.token,
        acceptedPersonId: personId,
        relationshipLabel: invite.relationshipLabel ?? undefined,
      });
      inviteApplied = true;
    } catch (err) {
      // Stale / used / expired invite — log and continue. The user lands normally.
      console.warn("[auth/callback] pending invite could not be accepted (stale?); ignored:", err);
    }
  }

  const dest = await resolvePostAuthRoute(db, personId);
  return inviteApplied ? appendInviteParam(dest) : dest;
}
