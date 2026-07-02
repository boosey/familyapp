/**
 * /families/find — browse & search discoverable families and ask to join (ask #2, requester side).
 *
 * The discoverable families are loaded server-side (name + steward only — the leak-safe discovery
 * contract) and handed to the client <FamilyFinder>, which lists them by default and filters live.
 * "Request to join" calls createJoinRequest; its guards (not discoverable / already a member /
 * duplicate pending) surface as a friendly inline error. On success we land on a dedicated
 * "request sent" confirmation that names the steward + family the request is waiting on.
 * The requester's own pending/decided requests are listed below so they can see where things stand.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import {
  createJoinRequest,
  listDiscoverableFamilies,
  listJoinRequestsByRequester,
} from "@chronicle/core";
import { KindredButton } from "@/app/_kindred";
import { families } from "@/app/_copy";
import { FamilyFinder } from "./FamilyFinder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requestToJoin(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const familyId = String(formData.get("familyId") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  if (!familyId) redirect("/families/find");

  try {
    await createJoinRequest(db, {
      familyId,
      requesterPersonId: ctx.personId,
      message: message || undefined,
    });
  } catch {
    // createJoinRequest's guards (family gone/undiscoverable, already a member, duplicate pending)
    // all mean "we can't send this" — surface a single friendly inline error.
    redirect("/families/find?error=request");
  }
  redirect(`/families/find?sent=${encodeURIComponent(familyId)}`);
}

const STATUS_LABEL: Record<string, string> = {
  pending: families.find.statusWaiting,
  approved: families.find.statusApproved,
  declined: families.find.statusNotAccepted,
};

/** First name only, for the warm reassurance line. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export default async function FamiliesFindPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const { sent, error } = await searchParams;

  const [discoverable, myRequests] = await Promise.all([
    listDiscoverableFamilies(db),
    listJoinRequestsByRequester(db, ctx.personId),
  ]);

  /* ── Request-sent confirmation ─────────────────────────────────────────────
     `sent` carries the familyId we just requested. We read the steward + family from the
     requester's OWN requests (leak-safe — never an arbitrary family lookup). */
  const sentRequest = sent ? myRequests.find((r) => r.familyId === sent) : undefined;
  if (sentRequest) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-page)",
          padding: "clamp(24px, 5vw, 56px) 16px",
        }}
      >
        <div
          style={{
            maxWidth: 520,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 22,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 44, lineHeight: 1 }}>
            ✉️
          </span>
          <h1
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-display)",
              fontWeight: 500,
              color: "var(--text-body)",
              margin: 0,
              lineHeight: "var(--leading-tight)",
            }}
          >
            {families.find.sentTitle(sentRequest.stewardName)}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui)",
              color: "var(--text-muted)",
              margin: 0,
              lineHeight: "var(--leading-body)",
              maxWidth: "36ch",
            }}
          >
            {families.find.sentBody(
              firstName(sentRequest.stewardName),
              sentRequest.familyName,
            )}
          </p>
          <Link href="/families/find" style={{ textDecoration: "none" }}>
            <KindredButton label={families.find.sentBack} variant="secondary" />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--surface-page)",
        padding: "clamp(24px, 5vw, 56px) 16px",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <Link
          href="/families/start"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            fontWeight: 600,
            color: "var(--text-meta)",
          }}
        >
          ‹ Back
        </Link>
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-display)",
            fontWeight: 500,
            color: "var(--text-body)",
            margin: "14px 0 8px",
            lineHeight: "var(--leading-tight)",
          }}
        >
          {families.find.title}
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "0 0 8px",
            lineHeight: "var(--leading-body)",
            maxWidth: "64ch",
          }}
        >
          {families.find.intro}
        </p>

        {error === "request" ? (
          <div
            role="alert"
            style={{
              background: "var(--surface-sunken)",
              border: "var(--border-width) solid var(--border-strong)",
              borderRadius: "var(--radius-lg)",
              padding: "16px 20px",
              margin: "16px 0 0",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-meta)",
            }}
          >
            {families.find.requestFailed}
          </div>
        ) : null}

        <FamilyFinder discoverable={discoverable} action={requestToJoin} />

        {/* Requester's own requests */}
        {myRequests.length > 0 ? (
          <section style={{ marginTop: 40 }}>
            <h2
              style={{
                fontFamily: "var(--font-story)",
                fontSize: "var(--text-story)",
                fontWeight: 500,
                color: "var(--text-body)",
                margin: "0 0 14px",
              }}
            >
              {families.find.yourRequests}
            </h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
              {myRequests.map((r) => (
                <li
                  key={r.joinRequestId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    background: "var(--surface-card)",
                    border: "var(--border-width) solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    padding: "14px 18px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-ui-sm)",
                      color: "var(--text-body)",
                    }}
                  >
                    {r.familyName}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-label)",
                      letterSpacing: "var(--tracking-mono)",
                      color:
                        r.status === "approved"
                          ? "var(--support)"
                          : r.status === "declined"
                            ? "var(--text-muted)"
                            : "var(--accent-strong)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {(STATUS_LABEL[r.status] ?? r.status).toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
