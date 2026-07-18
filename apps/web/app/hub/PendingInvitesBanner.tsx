/**
 * Pending-invite confirm cards (issue #120) — shown at the top of the hub when the viewer's
 * VERIFIED contacts match a live pending invitation. Explicit confirm only: "Join" runs the
 * standard accept merge; "Not me" dismisses per-account without revoking the invite. One card
 * per match (a person can be invited to several families at once). Server component — the
 * buttons post straight to server actions.
 */
import type { PendingInvitationMatch } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { KindredButton } from "@/app/_kindred";
import { dismissPendingInvite, joinPendingInvite } from "./pending-invites-actions";

export function PendingInvitesBanner({
  matches,
}: {
  matches: PendingInvitationMatch[];
}) {
  if (matches.length === 0) return null;
  return (
    <div
      role="status"
      aria-label={hub.pendingInvites.aria}
      style={{
        marginBottom: 28,
        display: "grid",
        gap: 16,
      }}
    >
      {matches.map((m) => (
        <div
          key={m.invitationId}
          style={{
            background: "var(--surface-card)",
            border: "var(--border-width) solid var(--accent)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-card)",
            padding: "20px 24px",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              color: "var(--text-body)",
              margin: "0 0 6px",
            }}
          >
            {hub.pendingInvites.cardLine(m.inviterName, m.familyName)}
          </p>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-meta)",
              margin: "0 0 16px",
            }}
          >
            {hub.pendingInvites.blurb}
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <form action={joinPendingInvite}>
              <input type="hidden" name="invitationId" value={m.invitationId} />
              <KindredButton type="submit" label={hub.pendingInvites.join} />
            </form>
            <form action={dismissPendingInvite}>
              <input type="hidden" name="invitationId" value={m.invitationId} />
              <button
                type="submit"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  color: "var(--text-muted)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                {hub.pendingInvites.notMe}
              </button>
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}
