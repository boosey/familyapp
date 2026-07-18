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
  listPendingInvitationsForPerson,
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
import { QuestionsSubNav } from "./QuestionsSubNav";
import { parseFamilyFilter, deriveSingleScope, FAMILIES_PARAM } from "@/lib/family-filter";
import { inviteTabVisible, requestsTabVisible } from "@/lib/hub-tabs";
import { IntakeReminder } from "./IntakeReminder";
import { PendingInvitesBanner } from "./PendingInvitesBanner";
import { AlbumSurface } from "./album/AlbumSurface";
import { StoriesTab } from "./tabs/StoriesTab";
import { QuestionsTab } from "./tabs/QuestionsTab";
import { AskTab } from "./tabs/AskTab";
import { AsksTab } from "./tabs/AsksTab";
import { FamilyTab } from "./tabs/FamilyTab";
import { InviteTab } from "./tabs/InviteTab";
import { RequestsTab } from "./tabs/RequestsTab";
import { loadFamilyTabData } from "@/lib/family-tab-data";
import styles from "./page.module.css";

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

  const [feed, pendingAsks, pendingRequests, decidedRequests, viewerRow, allDrafts, pendingInviteMatches] = await Promise.all([
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
    // #120: live pending invites addressed to this account's verified contacts — the confirm
    // cards rendered above the tabs until Join / "Not me".
    listPendingInvitationsForPerson(db, ctx.personId),
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

  // Task 3 (Playful de-clutter): the primary nav is FOUR tabs — Stories · Album · Family · Questions
  // — plus a prominent "Tell a story" CTA (rendered inside HubTabs). The three ask surfaces
  // (questions/ask/asks) consolidate under the single Questions primary tab (a secondary sub-nav
  // below switches among them); the conditional Invite/Requests entries move into a "More ▾"
  // overflow menu. This regroups PRESENTATION ONLY — the routing keys, `?tab=` values, and the
  // visibility gates below are byte-for-byte the same as before.
  const primaryTabs = [
    { key: "stories", label: hub.shell.tabStories },
    { key: "album", label: hub.shell.tabAlbum },
    // Family surface — the visual tree + relatives list, a real in-hub `?tab=family` tab (it used to
    // be the standalone /hub/tree route, which hid the tab bar once opened).
    { key: "family", label: hub.shell.tabFamily },
    {
      key: "questions",
      label: hub.shell.tabQuestions,
      badge: pendingAsks.length > 0 ? pendingAsks.length : undefined,
    },
  ];
  // Invite no longer lives in "More" — it's a button on the Family surface (you invite people INTO a
  // family), rendered below. Requests is now the ONLY overflow entry: visible while there are pending
  // OR recently-decided requests; the badge counts only still-pending ones (the steward's actionable
  // queue). Member-only — a viewer who stewards no family has no request queue.
  const overflowTabs = requestsTabVisible(
    activeFamilies.length,
    pendingRequests.length,
    decidedRequests.length,
  )
    ? [
        {
          key: "requests",
          label: hub.shell.tabRequests,
          badge: pendingRequests.length > 0 ? pendingRequests.length : undefined,
        },
      ]
    : [];

  // Which PRIMARY tab is visually active: the three ask surfaces all light up the Questions tab.
  const primaryActive = ["questions", "ask", "asks"].includes(activeTab) ? "questions" : activeTab;
  // The active ask surface drives the secondary sub-nav (only rendered inside the Questions content).
  const questionsSurfaceActive = ["questions", "ask", "asks"].includes(activeTab);

  /* ── Shell ──────────────────────────────────────────────────────────────── */
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          {/* Title row */}
          <div className={styles.titleRow}>
            <div className={styles.titleGroup}>
              <div>
                <p className={styles.familyEyebrow}>
                  {hub.shell.familyEyebrow(activeFamilies.length)}
                </p>
                <h1 className={styles.familyName}>
                  {familyName}
                </h1>
              </div>
            </div>
            {/* Account menu is rendered globally (fixed top-right) by <AccountMenuMount> in the root
                layout, so the hub no longer inlines its own copy in the header. */}
          </div>

          {/* Tabs row */}
          <div className={styles.tabsRow}>
            <HubTabsNav
              primaryTabs={primaryTabs}
              overflowTabs={overflowTabs}
              active={primaryActive}
              familiesParam={familiesRaw}
            />
          </div>
        </header>

        {/* Tab content */}
        <section className={styles.tabContent}>
          <PendingInvitesBanner matches={pendingInviteMatches} />
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
              activeFamilies={activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName, shortName: f.familyShortName }))}
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
          {/* Task 3: the three ask surfaces share one primary tab (Questions). A secondary sub-nav
              switches among them, rendered ABOVE whichever surface is active. Content below is
              unchanged — each key still renders exactly what it did before. */}
          {questionsSurfaceActive && (
            <QuestionsSubNav active={activeTab} familiesParam={familiesRaw} />
          )}
          {activeTab === "questions" && <QuestionsTab asks={pendingAsks} draftsByAskId={draftsByAskId} />}
          {activeTab === "ask" && (
            <AskTab
              families={activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName, shortName: f.familyShortName }))}
              filter={filter}
              initialSubjectPhotoIds={subjectPhotoIds}
            />
          )}
          {activeTab === "asks" && (
            <AsksTab
              families={activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName, shortName: f.familyShortName }))}
              seedFamilyId={scope}
              hasFamily={activeFamilies.length > 0}
            />
          )}
          {activeTab === "family" && (
            <>
              {/* Invite lives here now (a family action), not in the primary nav's "More" menu — you
                  invite people INTO a family. Member-only, same gate as the old overflow entry. */}
              {inviteTabVisible(activeFamilies.length) && (
                <div className={styles.familyActions}>
                  <a
                    className={styles.inviteButton}
                    href={`/hub?tab=invite${familiesRaw ? `&${FAMILIES_PARAM}=${encodeURIComponent(familiesRaw)}` : ""}`}
                  >
                    {hub.shell.tabInvite}
                  </a>
                </div>
              )}
              {familyTabData ? (
              <FamilyTab
                familyId={familyTabData.familyId}
                focusPersonId={familyTabData.focusPersonId}
                viewerPersonId={ctx.personId}
                tree={familyTabData.tree}
                kin={familyTabData.kin}
                initialView={familyInitialView}
                // Family filter chips (ADR-0021 §Tree, #48). Gate the chip data on >=2 families — the
                // same rule AlbumSurface uses — so the client widget's next/navigation hooks stay out
                // of the server render for a 0/1-family viewer. The single ON chip is the resolved
                // scope (`familyTabFamilyId`); arriving with several selected already collapsed to the
                // first one server-side via `deriveSingleScope`.
                families={
                  activeFamilies.length >= 2
                    ? activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName, shortName: f.familyShortName }))
                    : []
                }
                scopeId={familyTabFamilyId ?? undefined}
              />
            ) : (
              <div className={styles.emptyCard}>
                <p className={styles.emptyText}>
                  {hub.tree.noFamily}
                </p>
              </div>
            )}
            </>
          )}
          {/* Invite is member-only: you invite people INTO a family you belong to. A pending-only
              viewer hitting ?tab=invite directly would otherwise reach a broken zero-option family
              form — gate the dispatch on membership and show the shared pending-only empty instead
              (InviteTab self-guards too, but this keeps the broken form off the page entirely). */}
          {activeTab === "invite" &&
            (activeFamilies.length > 0 ? (
              <InviteTab
                families={activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName, shortName: f.familyShortName }))}
                filter={filter}
                inviteeName={typeof inviteeNameParam === "string" ? inviteeNameParam : undefined}
              />
            ) : (
              <div className={styles.emptyCard}>
                <p className={styles.emptyText}>
                  {hub.shell.pendingEmpty}
                </p>
              </div>
            ))}
          {activeTab === "requests" && (
            <RequestsTab
              families={activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName, shortName: f.familyShortName }))}
              seedFamilyId={scope}
            />
          )}
        </section>
      </div>
    </main>
  );
}
