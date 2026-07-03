/**
 * Family hub shell — server component.
 *
 * Reads active tab from ?tab= searchParam (Next 15: searchParams is a Promise).
 * Loads feed + pending questions in parallel, then delegates to tab sub-components.
 * Navigation between tabs is handled by HubTabsNav (client wrapper around HubTabs).
 */
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import {
  listPendingAsksForNarrator,
  listPendingJoinRequestsForSteward,
  listDecidedJoinRequestsForSteward,
  listOutstandingAnswerDrafts,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { mockSignOut } from "@/lib/auth-mock";
import { isClerkConfigured } from "@/lib/clerk-config";
import { loadHubFeed, loadSeenStoryIds, loadViewerFamilies, loadStoryFamilyTargets } from "@/lib/hub-data";
import { KindredAccountMenu } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { HubTabsNav } from "./HubTabsNav";
import { IntakeReminder } from "./IntakeReminder";
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

  /* ── Anonymous gate ─────────────────────────────────────────────────────────
   * A signed-out visitor who lands on /hub (stale bookmark, shared link, back
   * button) is sent to the root landing — the real front door that offers both
   * "sign up" and "sign in". We do NOT render an auth card inline here: the
   * homepage already IS that surface, and an inline copy split the sign-in entry
   * across two different screens. */
  if (ctx.kind === "anonymous") {
    redirect("/");
  }

  /* ── Family-first gate ──────────────────────────────────────────────────────
   * The hub sits at the end of the onboarding spine, so guard it independently:
   * an account that is family-less or not yet onboarded and lands here directly
   * (stale bookmark, back button, /dev/sign-in) is bounced to the step it still
   * owes. resolvePostAuthRoute returns "/hub" only for an onboarded member. */
  const dest = await resolvePostAuthRoute(db, ctx.personId);
  if (dest !== "/hub") redirect(dest);

  /* ── Data ───────────────────────────────────────────────────────────────── */
  const { tab: tabParam } = await searchParams;
  const validTabs = new Set(["stories", "questions", "ask", "asks", "invite", "requests"]);
  const activeTab = validTabs.has(tabParam ?? "") ? (tabParam as string) : "stories";

  const [feed, pendingAsks, pendingRequests, decidedRequests, viewerRow, answerDrafts] = await Promise.all([
    loadHubFeed(db, ctx),
    listPendingAsksForNarrator(db, ctx.personId, { limit: 20 }),
    listPendingJoinRequestsForSteward(db, ctx.personId),
    listDecidedJoinRequestsForSteward(db, ctx.personId),
    db
      .select({
        spokenName: persons.spokenName,
        displayName: persons.displayName,
        biographicalAnchors: persons.biographicalAnchors,
      })
      .from(persons)
      .where(eq(persons.id, ctx.personId))
      .then((rows) => rows[0] ?? null),
    listOutstandingAnswerDrafts(db, ctx.personId),
  ]);

  // Which stories in the feed this viewer has already opened — drives the per-card "New" badge.
  const feedStoryIds = feed.flatMap((slot) => slot.stories.map((s) => s.id));
  const seenStoryIds = await loadSeenStoryIds(db, ctx.personId, feedStoryIds);

  // The Stories-tab family-scope filter options, and each feed story's target families (already
  // intersected with the viewer's families) for the family-tag pills. Both are open-schema reads.
  const viewerFamilies = await loadViewerFamilies(db, ctx);
  const familyTargets = await loadStoryFamilyTargets(
    db,
    feedStoryIds,
    viewerFamilies.map((f) => f.id),
  );

  // Build a lookup map so QuestionsTab can render two-state affordances per ask.
  const draftsByAskId = Object.fromEntries(
    answerDrafts.map((d) => [d.askId, { storyId: d.storyId, recordedAt: d.recordedAt }]),
  );

  // True when Clerk is wired up; drives the sign-out path selection below.
  const clerkSignOut = isClerkConfigured();

  /* ── Derived display values ─────────────────────────────────────────────── */
  // The family name IS the major label now (no "Family Chronicle" wordmark). Multiple families are
  // joined for now — the multi-family display is a separate design question, deliberately deferred.
  const familyNames = [...new Set(feed.map((s) => s.family.name))];
  const familyName = familyNames.length ? familyNames.join(" · ") : hub.shell.chronicle;

  const viewerName = viewerRow?.spokenName ?? viewerRow?.displayName ?? null;
  // Non-null display name for the Stories tab (labels the Timeline "Just {viewer}" toggle).
  const viewerDisplayName = viewerName ?? "You";
  const initials = viewerName
    ? viewerName
        .split(" ")
        .map((w) => w[0] ?? "")
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "Y";

  const tabs = [
    { key: "stories", label: hub.shell.tabStories },
    {
      key: "questions",
      label: hub.shell.tabQuestions,
      badge: pendingAsks.length > 0 ? pendingAsks.length : undefined,
    },
    { key: "ask", label: hub.shell.tabAsk },
    { key: "asks", label: hub.shell.tabAsks },
    { key: "invite", label: hub.shell.tabInvite },
    // Tab stays visible while there are pending OR recently-decided requests; the badge counts
    // only still-pending ones (the steward's actionable queue).
    ...(pendingRequests.length > 0 || decidedRequests.length > 0
      ? [
          {
            key: "requests",
            label: hub.shell.tabRequests,
            badge: pendingRequests.length > 0 ? pendingRequests.length : undefined,
          },
        ]
      : []),
  ];

  const accountItems: AccountMenuItem[] = [
    { key: "profile", label: hub.shell.menuProfile, href: "/hub" /* stub: no backend yet */ },
    { key: "settings", label: hub.shell.menuSettings, href: "/hub" /* stub: no backend yet */ },
    { key: "manage-family", label: hub.shell.menuManageFamily, href: "/hub" /* stub: no backend yet */ },
    { key: "switch-user", label: hub.shell.menuSwitchUser, href: "/dev/sign-in" },
    { key: "log-out", label: hub.shell.menuLogOut, onSelect: logOut },
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
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              {/* Icon placeholder — a future family crest / avatar slot. */}
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 auto",
                  width: 44,
                  height: 44,
                  borderRadius: "var(--radius-md)",
                  border: "var(--border-width) solid var(--border-strong)",
                  background: "var(--surface-sunken)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-label)",
                  color: "var(--text-muted)",
                }}
              >
                {familyName.charAt(0).toUpperCase()}
              </span>
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
                {familyName}
              </h1>
            </div>
            <KindredAccountMenu
              initials={initials}
              displayName={viewerName ?? undefined}
              items={accountItems}
              clerkSignOut={clerkSignOut}
            />
          </div>

          {/* Tabs row */}
          <div style={{ marginBottom: -1 /* overlap the border */ }}>
            <HubTabsNav tabs={tabs} active={activeTab} />
          </div>
        </header>

        {/* Tab content */}
        <section style={{ padding: "28px 0" }}>
          <IntakeReminder profile={viewerRow?.biographicalAnchors ?? {}} />
          {activeTab === "stories" && (
            <StoriesTab
              feed={feed}
              viewerPersonId={ctx.personId}
              seenStoryIds={seenStoryIds}
              familyTargets={familyTargets}
              viewerFamilies={viewerFamilies}
              viewerName={viewerDisplayName}
            />
          )}
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
