/**
 * Family hub shell — server component.
 *
 * Reads active tab from ?tab= searchParam (Next 15: searchParams is a Promise).
 * Loads feed + pending questions in parallel, then delegates to tab sub-components.
 * Navigation between tabs is handled by HubPrimaryNav (client wrapper: top HubTabs on desktop, a
 * fixed BottomTabBar on a phone).
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
  listAlbumPhotoIds,
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
import { HubPrimaryNav } from "./HubPrimaryNav";
import { CollapsingHeader } from "./CollapsingHeader";
import { loadAccountMenu } from "@/app/_kindred/load-account-menu";
import { QuestionsSubNav } from "./QuestionsSubNav";
import { FamilySurfaceNav } from "./FamilySurfaceNav";
import { parseFamilyFilter, deriveSingleScope, selectedIdList } from "@/lib/family-filter";
import { seedDesignatorFamily } from "@/lib/family-designator";
import { inviteTabVisible, requestsTabVisible, familyTabBadge } from "@/lib/hub-tabs";
import { isBiographicalProfileComplete } from "@/lib/intake-profile";
import { PendingInvitesBanner } from "./PendingInvitesBanner";
import { AlbumSurface } from "./album/AlbumSurface";
import { ThumbPrefetchLinks } from "./album/ThumbPrefetchLinks";
import { ALBUM_WARM_FIRST_SCREEN } from "./album/prefetch-constants";
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
  // string | null) is threaded to HubPrimaryNav so a tab switch preserves the filter.
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
  const familyView = viewParam === "list" ? "list" : "tree";
  // #144/#158: the member-only Invite entry point rides the shared Family selector row (<FamilySurfaceNav>).
  // Same gate as before — you invite INTO a family, so it shows only for a viewer with ≥1 family.
  // Opens the cold Invite modal (same chrome as person-bound Invite); `undefined` renders no button.
  const designatorFamilies = activeFamilies.map((f) => ({
    id: f.familyId,
    name: f.familyName,
    shortName: f.familyShortName,
  }));
  const familyInvite = inviteTabVisible(activeFamilies.length)
    ? {
        families: designatorFamilies,
        seededFamily: seedDesignatorFamily(
          filter,
          designatorFamilies.map((f) => f.id),
        ),
      }
    : undefined;

  // #371: warm the first screenful of album thumbnails on EVERY hub load (not just the album tab), so
  // switching to Album paints from cache. The families to warm are the SAME ones the album would show
  // under the current `?families=` filter (parsed above) — so the warmed prefix matches the tile prefix.
  // An ids-only read (one cheap query); the `<ThumbPrefetchLinks>` below turns them into idle prefetch
  // hints. See docs/superpowers/specs/2026-07-23-preload-album-thumbnails-design.md.
  const albumWarmFamilyIds = selectedIdList(filter, activeIds);

  const [feed, pendingAsks, pendingRequests, decidedRequests, viewerRow, allDrafts, pendingInviteMatches, accountMenu, albumWarmIds] = await Promise.all([
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
    // #233 (ADR-0025 device round): the account menu, resolved once here and shared by BOTH
    // presentations — the desktop avatar dropdown (rendered by HubPrimaryNav at the right end of
    // the tabs row) and the bottom bar's 5th "Account" item on a phone. This is the ONLY
    // loadAccountMenu call — the duplicate global root-layout mount was removed in #234.
    loadAccountMenu(db, ctx.personId),
    // #371: ids-only, capped at one screenful — cheap enough to run on every hub render.
    listAlbumPhotoIds(db, ctx, albumWarmFamilyIds, { limit: ALBUM_WARM_FIRST_SCREEN }),
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

  // #138: the intake/profile reminder is a compact button on the Stories control row now (not a
  // full-width banner across every tab). Compute completeness server-side so only the Stories tab
  // shows it, and only while the biographical intake is unfinished.
  const intakeIncomplete = !isBiographicalProfileComplete(viewerRow?.biographicalAnchors ?? {});

  // Issue #124 (Scrapbook de-clutter): the primary nav is exactly FOUR tabs — Stories · Album · Family
  // · Questions — with no global "Tell a story" CTA (the single Tell affordance lives on the Stories
  // tab, #125) and no "More ▾" overflow menu. Two surfaces fold onto a primary tab, each switched by a
  // secondary sub-nav below: the three ask surfaces (questions/ask/asks) fold onto Questions, and the
  // steward's Requests queue folds onto Family. The Family tab badges the actionable pending-request
  // count; Questions badges pending asks. This regroups PRESENTATION ONLY — the routing keys, `?tab=`
  // values, and the visibility gates below are byte-for-byte the same as before.
  const primaryTabs = [
    { key: "stories", label: hub.shell.tabStories },
    { key: "album", label: hub.shell.tabAlbum },
    // Family surface — the visual tree + relatives list (formerly the standalone /hub/tree route) plus
    // the steward's Requests queue folded in as a sub-nav. Badged with the pending-request count.
    { key: "family", label: hub.shell.tabFamily, badge: familyTabBadge(pendingRequests.length) },
    {
      key: "questions",
      label: hub.shell.tabQuestions,
      badge: pendingAsks.length > 0 ? pendingAsks.length : undefined,
    },
  ];

  // Which PRIMARY tab is visually active: the three ask surfaces light up Questions; family, requests,
  // and invite all light up Family (Requests + Invite are Family-surface entries, not their own chrome).
  const primaryActive = ["questions", "ask", "asks"].includes(activeTab)
    ? "questions"
    : ["family", "requests", "invite"].includes(activeTab)
      ? "family"
      : activeTab;
  // The active ask surface drives the Questions secondary sub-nav (rendered inside the Questions content).
  const questionsSurfaceActive = ["questions", "ask", "asks"].includes(activeTab);
  // The Family surface hosts the tree/relatives view AND the Requests queue.
  const familySurfaceActive = ["family", "requests"].includes(activeTab);
  // #158: the shared selector row (Family tree · List · Requests) shows on the family surface whenever
  // there's a family to browse, OR the viewer deep-linked Requests (so the way out is always present).
  const showFamilySelector =
    familySurfaceActive && (activeFamilies.length > 0 || activeTab === "requests");
  // The Requests ITEM in the selector appears only when the steward queue is live (pending OR
  // recently-decided) or the viewer deep-linked Requests — otherwise it's a link into an empty surface.
  const showRequestsItem =
    requestsTabVisible(activeFamilies.length, pendingRequests.length, decidedRequests.length) ||
    activeTab === "requests";
  // Which selector item is active: Requests when on the requests tab, else the resolved `?view=`.
  const familySelectorActive = activeTab === "requests" ? "requests" : familyView;

  /* ── Shell ──────────────────────────────────────────────────────────────── */
  return (
    <main className={styles.main}>
      {/* #371: idle, low-priority cache-warm for the first screenful of album thumbnails, on every tab
          — so switching to Album paints from cache. Additive; never changes what any tile renders. */}
      <ThumbPrefetchLinks ids={albumWarmIds} />
      <div className={styles.container}>
        {/* Header (ADR-0025 Inc 2): CollapsingHeader OWNS the <header> so it can make the whole header
            sticky + collapse-on-scroll on a phone (desktop renders it byte-for-byte as before). It wraps
            the family name + the tabs row. */}
        <CollapsingHeader familyName={familyName}>
          {/* Tabs row (ADR-0025): HubPrimaryNav renders the top pill row on desktop and swaps to a fixed
              BottomTabBar on a phone (mobile-only, via useIsCompact) — it owns `styles.tabsRow` itself so
              the compact branch leaves no empty bordered gap here. On desktop it also renders the
              account avatar at the row's right end (#234), fed by the SAME single loadAccountMenu call
              above that feeds the phone bottom bar. */}
          <HubPrimaryNav
            primaryTabs={primaryTabs}
            active={primaryActive}
            familiesParam={familiesRaw}
            account={{
              initials: accountMenu.initials,
              viewerName: accountMenu.viewerName,
              items: accountMenu.items,
              clerkSignOut: accountMenu.clerkSignOut,
            }}
          />
        </CollapsingHeader>

        {/* Tab content */}
        <section className={styles.tabContent}>
          <PendingInvitesBanner matches={pendingInviteMatches} />
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
              intakeIncomplete={intakeIncomplete}
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
            <QuestionsSubNav
              active={activeTab}
              familiesParam={familiesRaw}
              // #142: badge the "To answer" sub-link with the pending-ask count — the same count the
              // top-level Questions primary tab already carries (listPendingAsksForNarrator).
              toAnswerBadge={pendingAsks.length}
            />
          )}
          {/* #158/#297: family + requests share one primary tab (Family), fronted by the progressive
              control row. RequestsTab and FamilyTab each own their progressive row (chips fold in).
              On the no-family case FamilyTab is not mounted, so FamilySurfaceNav renders HERE (Sub
              tabs + Invite only). Never also render a copy above FamilyTab/RequestsTab. */}
          {showFamilySelector &&
            activeTab !== "requests" &&
            !(activeTab === "family" && familyTabData) && (
            <FamilySurfaceNav
              active={familySelectorActive}
              familiesParam={familiesRaw}
              showRequests={showRequestsItem}
              requestsBadge={pendingRequests.length}
              invite={familyInvite}
            />
          )}
          {activeTab === "questions" && <QuestionsTab asks={pendingAsks} draftsByAskId={draftsByAskId} />}
          {activeTab === "ask" && (
            <AskTab
              families={activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName, shortName: f.familyShortName }))}
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
              {familyTabData ? (
              <FamilyTab
                familyId={familyTabData.familyId}
                focusPersonId={familyTabData.focusPersonId}
                viewerPersonId={ctx.personId}
                tree={familyTabData.tree}
                listPeople={familyTabData.listPeople}
                // #158: the Tree/List choice is URL-driven now (?view=), resolved here and rendered by
                // FamilyTab; the selector itself lives in <FamilySurfaceNav> above.
                view={familyView}
                // #161/ADR-0023 + #283: unplaced members surface on Tree only (List is browse-only).
                unplaced={familyTabData.unplaced}
                viewerIsSteward={familyTabData.viewerIsSteward}
                // #254 / #283: governable edges for Tree PersonDetails — not List.
                governableEdges={familyTabData.governableEdges}
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
                // #189: FamilyTab renders the FULL shared toolbar (R1 selector + Invite, R2 chips +
                // zoom). Thread R1's data through — the same values the standalone FamilySurfaceNav gets
                // on the Requests / no-family path. `active` is the resolved tree/list view here.
                surface={{
                  active: familyView,
                  familiesParam: familiesRaw,
                  showRequests: showRequestsItem,
                  requestsBadge: pendingRequests.length,
                  invite: familyInvite,
                }}
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
              families={
                activeFamilies.length >= 2
                  ? activeFamilies.map((f) => ({
                      id: f.familyId,
                      name: f.familyName,
                      shortName: f.familyShortName,
                    }))
                  : []
              }
              // #159: the Requests list scopes to the SAME resolved family the tree uses (`?families=`),
              // defaulting to the first active family when the filter is absent (never "all" for a steward).
              scopeFamilyId={familyTabFamilyId ?? "all"}
              surface={{
                familiesParam: familiesRaw,
                showRequests: showRequestsItem,
                requestsBadge: pendingRequests.length,
                invite: familyInvite,
              }}
            />
          )}
        </section>
      </div>
    </main>
  );
}
