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
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import {
  loadHubFeed,
  loadSeenStoryIds,
  loadViewerFamilies,
  loadStoryFamilyTargets,
  loadStoryCoverPhotoIds,
  loadStoryPhotoIds,
} from "@/lib/hub-data";
import { hub } from "@/app/_copy";
import { latestDraftPerAsk, questionsTabAnswerDrafts } from "./draft-dedup";
import { HubTabsNav } from "./HubTabsNav";
import { parseFamilyFilter, deriveSingleScope } from "@/lib/family-filter";
import { inviteTabVisible, requestsTabVisible } from "@/lib/hub-tabs";
import { IntakeReminder } from "./IntakeReminder";
import { AlbumSurface } from "./album/AlbumSurface";
import { StoriesTab } from "./tabs/StoriesTab";
import { QuestionsTab } from "./tabs/QuestionsTab";
import { AskTab } from "./tabs/AskTab";
import { AsksTab } from "./tabs/AsksTab";
import { FamilyTab } from "./tabs/FamilyTab";
import { InviteTab } from "./tabs/InviteTab";
import { RequestsTab } from "./tabs/RequestsTab";
import { loadFamilyTabData } from "@/lib/family-tab-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HubPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    families?: string | string[];
    googlePhotos?: string;
    googlePhotosError?: string;
    subjectPhotoIds?: string | string[];
    // Family tab: `?anchor=` focuses the tree on a person (e.g. a story's narrator); `?view=list`
    // deep-links straight to the relatives List view.
    anchor?: string;
    view?: string;
    // Invite tab: `?inviteeName=` pre-fills the member-invite name field (Slice D #6 — the tree's
    // Invite affordance deep-links here pre-targeted at a person + family via `scope`).
    inviteeName?: string;
  }>;
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
  const {
    tab: tabParam,
    families: familiesParam,
    googlePhotos: googlePhotosParam,
    googlePhotosError: googlePhotosErrorParam,
    subjectPhotoIds: subjectPhotoIdsParam,
    anchor: anchorParam,
    view: viewParam,
    inviteeName: inviteeNameParam,
  } = await searchParams;
  // ADR-0009: `?subjectPhotoIds=<uuid>` may repeat, so Next hands us `string | string[] | undefined`.
  // Normalize to a de-duped string[] to pre-select those photos in the ask picker (`/hub?tab=ask&…`).
  // This only SEEDS the picker's initial ticks; the ask submit path re-runs the album-access gate per
  // id in `createAsk`, so an unseeable/tampered id is rejected there, never here.
  const subjectPhotoIds = [
    ...new Set(
      (Array.isArray(subjectPhotoIdsParam)
        ? subjectPhotoIdsParam
        : subjectPhotoIdsParam
          ? [subjectPhotoIdsParam]
          : []
      ).filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
  const googlePhotosOauthConnected = googlePhotosParam === "connected";
  const googlePhotosOauthError =
    typeof googlePhotosErrorParam === "string" ? googlePhotosErrorParam : null;
  const validTabs = new Set(["stories", "album", "questions", "ask", "asks", "family", "invite", "requests"]);
  const activeTab = validTabs.has(tabParam ?? "") ? (tabParam as string) : "stories";

  // Family filter (ADR-0021): parse the shared `?families=` browse param against the viewer's OWN
  // active families (a client-crafted value is never trusted — unknown ids drop, absent = all, `none`
  // = the empty set). The browse surfaces multi-select; the tabs not yet multi-aware derive a single
  // `scope` from it, byte-for-byte the old behaviour. The RAW families value (normalized to a single
  // string | null) is threaded to HubTabsNav so a tab switch preserves the filter.
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  const activeIds = activeFamilies.map((f) => f.familyId);
  const filter = parseFamilyFilter(familiesParam, activeIds);
  const scope = deriveSingleScope(filter);
  const familiesRaw =
    familiesParam === undefined
      ? null
      : Array.isArray(familiesParam)
        ? familiesParam.join(",")
        : familiesParam;

  // Family tab (visual tree + relatives list, folded in from the old /hub/tree + /hub/kin routes).
  // Resolve a concrete family — the hub scope when it names one, else the viewer's first active family
  // — and load the focus-rooted tree + kin ONLY when the tab is active (`?anchor=` focuses the tree on
  // a person, e.g. a story's narrator). A pending-only viewer (no active family) gets null → no-family.
  const familyTabFamilyId = scope !== "all" ? scope : (activeFamilies[0]?.familyId ?? null);
  const familyTabData =
    activeTab === "family" && familyTabFamilyId
      ? await loadFamilyTabData(db, ctx, familyTabFamilyId, anchorParam)
      : null;
  const familyInitialView = viewParam === "list" ? "list" : "tree";

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

  // Each feed story's FULL renderable photo set (cover first) — drives the card's non-cover thumbnail
  // row below the tags. Same audited batched seam family as the covers; a text-only story has no entry.
  const storyPhotos = await loadStoryPhotoIds(db, feedStoryIds);

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

  /* ── Derived display values ─────────────────────────────────────────────── */
  // The family name IS the major label now (no "Family Chronicle" wordmark). Multiple families are
  // joined for now — the multi-family display is a separate design question, deliberately deferred.
  // `||` (not `??`): a blank short name (should never persist — the write path coerces "" → null,
  // but defend anyway) falls back to the formal name rather than rendering an empty header.
  const familyNames = [...new Set(feed.map((s) => s.family.shortName || s.family.name))];
  const familyName = familyNames.length ? familyNames.join(" · ") : hub.shell.chronicle;

  const viewerName = viewerRow?.spokenName ?? viewerRow?.displayName ?? null;
  // Non-null display name for the Stories tab (labels the Timeline "Just {viewer}" toggle).
  const viewerDisplayName = viewerName ?? "You";

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
    // Family surface — the visual tree + relatives list, a real in-hub `?tab=family` tab now (it used
    // to be the standalone /hub/tree route, which hid the tab bar once opened).
    { key: "family", label: hub.shell.tabFamily },
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
            {/* Account menu is rendered globally (fixed top-right) by <AccountMenuMount> in the root
                layout, so the hub no longer inlines its own copy in the header. */}
          </div>

          {/* Tabs row */}
          <div style={{ marginBottom: -1 /* overlap the border */ }}>
            <HubTabsNav tabs={tabs} active={activeTab} familiesParam={familiesRaw} />
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
              storyPhotos={storyPhotos}
              viewerFamilies={viewerFamilies}
              viewerName={viewerDisplayName}
              selfDrafts={selfDrafts}
              filter={filter}
              activeFamilies={activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName }))}
            />
          )}
          {activeTab === "album" && (
            <AlbumSurface
              db={db}
              ctx={ctx}
              familiesParam={familiesParam}
              googlePhotosOauthConnected={googlePhotosOauthConnected}
              googlePhotosOauthError={googlePhotosOauthError}
            />
          )}
          {activeTab === "questions" && <QuestionsTab asks={pendingAsks} draftsByAskId={draftsByAskId} />}
          {activeTab === "ask" && (
            <AskTab scope={scope} initialSubjectPhotoIds={subjectPhotoIds} />
          )}
          {activeTab === "asks" && (
            <AsksTab
              families={activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName }))}
              seedFamilyId={scope}
              hasFamily={activeFamilies.length > 0}
            />
          )}
          {activeTab === "family" &&
            (familyTabData ? (
              <FamilyTab
                familyId={familyTabData.familyId}
                focusPersonId={familyTabData.focusPersonId}
                viewerPersonId={ctx.personId}
                tree={familyTabData.tree}
                kin={familyTabData.kin}
                initialView={familyInitialView}
              />
            ) : (
              <div
                style={{
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
                  {hub.tree.noFamily}
                </p>
              </div>
            ))}
          {/* Invite is member-only: you invite people INTO a family you belong to. A pending-only
              viewer hitting ?tab=invite directly would otherwise reach a broken zero-option family
              form — gate the dispatch on membership and show the shared pending-only empty instead
              (InviteTab self-guards too, but this keeps the broken form off the page entirely). */}
          {activeTab === "invite" &&
            (activeFamilies.length > 0 ? (
              <InviteTab
                scope={scope}
                inviteeName={typeof inviteeNameParam === "string" ? inviteeNameParam : undefined}
              />
            ) : (
              <div
                style={{
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
                  {hub.shell.pendingEmpty}
                </p>
              </div>
            ))}
          {activeTab === "requests" && (
            <RequestsTab
              families={activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName }))}
              seedFamilyId={scope}
            />
          )}
        </section>
      </div>
    </main>
  );
}
