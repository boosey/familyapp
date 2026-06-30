/**
 * Pending-invite cookie — the bridge that carries an in-flight family invitation ACROSS the Clerk
 * sign-up hop (ADR-0005 + the invitation flow).
 *
 * The problem it solves: an anonymous visitor lands on `/join/[token]`, but accepting requires an
 * authenticated Person. Under Clerk we cannot accept inline — we must hand off to Clerk's hosted
 * sign-up, which round-trips through Clerk and lands back on `/auth/callback`. The invite token (and
 * the relationship label the invitee picked up front) have to survive that hop. They ride in this
 * short-lived, httpOnly cookie rather than a query string — a query string would leak the token via
 * logs / history / Referer (the same reasoning the invite generator uses for its flash cookie).
 *
 * Contract (shared by `/join/[token]` which SETS it and `/auth/callback` which READS + CLEARS it):
 *   - name: `chronicle_pending_invite`
 *   - value: JSON `{ token: string; relationshipLabel?: string }`
 *   - httpOnly, sameSite lax, 30-minute max-age (long enough to finish a Clerk sign-up, short enough
 *     that a stale invite cookie doesn't linger across sessions).
 *
 * `readPendingInvite` is defensive: any malformed / empty / non-string payload resolves to null
 * rather than throwing, so a hand-edited or truncated cookie never breaks the callback.
 */
import "server-only";
import { cookies } from "next/headers";

/** httpOnly cookie name. Value = JSON-encoded {@link PendingInvite}. */
export const PENDING_INVITE_COOKIE = "chronicle_pending_invite";

/** 30 minutes — comfortably covers a Clerk sign-up + email verification, and no longer. */
const PENDING_INVITE_MAX_AGE_SECONDS = 60 * 30;

/**
 * Upper bound on the relationship label read back from the cookie. The label is a client-supplied
 * value that flows into `acceptInvitation` → a membership row; cap it so a hand-crafted cookie can't
 * push an unbounded string into the DB. Generous for any real "daughter-in-law" style label.
 */
const MAX_RELATIONSHIP_LABEL_LENGTH = 200;

export interface PendingInvite {
  /** The raw `/join/[token]` invite token. */
  token: string;
  /** The free-text relationship label the invitee entered up front (optional). */
  relationshipLabel?: string;
}

/** Stash an in-flight invite before handing off to Clerk sign-up. */
export async function setPendingInvite(invite: PendingInvite): Promise<void> {
  const jar = await cookies();
  jar.set(PENDING_INVITE_COOKIE, JSON.stringify(invite), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: PENDING_INVITE_MAX_AGE_SECONDS,
  });
}

/**
 * Read the pending invite, or null if absent / malformed. Never throws — a corrupt cookie degrades
 * to "no pending invite" (the callback then just routes the freshly-provisioned Person normally).
 */
export async function readPendingInvite(): Promise<PendingInvite | null> {
  const jar = await cookies();
  const raw = jar.get(PENDING_INVITE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { token?: unknown }).token !== "string" ||
      (parsed as { token: string }).token.length === 0
    ) {
      return null;
    }
    const token = (parsed as { token: string }).token;
    const rawLabel = (parsed as { relationshipLabel?: unknown }).relationshipLabel;
    const relationshipLabel =
      typeof rawLabel === "string"
        ? rawLabel.slice(0, MAX_RELATIONSHIP_LABEL_LENGTH)
        : undefined;
    return { token, relationshipLabel };
  } catch {
    return null;
  }
}

/** Clear the pending invite (after a successful accept, or to discard a stale one). */
export async function clearPendingInvite(): Promise<void> {
  const jar = await cookies();
  jar.delete(PENDING_INVITE_COOKIE);
}
