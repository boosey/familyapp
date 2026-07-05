/**
 * Requests tab — the steward's side of ask #2. Lists PENDING join requests across every family this
 * Person stewards (Decline / Approve while pending), plus recently-DECIDED requests rendered in
 * place with a mono APPROVED/DECLINED status so a row doesn't just vanish the moment it's decided.
 * Approve creates the requester's active membership (core handles it); Decline marks it declined.
 * Both server actions redirect back to this tab so the list refreshes.
 */
import { redirect } from "next/navigation";
import {
  approveJoinRequest,
  declineJoinRequest,
  listDecidedJoinRequestsForSteward,
  listPendingJoinRequestsForSteward,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { requestsInScope } from "@/lib/hub-tabs";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";

async function approve(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
  const joinRequestId = String(formData.get("joinRequestId") ?? "");
  if (joinRequestId) {
    await approveJoinRequest(db, { joinRequestId, deciderPersonId: ctx.personId });
  }
  redirect("/hub?tab=requests");
}

async function decline(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
  const joinRequestId = String(formData.get("joinRequestId") ?? "");
  if (joinRequestId) {
    await declineJoinRequest(db, { joinRequestId, deciderPersonId: ctx.personId });
  }
  redirect("/hub?tab=requests");
}

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

export async function RequestsTab({ scope = "all" }: { scope?: string } = {}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return (
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-muted)",
        }}
      >
        {hub.requests.signedOut}
      </p>
    );
  }

  const [allPending, allDecided] = await Promise.all([
    listPendingJoinRequestsForSteward(db, ctx.personId),
    listDecidedJoinRequestsForSteward(db, ctx.personId),
  ]);
  // Honor the hub scope (Task 4.5): "all" aggregates across every family the steward stewards (each
  // row is labeled with its family name below); a family scope narrows to that family's requests. The
  // scope is already validated upstream against the viewer's own families.
  const pending = requestsInScope(allPending, scope);
  const decided = requestsInScope(allDecided, scope);

  const heading = (
    <>
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: 0,
        }}
      >
        {hub.requests.title}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          lineHeight: "var(--leading-body)",
          color: "var(--text-muted)",
          margin: "12px 0 0",
        }}
      >
        {hub.requests.intro}
      </p>
    </>
  );

  if (pending.length === 0 && decided.length === 0) {
    return (
      <div>
        {heading}
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
      </div>
    );
  }

  return (
    <div>
      {heading}
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
                {(approved ? hub.requests.statusApproved : hub.requests.statusDeclined).toUpperCase()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
