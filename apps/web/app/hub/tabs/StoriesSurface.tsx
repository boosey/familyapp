"use client";

/**
 * StoriesSurface (#301) — Stories tab owner of the progressive hub control row.
 *
 * One control row on every width: Sub tabs (Feed / Timeline) → Family → Search → Views, with Tell on
 * the trailing edge outside collapse. Expansion comes from {@link resolveHubControlExpansion} via
 * {@link HubProgressiveControlRow}. Collapsed Search is Search (not Filter). No Filters unit. No
 * binary HubToolbar vs compact-strip swap. Family/Questions share this primitive (#297).
 *
 * State owned here (unchanged from #190):
 *  - `mode` (Feed/Timeline) — seeded from `?mode=`, then local
 *  - `query` — persistent Search; non-empty replaces feed/timeline body
 *  - `feedView` (Masonry/Column) — Feed mode only; localStorage
 *  - `expanded` — draft-reminder resume list toggle
 */
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { hub } from "@/app/_copy";
import { relativeShortDate } from "@/lib/relative-time";
import { History, LayoutGrid, Newspaper, Search, SquarePen, UsersRound } from "lucide-react";
import { HubProgressiveControlRow } from "../HubProgressiveControlRow";
import { IconSheet } from "../IconSheet";
import { ICON_SHEET_GLYPH_SIZE } from "../icon-sheet-constants";
import { HUB_SUB_TABS_GLYPH_SIZE } from "../hub-progressive-control-constants";
import { HubSubNav, type HubSubNavItem } from "../HubSubNav";
import { SubTabsMenu } from "../SubTabsMenu";
import { SegmentedControl } from "@/app/_kindred/SegmentedControl";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { SearchField } from "@/app/_kindred/SearchField";
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
   * The active families driving the Family unit. Mounted only for ≥2 families (one family has nothing
   * to filter); FamilyChips also self-renders null under that count.
   */
  activeFamilies: ViewerFamily[];
  /** The chips' selected value: "all" (every chip ON) or the concrete selected-id set. */
  chipSelected: string[] | "all";
  /** The viewer's own ask-less drafts still in review — reminder + resume list. */
  selfDrafts: SelfDraft[];
  /** #138: whether the biographical intake is incomplete — compact intake reminder. */
  intakeIncomplete: boolean;
  /**
   * Which body to render below the control row:
   *  - "none"  → honest all-off empty state (filter=none); Family chips stay so a family can turn on.
   *  - "empty" → no in-scope stories; `emptyCopy` picks pending-vs-generic.
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
  // `useSearchParams()` can be null during SSR / static generation (no router context) — guard the read.
  const searchParams = useSearchParams();

  const modeParam = searchParams?.get("mode") ?? null;
  const initialMode: BrowseMode = BROWSE_MODES.includes(modeParam as BrowseMode)
    ? (modeParam as BrowseMode)
    : "feed";
  const [mode, setMode] = useState<BrowseMode>(initialMode);
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";

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

  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const hasDrafts = selfDrafts.length > 0;
  const browsing = body === "browse";

  const modeItemsLabeled: HubSubNavItem[] = BROWSE_MODES.map((m) => ({
    key: m,
    label: m === "feed" ? hub.browse.modeFeed : hub.browse.modeTimeline,
  }));
  const modeItemsIconPills: HubSubNavItem[] = BROWSE_MODES.map((m) => ({
    key: m,
    ariaLabel: m === "feed" ? hub.mobileControls.modeFeedAria : hub.mobileControls.modeTimelineAria,
    label:
      m === "feed" ? (
        <Newspaper size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />
      ) : (
        <History size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />
      ),
  }));
  const modeMenuItems = BROWSE_MODES.map((m) => ({
    key: m,
    label: m === "feed" ? hub.browse.modeFeed : hub.browse.modeTimeline,
  }));

  const subTabsLabeled = browsing ? (
    <HubSubNav
      layout="intrinsic"
      ariaLabel={hub.shell.tabStories}
      items={modeItemsLabeled}
      active={mode}
      onSelect={(k) => setMode(k as BrowseMode)}
    />
  ) : null;
  const subTabsIconPills = browsing ? (
    <HubSubNav
      layout="intrinsic"
      ariaLabel={hub.shell.tabStories}
      items={modeItemsIconPills}
      active={mode}
      onSelect={(k) => setMode(k as BrowseMode)}
    />
  ) : null;
  const subTabsMenu = browsing ? (
    <SubTabsMenu
      items={modeMenuItems}
      active={mode}
      onSelect={(k) => setMode(k as BrowseMode)}
    />
  ) : null;

  const chipsFiltered =
    activeFamilies.length >= 2 &&
    chipSelected !== "all" &&
    chipSelected.length !== activeFamilies.length;
  const searchActive = searching;

  const familyExpanded =
    activeFamilies.length >= 2 ? (
      <FamilyChips inline families={activeFamilies} selected={chipSelected} />
    ) : null;
  const familyCollapsed =
    activeFamilies.length >= 2 ? (
      <IconSheet
        icon={UsersRound}
        label={hub.mobileControls.familyLabel}
        sheetTitle={hub.mobileControls.familyLabel}
        badgeCount={chipsFiltered ? 1 : 0}
      >
        <FamilyChips inline families={activeFamilies} selected={chipSelected} />
      </IconSheet>
    ) : null;

  const searchExpanded = browsing ? (
    <SearchField
      value={query}
      onChange={setQuery}
      placeholder={hub.browse.searchPlaceholder}
      ariaLabel={hub.browse.searchPlaceholder}
    />
  ) : null;
  const searchCollapsed = browsing ? (
    <IconSheet
      icon={Search}
      label={hub.mobileControls.searchLabel}
      sheetTitle={hub.mobileControls.searchLabel}
      badgeCount={searchActive ? 1 : 0}
    >
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={hub.browse.searchPlaceholder}
        ariaLabel={hub.browse.searchPlaceholder}
      />
    </IconSheet>
  ) : null;

  const viewExpanded =
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
  const viewCollapsed = viewExpanded ? (
    <IconSheet
      icon={LayoutGrid}
      label={hub.mobileControls.viewLabel}
      sheetTitle={hub.mobileControls.viewLabel}
    >
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
    </IconSheet>
  ) : null;

  const reminders =
    hasDrafts || intakeIncomplete ? (
      <>
        {hasDrafts ? (
          <button
            type="button"
            className={styles.reminderButton}
            aria-expanded={expanded}
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
      </>
    ) : null;

  const tellLabeled = <ActionButton href="/hub/tell">{hub.stories.tellTitle}</ActionButton>;
  const tellIconified = (
    <ActionButton href="/hub/tell" aria-label={hub.mobileControls.tellAria}>
      <SquarePen size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
    </ActionButton>
  );

  return (
    <div className={styles.wrap}>
      <HubProgressiveControlRow
        subTabs={
          subTabsLabeled && subTabsIconPills && subTabsMenu
            ? {
                labeled: subTabsLabeled,
                iconPills: subTabsIconPills,
                menuIcon: subTabsMenu,
              }
            : undefined
        }
        family={
          familyExpanded && familyCollapsed
            ? { expanded: familyExpanded, collapsed: familyCollapsed }
            : undefined
        }
        search={
          searchExpanded && searchCollapsed
            ? { expanded: searchExpanded, collapsed: searchCollapsed }
            : undefined
        }
        views={
          viewExpanded && viewCollapsed
            ? { expanded: viewExpanded, collapsed: viewCollapsed }
            : undefined
        }
        action={{
          labeled: tellLabeled,
          iconified: tellIconified,
        }}
        belowRow={reminders}
      />

      {hasDrafts && expanded ? (
        <ul id={listId} className={styles.resumeList}>
          {selfDrafts.map((d) => (
            <li key={d.storyId} className={styles.resumeItem}>
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
