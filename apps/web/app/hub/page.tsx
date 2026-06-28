/**
 * Family hub shell — server component.
 *
 * Reads active tab from ?tab= searchParam (Next 15: searchParams is a Promise).
 * Loads feed + pending questions in parallel, then delegates to tab sub-components.
 * Navigation between tabs is handled by HubTabsNav (client wrapper around HubTabs).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import { listPendingAsksForNarrator, listPendingJoinRequestsForSteward, listOutstandingAnswerDrafts } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { mockSignOut } from "@/lib/auth-mock";
import { loadHubFeed } from "@/lib/hub-data";
import { KindredButton, KindredAccountMenu } from "@/app/_kindred";
import { HubTabsNav } from "./HubTabsNav";
import { StoriesTab } from "./tabs/StoriesTab";
import { QuestionsTab } from "./tabs/QuestionsTab";
import { AskTab } from "./tabs/AskTab";
import { AsksTab } from "./tabs/AsksTab";
import { InviteTab } from "./tabs/InviteTab";
import { RequestsTab } from "./tabs/RequestsTab";
import type { AccountMenuItem } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function logOut(): Promise<void> {
  "use server";
  await mockSignOut();
  redirect("/");
}

export default async function HubPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  /* ── Anonymous gate ─────────────────────────────────────────────────────── */
  if (ctx.kind === "anonymous") {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-page)",
        }}
      >
        <div
          style={{
            maxWidth: 440,
            width: "100%",
            padding: "clamp(32px, 6vw, 64px)",
            background: "var(--surface-card)",
            border: "var(--border-width) solid var(--border)",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--shadow-lift)",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-display)",
              color: "var(--text-body)",
              margin: "0 0 12px",
            }}
          >
            Family Chronicle
          </h1>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui)",
              color: "var(--text-muted)",
              margin: "0 0 28px",
            }}
          >
            Sign in to see your family's stories.
          </p>
          <div style={{ display: "grid", gap: 12, maxWidth: 260 }}>
            <Link href="/sign-in" style={{ textDecoration: "none" }}>
              <KindredButton label="Sign in" fullWidth />
            </Link>
            <Link href="/sign-up" style={{ textDecoration: "none" }}>
              <KindredButton label="Create your family" variant="secondary" fullWidth />
            </Link>
          </div>
        </div>
      </main>
    );
  }

  /* ── Data ───────────────────────────────────────────────────────────────── */
  const { tab: tabParam } = await searchParams;
  const validTabs = new Set(["stories", "questions", "ask", "asks", "invite", "requests"]);
  const activeTab = validTabs.has(tabParam ?? "") ? (tabParam as string) : "stories";

  const [feed, pendingAsks, pendingRequests, viewerRow, answerDrafts] = await Promise.all([
    loadHubFeed(db, ctx),
    listPendingAsksForNarrator(db, ctx.personId, { limit: 20 }),
    listPendingJoinRequestsForSteward(db, ctx.personId),
    db
      .select({ spokenName: persons.spokenName, displayName: persons.displayName })
      .from(persons)
      .where(eq(persons.id, ctx.personId))
      .then((rows) => rows[0] ?? null),
    listOutstandingAnswerDrafts(db, ctx.personId),
  ]);

  // Build a lookup map so QuestionsTab can render two-state affordances per ask.
  const draftsByAskId = Object.fromEntries(
    answerDrafts.map((d) => [d.askId, { storyId: d.storyId, recordedAt: d.recordedAt }]),
  );

  /* ── Derived display values ─────────────────────────────────────────────── */
  const familyNames = [...new Set(feed.map((s) => s.family.name))];
  const familyLabel = familyNames.length
    ? `THE ${familyNames.join(" · ").toUpperCase()} FAMILY`
    : null;

  const viewerName = viewerRow?.spokenName ?? viewerRow?.displayName ?? null;
  const initials = viewerName
    ? viewerName
        .split(" ")
        .map((w) => w[0] ?? "")
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "Y";

  const tabs = [
    { key: "stories", label: "Stories" },
    {
      key: "questions",
      label: "Questions for you",
      badge: pendingAsks.length > 0 ? pendingAsks.length : undefined,
    },
    { key: "ask", label: "Ask a question" },
    { key: "asks", label: "Your asks" },
    { key: "invite", label: "Invite" },
    ...(pendingRequests.length > 0
      ? [{ key: "requests", label: "Requests", badge: pendingRequests.length }]
      : []),
  ];

  const accountItems: AccountMenuItem[] = [
    { key: "profile", label: "Your profile", href: "/hub" /* stub: no backend yet */ },
    { key: "settings", label: "Settings", href: "/hub" /* stub: no backend yet */ },
    { key: "manage-family", label: "Manage family", href: "/hub" /* stub: no backend yet */ },
    { key: "switch-user", label: "Switch user", href: "/dev/sign-in" },
    { key: "log-out", label: "Log out", onSelect: logOut },
  ];

  /* ── Shell ──────────────────────────────────────────────────────────────── */
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--surface-page)",
      }}
    >
      <div
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "0 clamp(16px, 4vw, 32px)",
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: "28px 0 0",
            borderBottom: "var(--border-width) solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Title row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
              <h1
                style={{
                  fontFamily: "var(--font-story)",
                  fontSize: "clamp(1.75rem, 4vw, var(--text-display))",
                  fontWeight: 400,
                  color: "var(--text-body)",
                  margin: 0,
                  letterSpacing: "var(--tracking-tight)",
                }}
              >
                Family Chronicle
              </h1>
              {familyLabel ? (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    letterSpacing: "var(--tracking-mono)",
                    color: "var(--support)",
                  }}
                >
                  {familyLabel}
                </span>
              ) : null}
            </div>
            <KindredAccountMenu
              initials={initials}
              displayName={viewerName ?? undefined}
              items={accountItems}
            />
          </div>

          {/* Tabs row */}
          <div style={{ marginBottom: -1 /* overlap the border */ }}>
            <HubTabsNav tabs={tabs} active={activeTab} />
          </div>
        </header>

        {/* Tab content */}
        <section style={{ padding: "28px 0" }}>
          {activeTab === "stories" && <StoriesTab feed={feed} />}
          {activeTab === "questions" && <QuestionsTab asks={pendingAsks} draftsByAskId={draftsByAskId} />}
          {activeTab === "ask" && <AskTab />}
          {activeTab === "asks" && <AsksTab />}
          {activeTab === "invite" && <InviteTab />}
          {activeTab === "requests" && <RequestsTab />}
        </section>
      </div>
    </main>
  );
}
