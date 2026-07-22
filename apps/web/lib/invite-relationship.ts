/**
 * Shared invite-relationship parsing (#164, ADR-0023) — narrows an arbitrary submitted form value to
 * the fixed relationship vocabulary read straight off the Drizzle enum, so the guard can never drift
 * from the schema when a value is added. Anything unrecognized falls back to `"other"` — the safe
 * no-auto-placement outcome, never a guessed edge.
 *
 * Extracted out of `InviteTab.tsx` (the cold Invite tab's member-invite action) so the person-bound
 * Invite modal's server action (#334) shares the exact same rule instead of re-implementing it.
 */
import type { InviteRelationship } from "@chronicle/db";
import { inviteRelationshipEnum } from "@chronicle/db/schema";

export function parseInviteRelationship(raw: string): InviteRelationship {
  return (inviteRelationshipEnum.enumValues as readonly string[]).includes(raw)
    ? (raw as InviteRelationship)
    : "other";
}
