/**
 * RequestsList — the presentational list of steward join-requests (pending rows with Decline/Approve,
 * plus recently-decided rows shown in place with a mono APPROVED/DECLINED status so a row doesn't
 * vanish the instant it's decided).
 *
 * Pure presentation: the rows are already fetched, already authorized, and already SCOPED to the
 * selected family by the server (RequestsTab) via `?families=` (#159 — the Requests surface now shares
 * the URL-driven family selector, so this component holds no state and no chip bar). The approve/decline
 * Server Actions are passed straight through to `<form action={…}>`.
 */
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";

export interface RequestRow {
  joinRequestId: string;
  familyId: string;
  familyName: string;
  requesterName: string;
  message: string | null;
  status: string;
  /** #352: this (approved) row was auto-approved off a matching invitation — label it distinctly. */
  viaInvitation?: boolean;
}

interface RequestsListProps {
  pending: RequestRow[];
  decided: RequestRow[];
  approve: (formData: FormData) => Promise<void>;
  decline: (formData: FormData) => Promise<void>;
}

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 20,
  background: "var(--surface-card)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-card)",
  padding: "20px 24px",
} as const;

const familyLabelStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  letterSpacing: "var(--tracking-mono)",
  color: "var(--support)",
  marginBottom: 4,
} as const;

const nameStyle = {
  fontFamily: "var(--font-story)",
  fontSize: "var(--text-story)",
  color: "var(--text-body)",
} as const;

/** First letter of the requester's name, for the avatar circle. */
function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "0 0 auto",
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "var(--accent-soft)",
        color: "var(--accent-strong)",
        fontFamily: "var(--font-story)",
        fontSize: "var(--text-story)",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {initialOf(name)}
    </span>
  );
}

export function RequestsList({ pending, decided, approve, decline }: RequestsListProps) {
  if (pending.length === 0 && decided.length === 0) {
    return (
      <div
        style={{
          marginTop: 24,
          background: "var(--surface-card)",
          border: "var(--border-width) solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 30,
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story)",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          {hub.requests.empty}
        </p>
      </div>
    );
  }

  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: "24px 0 0",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {pending.map((r) => (
        <li key={r.joinRequestId} style={rowStyle}>
          <Avatar name={r.requesterName} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={familyLabelStyle}>{r.familyName.toUpperCase()}</div>
            <div style={nameStyle}>{r.requesterName}</div>
            {r.message ? (
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  color: "var(--text-meta)",
                  lineHeight: "var(--leading-body)",
                  margin: "8px 0 0",
                }}
              >
                “{r.message}”
              </p>
            ) : null}
          </div>
          {/* Decline (ghost) before Approve (primary), per design. */}
          <div style={{ display: "flex", gap: 10, flex: "0 0 auto" }}>
            <form action={decline}>
              <input type="hidden" name="joinRequestId" value={r.joinRequestId} />
              <KindredButton
                type="submit"
                label={hub.requests.decline}
                variant="ghost"
                size="small"
              />
            </form>
            <form action={approve}>
              <input type="hidden" name="joinRequestId" value={r.joinRequestId} />
              <KindredButton type="submit" label={hub.requests.approve} size="small" />
            </form>
          </div>
        </li>
      ))}

      {decided.map((r) => {
        const approved = r.status === "approved";
        return (
          <li key={r.joinRequestId} style={rowStyle}>
            <Avatar name={r.requesterName} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={familyLabelStyle}>{r.familyName.toUpperCase()}</div>
              <div style={nameStyle}>{r.requesterName}</div>
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-label)",
                letterSpacing: "var(--tracking-mono)",
                textTransform: "uppercase",
                color: approved ? "var(--accent-strong)" : "var(--support)",
                flex: "0 0 auto",
              }}
            >
              {(approved
                ? r.viaInvitation
                  ? hub.requests.statusApprovedByInvitation
                  : hub.requests.statusApproved
                : hub.requests.statusDeclined
              ).toUpperCase()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
