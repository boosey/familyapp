"use client";

/**
 * Story Browse (Hub) — the Stories tab body: a Feed / Timeline surface with a persistent Search field
 * (a non-empty query replaces whichever body is active) plus a reusable family-scope filter. Faithful to
 * docs/design-system/.../HANDOFF-browse-and-family-flows.md ("Prototype 1 — Story Browse (Hub)").
 *
 * Everything here is CLIENT-SIDE over an already-authorized, pre-sorted pool (`items`): every item
 * passed authorization in the server producer (StoriesTab → loadHubFeed → listStoriesForViewer);
 * filtering only narrows what is displayed. Cards open the Read view via the existing
 * /hub/stories/[id] route (restyled separately). Reading size is owned by the hub header's
 * KindredFontScale — not duplicated here.
 *
 * #190: the mode toggle (Feed/Timeline), the Search input, and the Masonry/Column feed-view selector
 * were HOISTED into the shared two-row {@link HubToolbar} (owned by the client {@link StoriesSurface}
 * wrapper). So `mode`, `query`, and `feedView` are now CONTROLLED props threaded down from that wrapper
 * — this component renders the search results when `query` is non-empty, else the active mode's body.
 * Only the
 * Timeline's own "Whole family / Just {viewer}" widen toggle stays local here (it's a per-body control,
 * not a top-of-tab one).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { hub } from "@/app/_copy";
import { SegmentedControl } from "@/app/_kindred/SegmentedControl";
import { StoryCard } from "./StoryCard";
import { pickStoryLayout } from "./story-layout";
import type { StoryItem, ViewerFamily } from "./story-browse-types";
import type { BrowseMode, FeedView } from "./stories-browse-controls";
import {
  groupByDecade,
  highlightMatch,
  matchesQuery,
  timelineBase,
} from "./story-browse-helpers";
import styles from "./StoryBrowse.module.css";

interface StoryBrowseProps {
  items: StoryItem[];
  viewerFamilies: ViewerFamily[];
  /** The viewer's person id — narrows the Timeline "Just {viewer}" view to their own stories. */
  viewerPersonId: string;
  /** The viewer's display name — labels the Timeline "Just {viewer}" toggle and heading. */
  viewerName: string;
  /**
   * The selected family ids for the shared `?families=` multi-select browse filter (ADR-0021, #47).
   * A story is shown when ANY of its families is in this set. CONTROLLED by the chip bar (a server
   * navigation) mounted by StoriesSurface; this surface no longer owns a family-scope control. The
   * empty selection (`none`) never reaches here — StoriesTab short-circuits it to an empty state.
   */
  selectedIds: string[];
  /**
   * Whether the filter is "all" (every active family selected) — show the whole deduped pool without
   * narrowing. Distinct from `selectedIds` naming every id, and drives the Feed empty-state copy.
   */
  allSelected: boolean;
  /** Active browse mode — CONTROLLED by StoriesSurface's toolbar pills (#190). */
  mode: BrowseMode;
  /** Feed layout — CONTROLLED by StoriesSurface's toolbar Masonry/Column selector (#190). */
  feedView: FeedView;
  /** Search query — CONTROLLED by StoriesSurface's toolbar search field (Search mode, #190). */
  query: string;
}

export function StoryBrowse({
  items,
  viewerFamilies,
  viewerPersonId,
  viewerName,
  selectedIds,
  allSelected,
  mode,
  feedView,
  query,
}: StoryBrowseProps) {
  // Timeline: default "Whole family" (all in-scope stories by era); toggle to "Just {viewer}". This is
  // the one browse control that stays local to the body (it's a per-timeline widen, not a tab-level one).
  const [wholeFamily, setWholeFamily] = useState(true);

  // Multi-select family narrowing over the authorized pool (ADR-0021, #47). "all" keeps everything;
  // otherwise a story is kept when ANY of its families is in the selected set (a story tagged to N of
  // the viewer's families matches whenever at least one of those N is selected). The selected set is
  // membership-tested via a Set for O(1) lookups.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const scoped = useMemo(
    () =>
      allSelected
        ? items
        : items.filter((it) => it.families.some((f) => selectedSet.has(f.id))),
    [items, allSelected, selectedSet],
  );

  // A non-empty query REPLACES the active feed/timeline body with search results (#3): search is a
  // persistent field now, not a mode. `from` records "search" so the Read view's Back returns correctly.
  const searching = query.trim() !== "";
  const href = (item: StoryItem) => `${item.href}?from=${searching ? "search" : mode}`;

  return (
    <div>
      {searching ? (
        <Search items={scoped} query={query} href={href} />
      ) : mode === "feed" ? (
        <Feed
          items={scoped}
          allSelected={allSelected}
          selectedIds={selectedIds}
          viewerFamilies={viewerFamilies}
          href={href}
          view={feedView}
        />
      ) : (
        <Timeline
          items={scoped}
          wholeFamily={wholeFamily}
          onWiden={setWholeFamily}
          viewerPersonId={viewerPersonId}
          viewerName={viewerName}
          href={href}
        />
      )}
    </div>
  );
}

/* ── Feed ─────────────────────────────────────────────────────────────────────── */
function Feed({
  items,
  allSelected,
  selectedIds,
  viewerFamilies,
  href,
  view,
}: {
  items: StoryItem[];
  allSelected: boolean;
  selectedIds: string[];
  viewerFamilies: ViewerFamily[];
  href: (item: StoryItem) => string;
  view: FeedView;
}) {
  if (items.length === 0) {
    // Multi-select empty-state copy (ADR-0021, #47): all families selected → "your families"; a single
    // family selected → "the {family} family"; a multi-family subset falls back to the generic "your
    // families" (naming several families inline is deferred — reuses the existing copy keys).
    const scopeName =
      allSelected || selectedIds.length !== 1
        ? hub.browse.scopeNameAll
        : hub.browse.scopeNameFamily(
            viewerFamilies.find((f) => f.id === selectedIds[0])?.name ?? "",
          );
    return (
      <div className={styles.column}>
        <div className={styles.emptyCard}>
          <span className={styles.emptyEmoji} aria-hidden="true">
            📖
          </span>
          <p className={styles.emptyHeadline}>{hub.browse.feedEmpty(scopeName)}</p>
          <p className={styles.emptySub}>{hub.browse.feedEmptySub}</p>
        </div>
      </div>
    );
  }

  // Masonry — CSS multi-column of vertical cards, each kept whole across columns; column width sets
  // how many columns fit. Column view is today's single stacked column of wide horizontal cards.
  if (view === "masonry") {
    return (
      <div className={styles.masonry} data-view="masonry">
        {items.map((item, i) => (
          <StoryCard
            key={item.id}
            item={item}
            href={href(item)}
            index={i}
            masonry
            // Deterministic per-story layout (photo-top / photo-left / wrap / collage / text-only) so
            // the masonry feed reads like an editorial scrapbook and never repeats the same tile.
            layout={pickStoryLayout(item)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.column} data-view="column">
      {items.map((item, i) => (
        <StoryCard key={item.id} item={item} href={href(item)} index={i} />
      ))}
    </div>
  );
}

/* ── Timeline ─────────────────────────────────────────────────────────────────── */
function Timeline({
  items,
  wholeFamily,
  onWiden,
  viewerPersonId,
  viewerName,
  href,
}: {
  items: StoryItem[];
  wholeFamily: boolean;
  onWiden: (v: boolean) => void;
  viewerPersonId: string;
  viewerName: string;
  href: (item: StoryItem) => string;
}) {
  const base = useMemo(
    () => timelineBase(items, wholeFamily, viewerPersonId),
    [items, wholeFamily, viewerPersonId],
  );
  const { groups, undated } = useMemo(() => groupByDecade(base), [base]);

  const heading = wholeFamily
    ? hub.browse.timelineHeadingWhole
    : hub.browse.timelineHeadingNarrator(viewerName);

  return (
    <div>
      <div className={styles.timelineHeaderRow}>
        <h2 className={styles.timelineHeading}>{heading}</h2>
        <SegmentedControl
          variant="toggle"
          ariaLabel={heading}
          active={wholeFamily ? "whole" : "narrator"}
          onSelect={(k) => onWiden(k === "whole")}
          items={[
            { key: "whole", label: hub.browse.widenWhole },
            { key: "narrator", label: hub.browse.widenNarrator(viewerName) },
          ]}
        />
      </div>

      <div className={styles.timelineGroups}>
        {groups.map((group) => (
          <section key={group.label}>
            <div className={styles.groupLabelRow}>
              <span className={`${styles.monoGroupLabel} ${styles.groupLabelEra}`}>{group.label}</span>
              <span className={styles.hairline} aria-hidden="true" />
            </div>
            <div className={styles.timelineRowList}>
              {group.items.map((item) => (
                <TimelineRow
                  key={item.id}
                  item={item}
                  href={href(item)}
                  year={item.occurredLabel ?? String(item.eraYear)}
                />
              ))}
            </div>
          </section>
        ))}

        {/* Undated section — always shown, never hidden (design invariant). */}
        <section>
          <div className={styles.groupLabelRow}>
            <span className={`${styles.monoGroupLabel} ${styles.groupLabelUndated}`}>{hub.browse.undated}</span>
            <span className={styles.hairline} aria-hidden="true" />
          </div>
          <div className={styles.timelineRowList}>
            {undated.map((item) => (
              <TimelineRow
                key={item.id}
                item={item}
                href={href(item)}
                year={item.occurredLabel ?? "· · ·"}
                undated
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function TimelineRow({
  item,
  href,
  year,
  undated = false,
}: {
  item: StoryItem;
  href: string;
  year: string;
  undated?: boolean;
}) {
  return (
    <Link
      href={href}
      className={undated ? `${styles.timelineRow} ${styles.timelineRowUndated}` : styles.timelineRow}
    >
      <span className={styles.timelineRowYear}>{year}</span>
      <span className={styles.timelineRowTitle}>{item.title}</span>
      <span className={styles.timelineRowPerson}>{item.personName}</span>
    </Link>
  );
}

/* ── Search ───────────────────────────────────────────────────────────────────── */
/** The Search BODY only — the query input itself was hoisted into the toolbar (StoriesSurface, #190),
 *  so this renders results / idle / no-results over the CONTROLLED `query`. */
function Search({
  items,
  query,
  href,
}: {
  items: StoryItem[];
  query: string;
  href: (item: StoryItem) => string;
}) {
  const trimmed = query.trim();
  const results = useMemo(
    () => (trimmed ? items.filter((it) => matchesQuery(it, trimmed)) : []),
    [items, trimmed],
  );

  return (
    <div className={styles.searchWrap}>
      {!trimmed ? (
        <p className={styles.searchIdle}>{hub.browse.searchIdle}</p>
      ) : results.length === 0 ? (
        <div className={styles.searchNoResultsCard}>
          <span className={styles.searchNoResultsEmoji} aria-hidden="true">
            🔎
          </span>
          <p className={styles.searchNoResultsText}>{hub.browse.searchNoResults(trimmed)}</p>
          <p className={styles.searchNoResultsHint}>{hub.browse.searchNoResultsHint}</p>
        </div>
      ) : (
        <div className={styles.searchResults}>
          <div className={styles.searchCount}>{hub.browse.searchCount(results.length)}</div>
          {results.map((item) => (
            <SearchResult key={item.id} item={item} href={href(item)} query={trimmed} />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResult({ item, href, query }: { item: StoryItem; href: string; query: string }) {
  const hit = highlightMatch(item.summary, query);
  return (
    <Link href={href} className={styles.searchResultCard}>
      <div className={styles.searchResultHead}>
        <span className={styles.searchResultTitle}>{item.title}</span>
        <span className={styles.searchResultEra}>
          {item.occurredLabel ?? item.eventLabel ?? hub.browse.undated}
        </span>
      </div>
      {item.summary ? (
        <p className={styles.searchResultSummary}>
          {hit ? (
            <>
              {hit.before}
              <span className={styles.highlightSpan}>{hit.match}</span>
              {hit.after}
            </>
          ) : (
            item.summary
          )}
        </p>
      ) : null}
    </Link>
  );
}

