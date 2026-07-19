"use client";

/**
 * StoriesSurface (#190) — the Stories tab's client owner of the shared two-row {@link HubToolbar}.
 * It replaces the old split of a server "control row" (StoriesControls) plus the browse body's own
 * inline "view options" row: everything top-of-tab now lives in ONE toolbar, and this component owns
 * the client state that drives it.
 *
 *   R1:  [Feed / Timeline pills] [search field]  ·······  [reminders + Tell a story]
 *   R2:  [Family selector chips]                  ·······  [Masonry / Column]
 *
 * State owned here (was scattered across StoryBrowse + StoriesControls before #190):
 *  - `mode` (Feed/Timeline) — the R1-left pill toggle; seeded from `?mode=` so the Read view's Back can
 *    restore it, then local for instant switching.
 *  - `query` — the persistent R1-left Search field; a non-empty query replaces the feed/timeline body
 *    with results (#3), so Search is no longer a mode. Threaded to the browse body.
 *  - `feedView` (Masonry/Column) — the R2-right selector (Feed mode only); persisted to localStorage.
 *  - `expanded` — the draft-reminder's in-place resume list toggle.
 *
 * The family chips (R2-left) and the reminders + Tell cluster (R1-right) are still gated exactly as
 * before, and every "is this slot empty?" decision is computed HERE (not guessed by the toolbar) so
 * HubToolbar's empty-row rule fires: a mode with no view selector + a <2-family viewer collapses R2
 * entirely, and the toolbar keeps the content below flush.
 *
 * All authorization already happened upstream (StoriesTab → loadHubFeed → listStoriesForViewer); this
 * only renders + narrows what the server producer handed down.
 */
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { hub } from "@/app/_copy";
import { relativeShortDate } from "@/lib/relative-time";
import { HubToolbar } from "../HubToolbar";
import { HubSubNav, type HubSubNavItem } from "../HubSubNav";
import { SegmentedControl } from "@/app/_kindred/SegmentedControl";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { FamilyChips } from "../FamilyChips";
import { StoryBrowse } from "./StoryBrowse";
import {
  BROWSE_MODES,
  FEED_VIEW_KEY,
  isFeedView,
  type BrowseMode,
  type FeedView,
} from "./stories-browse-controls";
import type { SelfDraft, StoryItem, ViewerFamily } from "./story-browse-types";
import browseStyles from "./StoryBrowse.module.css";
import styles from "./StoriesTab.module.css";

export interface StoriesSurfaceProps {
  /** The deduped, authorized, pre-sorted browse pool (empty when there are no in-scope stories). */
  items: StoryItem[];
  viewerFamilies: ViewerFamily[];
  viewerPersonId: string;
  viewerName: string;
  /** Selected family ids for `?families=` (ADR-0021); a story shows when ANY of its families is in it. */
  selectedIds: string[];
  /** Whether the filter is "all" (every active family selected). */
  allSelected: boolean;
  /**
   * The active families driving the R2-left chip bar. The chip bar mounts only for ≥2 families (one
   * family has nothing to filter); FamilyChips also self-renders null under that count, but the MOUNT is
   * gated here too so the toolbar's empty-row rule can see R2-left as truly empty.
   */
  activeFamilies: ViewerFamily[];
  /** The chips' selected value: "all" (every chip ON) or the concrete selected-id set. */
  chipSelected: string[] | "all";
  /** The viewer's own ask-less drafts still in review — the R1-right reminder + resume list. */
  selfDrafts: SelfDraft[];
  /** #138: whether the biographical intake is incomplete — the compact intake reminder in R1-right. */
  intakeIncomplete: boolean;
  /**
   * Which body to render below the toolbar:
   *  - "none"  → the honest all-off empty state (filter=none): the toolbar (esp. the family chips) stays
   *              so the viewer can turn a family back on.
   *  - "empty" → no in-scope stories: a welcoming empty note; `emptyCopy` picks pending-vs-generic.
   *  - "browse"→ the StoryBrowse feed/timeline/search body.
   */
  body: "none" | "empty" | "browse";
  /** Empty-state note copy (only read when `body === "empty"`). */
  emptyCopy: string;
}

export function StoriesSurface({
  items,
  viewerFamilies,
  viewerPersonId,
  viewerName,
  selectedIds,
  allSelected,
  activeFamilies,
  chipSelected,
  selfDrafts,
  intakeIncomplete,
  body,
  emptyCopy,
}: StoriesSurfaceProps) {
  // `useSearchParams()` can be null during SSR / static generation (no router context) — guard the read
  // so a server/static render of an empty-state body doesn't throw (mirrors FamilyChips' null handling).
  const searchParams = useSearchParams();

  // Initial mode from the URL (?mode=) so the Read view's Back can restore it; then local state for
  // instant, no-server-roundtrip switching.
  const modeParam = searchParams?.get("mode") ?? null;
  const initialMode: BrowseMode = BROWSE_MODES.includes(modeParam as BrowseMode)
    ? (modeParam as BrowseMode)
    : "feed";
  const [mode, setMode] = useState<BrowseMode>(initialMode);
  const [query, setQuery] = useState("");
  // A non-empty query REPLACES the feed/timeline body with search results (#3): the search field is
  // persistent (always beside the pills while browsing), not a mode. This flag also hides the
  // Masonry/Column selector while searching — the feed body it steers isn't on screen.
  const searching = query.trim() !== "";

  // Feed layout (Feed mode only). SSR-safe default ("masonry" — the new-viewer default per ADR-0021);
  // a stored preference is hydrated in a client-only effect so it wins without a hydration mismatch.
  const [feedView, setFeedView] = useState<FeedView>("masonry");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FEED_VIEW_KEY);
      if (isFeedView(stored)) setFeedView(stored);
    } catch {
      /* localStorage unavailable — keep the default. */
    }
  }, []);
  function changeFeedView(v: FeedView) {
    setFeedView(v);
    try {
      window.localStorage.setItem(FEED_VIEW_KEY, v);
    } catch {
      /* ignore persistence failure */
    }
  }

  // Draft-reminder in-place resume list toggle.
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const hasDrafts = selfDrafts.length > 0;

  const browsing = body === "browse";

  /* ── R1-left: the mode pills (shared HubSubNav) + the persistent Search field ─────────────────── */
  // The pills + field only steer the browse body — hide them in the empty states (no body to steer),
  // matching the old behaviour where the mode toggle lived inside StoryBrowse (present only when browsing).
  const modeItems: HubSubNavItem[] = BROWSE_MODES.map((m) => ({
    key: m,
    label: m === "feed" ? hub.browse.modeFeed : hub.browse.modeTimeline,
  }));
  const modeNav = browsing ? (
    <HubSubNav ariaLabel={hub.shell.tabStories} items={modeItems} active={mode} onSelect={(k) => setMode(k as BrowseMode)} />
  ) : null;
  // Persistent search field (#3): always beside the pills while browsing; a non-empty query replaces
  // the feed/timeline body with results (handled in StoryBrowse), so it is no longer a mode.
  const searchField =
    browsing ? (
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={hub.browse.searchPlaceholder}
        aria-label={hub.browse.searchPlaceholder}
        className={browseStyles.searchInput}
      />
    ) : null;
  const row1Left =
    modeNav || searchField ? (
      <div className={styles.modeGroup}>
        {modeNav}
        {searchField}
      </div>
    ) : null;

  /* ── R1-right: draft + intake reminders, then the Tell-a-story button ─────────────────────────── */
  const row1Right = (
    <div className={styles.actionsCluster}>
      {hasDrafts ? (
        <button
          type="button"
          className={styles.reminderButton}
          aria-expanded={expanded}
          // Point aria-controls at the list only once it's rendered — a dangling ref is an a11y bug.
          aria-controls={expanded ? listId : undefined}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className={styles.reminderTop}>{hub.stories.draftReminder(selfDrafts.length)}</span>
          <span className={styles.reminderAction}>{hub.stories.draftReminderAction}</span>
        </button>
      ) : null}

      {intakeIncomplete ? (
        <Link href="/hub/about-you" className={styles.reminderButton} aria-label={hub.intake.aria}>
          <span className={styles.reminderTop}>{hub.intake.reminderTop}</span>
          <span className={styles.reminderAction}>{hub.intake.reminderAction}</span>
        </Link>
      ) : null}

      <ActionButton href="/hub/tell">{hub.stories.tellTitle}</ActionButton>
    </div>
  );

  /* ── R2-left: the family selector chips (≥2 families only) ─────────────────────────────────────── */
  const familyChips =
    activeFamilies.length >= 2 ? (
      <FamilyChips inline families={activeFamilies} selected={chipSelected} />
    ) : null;

  /* ── R2-right: the Masonry/Column feed-view selector (Feed mode, not while searching) ──────────── */
  const viewSelector =
    browsing && mode === "feed" && !searching ? (
      <SegmentedControl
        variant="radio"
        ariaLabel={hub.browse.viewSelectorAria}
        active={feedView}
        onSelect={(k) => changeFeedView(k as FeedView)}
        items={[
          { key: "masonry", label: hub.browse.viewMasonry },
          { key: "column", label: hub.browse.viewColumn },
        ]}
      />
    ) : null;

  return (
    <div className={styles.wrap}>
      <HubToolbar row1Left={row1Left} row1Right={row1Right} row2Left={familyChips} row2Right={viewSelector} />

      {/* Resume: the viewer's own ask-less drafts still in review, revealed by the draft reminder. Each
          links to /hub/tell/[storyId]. Full-width BELOW the toolbar (not inside a toolbar slot). */}
      {hasDrafts && expanded ? (
        <ul id={listId} className={styles.resumeList}>
          {selfDrafts.map((d) => (
            <li key={d.storyId} className={styles.resumeItem}>
              {/* Per-draft date meta id so each identical "Finish" link is distinguishable to a screen
                  reader (WCAG 2.4.4 — link purpose from its accessible description). */}
              <span id={`meta-${d.storyId}`} className={styles.resumeMeta}>
                {hub.questions.recordedAt(relativeShortDate(d.recordedAt))}
              </span>
              <Link
                href={`/hub/tell/${d.storyId}`}
                className={styles.resumeLink}
                aria-describedby={`meta-${d.storyId}`}
              >
                {hub.stories.resume}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {body === "none" ? (
        // Explicit empty selection (ADR-0021): every chip toggled OFF is an honest empty state — no
        // browse pool — rather than a silent "show all". The chip bar stays (above) so the viewer can
        // turn a family back on. Mirrors AlbumSurface's `none` short-circuit.
        <p className={styles.emptyText}>{hub.stories.noFamiliesSelected}</p>
      ) : body === "empty" ? (
        <p className={styles.emptyTextMuted}>{emptyCopy}</p>
      ) : (
        <StoryBrowse
          items={items}
          viewerFamilies={viewerFamilies}
          viewerPersonId={viewerPersonId}
          viewerName={viewerName}
          selectedIds={selectedIds}
          allSelected={allSelected}
          mode={mode}
          feedView={feedView}
          query={query}
        />
      )}
    </div>
  );
}
