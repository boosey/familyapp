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
  listOutstandingDrafts,
  listActiveFamiliesForPerson,
  listJoinRequestsByRequester,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { mockSignOut } from "@/lib/auth-mock";
import { isClerkConfigured } from "@/lib/clerk-config";
import {
  loadHubFeed,
  loadSeenStoryIds,
  loadViewerFamilies,
  loadStoryFamilyTargets,
  loadStoryCoverPhotoIds,
} from "@/lib/hub-data";
import { KindredAccountMenu } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { latestDraftPerAsk, questionsTabAnswerDrafts } from "./draft-dedup";
import { HubTabsNav } from "./HubTabsNav";
import { HubScopeSelector } from "./HubScopeSelector";
import { inviteTabVisible, requestsTabVisible } from "@/lib/hub-tabs";
import { IntakeReminder } from "./IntakeReminder";
import { AlbumSurface } from "./album/AlbumSurface";
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
  searchParams: Promise<{ tab?: string; scope?: string }>;
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
  const { tab: tabParam, scope: scopeParam } = await searchParams;
  const validTabs = new Set(["stories", "album", "questions", "ask", "asks", "invite", "requests"]);
  const activeTab = validTabs.has(tabParam ?? "") ? (tabParam as string) : "stories";

  // Hub scope: the single server-read `?scope=` param (default "all"), validated against the viewer's
  // OWN active families — a client-submitted scope is never trusted. `pendingRequests` are the
  // viewer's own still-pending join requests, shown as muted rows in the selector. Both are read here
  // (distinct from the steward-side `listPendingJoinRequestsForSteward` used for the Requests tab).
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  const pendingJoinRequests = (await listJoinRequestsByRequester(db, ctx.personId)).filter(
    (r) => r.status === "pending",
  );
  const scope =
    scopeParam && activeFamilies.some((f) => f.familyId === scopeParam) ? scopeParam : "all";

  const [feed, pendingAsks, pendingRequests, decidedRequests, viewerRow, allDrafts] = await Promise.all([
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
    listOutstandingDrafts(db, ctx.personId),
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

  // Each feed story's cover accompaniment photo (ADR-0009), via the audited batched core seam. Drives
  // the card cover image; a story with no attached image has no entry → a text-only card.
  const storyCovers = await loadStoryCoverPhotoIds(db, feedStoryIds);

  // Split the outstanding drafts: ask-backed feed the Questions tab (Date recordedAt, unchanged
  // shape), self-initiated (askId === null) feed the Stories tab's resume list (ISO-serialized).
  // `questionsTabAnswerDrafts` gates ask-backed drafts to review-ready (`pending_approval`) only —
  // ADR-0014's widened base read now includes the live `draft` state, which must NOT leak into the
  // Questions tab. The Stories resume list intentionally keeps both states so in-progress
  // self-initiated tellings can be resumed.
  const answerDrafts = questionsTabAnswerDrafts(allDrafts);
  const selfDrafts = allDrafts
    .filter((d) => d.askId === null)
    .map((d) => ({ storyId: d.storyId, kind: d.kind, recordedAt: d.recordedAt.toISOString() }));

  // Build a lookup map so QuestionsTab can render two-state affordances per ask. `allDrafts` is
  // most-recent-first, so keep the FIRST (latest) draft per ask — preserving the latest-wins dedup
  // that `listOutstandingAnswerDrafts` guaranteed before this refactor (Questions tab unchanged).
  const draftsByAskId = latestDraftPerAsk(answerDrafts);

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
    { key: "album", label: hub.shell.tabAlbum },
    {
      key: "questions",
      label: hub.shell.tabQuestions,
      badge: pendingAsks.length > 0 ? pendingAsks.length : undefined,
    },
    { key: "ask", label: hub.shell.tabAsk },
    { key: "asks", label: hub.shell.tabAsks },
    // Invite is a member-only affordance: you invite INTO a family you belong to. A pending-only
    // viewer (member of none) has nothing to invite into, so the tab is absent for them (Task 4.5).
    ...(inviteTabVisible(activeFamilies.length)
      ? [{ key: "invite", label: hub.shell.tabInvite }]
      : []),
    // Tab stays visible while there are pending OR recently-decided requests; the badge counts
    // only still-pending ones (the steward's actionable queue). Also member-only — a viewer who
    // stewards no family has no request queue.
    ...(requestsTabVisible(activeFamilies.length, pendingRequests.length, decidedRequests.length)
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
              {/* Scope selector — [ All ▾ ] — replaces the former crest placeholder. */}
              <HubScopeSelector
                scope={scope}
                tab={activeTab}
                families={activeFamilies}
                pending={pendingJoinRequests.map((r) => ({
                  familyName: r.familyName,
                  stewardName: r.stewardName,
                }))}
              />
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
            <HubTabsNav tabs={tabs} active={activeTab} scope={scope} />
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
              storyCovers={storyCovers}
              viewerFamilies={viewerFamilies}
              viewerName={viewerDisplayName}
              selfDrafts={selfDrafts}
              scope={scope}
            />
          )}
          {activeTab === "album" && <AlbumSurface db={db} ctx={ctx} scope={scope} />}
          {activeTab === "questions" && <QuestionsTab asks={pendingAsks} draftsByAskId={draftsByAskId} />}
          {activeTab === "ask" && <AskTab scope={scope} />}
          {activeTab === "asks" && (
            <AsksTab scope={scope} hasFamily={activeFamilies.length > 0} />
          )}
          {activeTab === "invite" && <InviteTab scope={scope} />}
          {activeTab === "requests" && <RequestsTab scope={scope} />}
        </section>
      </div>
    </main>
  );
}
