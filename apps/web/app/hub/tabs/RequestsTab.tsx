/**
 * Requests tab — the steward's side of ask #2. Lists pending join requests across every family this
 * Person stewards; Approve creates the requester's active membership (core handles it), Decline
 * marks it declined. Both server actions redirect back to this tab so the list refreshes.
 */
import { redirect } from "next/navigation";
import {
  approveJoinRequest,
  declineJoinRequest,
  listPendingJoinRequestsForSteward,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
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

export async function RequestsTab() {
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

  const requests = await listPendingJoinRequestsForSteward(db, ctx.personId);

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

  if (requests.length === 0) {
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
        {requests.map((r) => (
          <li
            key={r.joinRequestId}
            style={{
              background: "var(--surface-card)",
              border: "var(--border-width) solid var(--border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-card)",
              padding: "20px 24px",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-label)",
                letterSpacing: "var(--tracking-mono)",
                color: "var(--support)",
                marginBottom: 6,
              }}
            >
              {r.familyName.toUpperCase()}
            </div>
            <div
              style={{
                fontFamily: "var(--font-story)",
                fontSize: "var(--text-story)",
                color: "var(--text-body)",
              }}
            >
              {r.requesterName}
            </div>
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
            <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
              <form action={approve}>
                <input type="hidden" name="joinRequestId" value={r.joinRequestId} />
                <KindredButton type="submit" label={hub.requests.approve} size="small" />
              </form>
              <form action={decline}>
                <input type="hidden" name="joinRequestId" value={r.joinRequestId} />
                <KindredButton type="submit" label={hub.requests.decline} variant="ghost" size="small" />
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
