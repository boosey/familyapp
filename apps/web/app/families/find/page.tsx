/**
 * /families/find — search discoverable families and ask to join (ask #2, requester side).
 *
 * Search runs through core's keyword family search (discoverable=true only; member names are a
 * matching signal but never returned). "Request to join" calls createJoinRequest; its guards
 * (not discoverable / already a member / duplicate pending) surface as a friendly inline error.
 * The requester's own pending/decided requests are listed below so they can see where things stand.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import {
  createJoinRequest,
  createKeywordFamilySearch,
  listJoinRequestsByRequester,
} from "@chronicle/core";
import { KindredButton } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requestToJoin(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const familyId = String(formData.get("familyId") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  const q = String(formData.get("q") ?? "");
  if (!familyId) redirect("/families/find");

  try {
    await createJoinRequest(db, {
      familyId,
      requesterPersonId: ctx.personId,
      message: message || undefined,
    });
  } catch {
    // createJoinRequest's guards (family gone/undiscoverable, already a member, duplicate pending)
    // all mean "we can't send this" — keep the query so the user sees their results again.
    const qs = q ? `&q=${encodeURIComponent(q)}` : "";
    redirect(`/families/find?error=request${qs}`);
  }
  redirect("/families/find?pending=1");
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for the steward",
  approved: "Approved — welcome in",
  declined: "Not accepted",
};

export default async function FamiliesFindPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pending?: string; error?: string }>;
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const { q, pending, error } = await searchParams;
  const query = (q ?? "").trim();

  const [results, myRequests] = await Promise.all([
    query
      ? createKeywordFamilySearch(db).search({ text: query })
      : Promise.resolve([]),
    listJoinRequestsByRequester(db, ctx.personId),
  ]);

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
          Find your family
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "0 0 24px",
            lineHeight: "var(--leading-body)",
          }}
        >
          Search for a family a relative already created, then ask to join. The steward approves
          every request.
        </p>

        {pending ? (
          <div
            role="status"
            style={{
              background: "var(--accent-soft)",
              border: "var(--border-width) solid var(--accent)",
              borderRadius: "var(--radius-lg)",
              padding: "16px 20px",
              margin: "0 0 24px",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--accent-strong)",
            }}
          >
            Your request is on its way — it&apos;s waiting for the family&apos;s steward to say yes.
          </div>
        ) : null}

        {error === "request" ? (
          <div
            role="alert"
            style={{
              background: "var(--surface-sunken)",
              border: "var(--border-width) solid var(--border-strong)",
              borderRadius: "var(--radius-lg)",
              padding: "16px 20px",
              margin: "0 0 24px",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-meta)",
            }}
          >
            We couldn&apos;t send that request — you may already be a member, or already have a
            request waiting for that family.
          </div>
        ) : null}

        {/* Search */}
        <form method="get" action="/families/find" style={{ display: "flex", gap: 10 }}>
          <input
            name="q"
            type="text"
            defaultValue={query}
            className="kin-field"
            placeholder="Search by family name, a relative's name, or describe them…"
            style={{ flex: 1 }}
          />
          <KindredButton type="submit" label="Search" />
        </form>

        {/* Results */}
        {query ? (
          <section style={{ marginTop: 28 }}>
            {results.length === 0 ? (
              <p
                style={{
                  fontFamily: "var(--font-story)",
                  fontSize: "var(--text-story)",
                  color: "var(--text-muted)",
                }}
              >
                No families matched “{query}”. Try a relative&apos;s name, or ask them for an invite
                link instead.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 16 }}>
                {results.map((r) => (
                  <li
                    key={r.familyId}
                    style={{
                      background: "var(--surface-card)",
                      border: "var(--border-width) solid var(--border)",
                      borderRadius: "var(--radius-lg)",
                      boxShadow: "var(--shadow-card)",
                      padding: "22px 24px",
                    }}
                  >
                    <h2
                      style={{
                        fontFamily: "var(--font-story)",
                        fontSize: "var(--text-story-lg)",
                        fontWeight: 500,
                        color: "var(--text-body)",
                        margin: "0 0 4px",
                      }}
                    >
                      {r.familyName}
                    </h2>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-label)",
                        letterSpacing: "var(--tracking-mono)",
                        color: "var(--support)",
                        marginBottom: 16,
                      }}
                    >
                      STEWARD · {r.stewardName.toUpperCase()} · MATCH: {r.matchReason.toUpperCase()}
                    </div>
                    <form action={requestToJoin} style={{ display: "grid", gap: 12 }}>
                      <input type="hidden" name="familyId" value={r.familyId} />
                      <input type="hidden" name="q" value={query} />
                      <textarea
                        name="message"
                        className="kin-field"
                        placeholder="Add a note for the steward (optional) — e.g. “I'm Rosa's cousin.”"
                        style={{ minHeight: 72 }}
                      />
                      <div>
                        <KindredButton type="submit" label="Request to join" variant="secondary" />
                      </div>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

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
              Your requests
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
