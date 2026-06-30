/**
 * Exportable action helper for the Clerk-path branch of /join/[token].
 *
 * Kept in a separate module so `beginClerkJoinAction` can be unit-tested without importing the
 * Next.js App Router page (which pulls in server-component constraints). The page's `beginClerkJoin`
 * server action is a thin wrapper around this function.
 *
 * Flow (ADR-0005): anonymous visitor lands on /join/[token] → collects relationship label up front
 * → stashes {token, relationshipLabel} in the httpOnly pending-invite cookie → redirects to Clerk's
 * hosted sign-up. The /auth/callback Route Handler reads the cookie after Clerk provisioning and
 * calls acceptInvitation(). This module owns only the "stash + redirect" half.
 */
import "server-only";
import { redirect } from "next/navigation";
import { setPendingInvite } from "./pending-invite";

/**
 * Stash the in-flight invite in the `chronicle_pending_invite` cookie and redirect the visitor
 * into Clerk's hosted sign-up page.
 *
 * @param token           The raw invite token from the /join/[token] URL.
 * @param relationshipLabel  The free-text relationship label the invitee entered (optional).
 */
export async function beginClerkJoinAction(
  token: string,
  relationshipLabel: string | undefined,
): Promise<void> {
  await setPendingInvite({ token, relationshipLabel });
  redirect("/sign-up");
}
