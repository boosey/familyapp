"use client";

/**
 * Story Browse (Hub) — the Stories tab, rebuilt in place as three modes of one surface (Feed /
 * Timeline / Search) plus a reusable family-scope filter. Faithful to
 * docs/design-system/.../HANDOFF-browse-and-family-flows.md ("Prototype 1 — Story Browse (Hub)").
 *
 * Everything here is CLIENT-SIDE over an already-authorized, pre-sorted pool (`items`): every item
 * passed authorization in the server producer (StoriesTab → loadHubFeed → listStoriesForViewer);
 * filtering only narrows what is displayed. Cards open the Read view via the existing
 * /hub/stories/[id] route (restyled separately). Reading size is owned by the hub header's
 * KindredFontScale — not duplicated here.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { hub } from "@/app/_copy";
import { TellStoryCard } from "./TellStoryCard";
import { StoryCard } from "./StoryCard";
import type { StoryItem, ViewerFamily } from "./story-browse-types";
import {
  groupByDecade,
  highlightMatch,
  matchesQuery,
  timelineBase,
} from "./story-browse-helpers";

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
   * navigation) mounted by StoriesTab; this surface no longer owns a family-scope control. The empty
   * selection (`none`) never reaches here — StoriesTab short-circuits it to an empty state upstream.
   */
  selectedIds: string[];
  /**
   * Whether the filter is "all" (every active family selected) — show the whole deduped pool without
   * narrowing. Distinct from `selectedIds` naming every id, and drives the Feed empty-state copy.
   */
  allSelected: boolean;
}

type Mode = "feed" | "timeline" | "search";

const MODES: Mode[] = ["feed", "timeline", "search"];

/** Feed layout (Feed mode only): today's single-column stacked cards, or a masonry of cards. */
type FeedView = "column" | "masonry";

const FEED_VIEW_KEY = "hub:feedView";

function isFeedView(v: string | null): v is FeedView {
  return v === "column" || v === "masonry";
}

export function StoryBrowse({ items, viewerFamilies, viewerPersonId, viewerName, selectedIds, allSelected }: StoryBrowseProps) {
  const searchParams = useSearchParams();

  // Initial mode comes from the URL (?mode=) so the Read view's Back can restore it; thereafter it is
  // local state for instant, no-server-roundtrip switching. Family filter is NOT local — it is the
  // controlled `selectedIds`/`allSelected` props, driven by the chip bar (a server navigation).
  const initialMode: Mode = MODES.includes(searchParams.get("mode") as Mode)
    ? (searchParams.get("mode") as Mode)
    : "feed";

  const [mode, setMode] = useState<Mode>(initialMode);
  // Timeline: default "Whole family" (all in-scope stories by era); toggle to "Just {viewer}".
  const [wholeFamily, setWholeFamily] = useState(true);
  const [query, setQuery] = useState("");

  // Feed layout (Feed mode only). Start at the SSR-safe default ("masonry" — the new-viewer default
  // per ADR-0021) and hydrate the persisted choice in a client-only effect, so a stored preference
  // still wins and the choice survives navigation/reload without a hydration mismatch (the SSR default
  // and the client's first render agree; the effect only *overrides* when localStorage has a value).
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

  const href = (item: StoryItem) => `${item.href}?from=${mode}`;

  return (
    <div>
      {/* Sub-nav: browse modes only. Family scope is owned by the hub header selector now — this
          surface no longer renders a duplicate per-family control. */}
      <div style={subnavRow}>
        <div style={segmentGroup} role="tablist" aria-label={hub.shell.tabStories}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              style={modePill(mode === m)}
            >
              {m === "feed"
                ? hub.browse.modeFeed
                : m === "timeline"
                  ? hub.browse.modeTimeline
                  : hub.browse.modeSearch}
            </button>
          ))}
        </div>

        {/* Feed layout toggle — right-justified on the same row as the mode pills. Only shown in Feed
            mode (Timeline and Search own their own layouts; Column/Masonry only describe the card feed). */}
        {mode === "feed" ? (
          <div style={segmentGroup} role="radiogroup" aria-label={hub.browse.viewSelectorAria}>
            {(["masonry", "column"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={feedView === v}
                onClick={() => changeFeedView(v)}
                style={modePill(feedView === v)}
              >
                {v === "column" ? hub.browse.viewColumn : hub.browse.viewMasonry}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 24 }}>
        {mode === "feed" ? (
          <Feed
            items={scoped}
            allSelected={allSelected}
            selectedIds={selectedIds}
            viewerFamilies={viewerFamilies}
            href={href}
            view={feedView}
          />
        ) : null}
        {mode === "timeline" ? (
          <Timeline
            items={scoped}
            wholeFamily={wholeFamily}
            onWiden={setWholeFamily}
            viewerPersonId={viewerPersonId}
            viewerName={viewerName}
            href={href}
          />
        ) : null}
        {mode === "search" ? (
          <Search items={scoped} query={query} onQuery={setQuery} href={href} />
        ) : null}
      </div>
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
  // The "Tell a story" CTA leads the feed as its first item (both layouts) and the empty state below.
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
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <TellStoryCard />
        <div style={emptyCard}>
          <span style={{ fontSize: 40 }} aria-hidden="true">
            📖
          </span>
          <p style={emptyHeadline}>{hub.browse.feedEmpty(scopeName)}</p>
          <p style={emptySub}>{hub.browse.feedEmptySub}</p>
        </div>
      </div>
    );
  }

  // Masonry — CSS multi-column of vertical cards, each kept whole across columns; column width sets
  // how many columns fit. Column view is today's single stacked column of wide horizontal cards. The
  // Tell-a-story CTA is the first cell/card in either layout.
  if (view === "masonry") {
    // The first cover-bearing item leads the masonry feed as a wider hero (`feature` variant).
    const featureIndex = items.findIndex((it) => Boolean(it.coverPhotoId));
    return (
      <div style={{ columnWidth: 320, columnGap: 18 }} data-view="masonry">
        <TellStoryCard masonry />
        {items.map((item, i) => (
          <StoryCard
            key={item.id}
            item={item}
            href={href(item)}
            index={i}
            masonry
            variant={i === featureIndex ? "feature" : "feed"}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }} data-view="column">
      <TellStoryCard />
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
      <div style={timelineHeaderRow}>
        <h2 style={timelineHeading}>{heading}</h2>
        <div style={segmentGroup} role="group" aria-label={heading}>
          <button
            type="button"
            aria-pressed={wholeFamily}
            onClick={() => onWiden(true)}
            style={modePill(wholeFamily)}
          >
            {hub.browse.widenWhole}
          </button>
          <button
            type="button"
            aria-pressed={!wholeFamily}
            onClick={() => onWiden(false)}
            style={modePill(!wholeFamily)}
          >
            {hub.browse.widenNarrator(viewerName)}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        {groups.map((group) => (
          <section key={group.label}>
            <div style={groupLabelRow}>
              <span style={{ ...monoGroupLabel, color: "var(--accent)" }}>{group.label}</span>
              <span style={hairline} aria-hidden="true" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {group.items.map((item) => (
                <TimelineRow key={item.id} item={item} href={href(item)} year={String(item.eraYear)} />
              ))}
            </div>
          </section>
        ))}

        {/* Undated section — always shown, never hidden (design invariant). */}
        <section>
          <div style={groupLabelRow}>
            <span style={{ ...monoGroupLabel, color: "var(--support)" }}>{hub.browse.undated}</span>
            <span style={hairline} aria-hidden="true" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {undated.map((item) => (
              <TimelineRow key={item.id} item={item} href={href(item)} year="· · ·" undated />
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
    <Link href={href} style={undated ? timelineRowUndated : timelineRow}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-label)", color: "var(--support)", flex: "0 0 70px" }}>
        {year}
      </span>
      <span style={timelineRowTitle}>{item.title}</span>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-label)", color: "var(--text-meta)", flex: "0 0 auto" }}>
        {item.personName}
      </span>
    </Link>
  );
}

/* ── Search ───────────────────────────────────────────────────────────────────── */
function Search({
  items,
  query,
  onQuery,
  href,
}: {
  items: StoryItem[];
  query: string;
  onQuery: (v: string) => void;
  href: (item: StoryItem) => string;
}) {
  const trimmed = query.trim();
  const results = useMemo(
    () => (trimmed ? items.filter((it) => matchesQuery(it, trimmed)) : []),
    [items, trimmed],
  );

  return (
    <div style={{ maxWidth: 760 }}>
      <input
        type="text"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={hub.browse.searchPlaceholder}
        aria-label={hub.browse.searchPlaceholder}
        style={searchInput}
      />

      {!trimmed ? (
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-muted)", margin: "20px 0 0" }}>
          {hub.browse.searchIdle}
        </p>
      ) : results.length === 0 ? (
        <div style={searchNoResultsCard}>
          <span style={{ fontSize: 32 }} aria-hidden="true">
            🔎
          </span>
          <p style={{ fontFamily: "var(--font-story)", fontSize: "var(--text-ui-sm)", color: "var(--text-body)", margin: 0 }}>
            {hub.browse.searchNoResults(trimmed)}
          </p>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-label)", color: "var(--text-muted)", margin: 0 }}>
            {hub.browse.searchNoResultsHint}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-label)", letterSpacing: "var(--tracking-mono)", color: "var(--support)" }}>
            {hub.browse.searchCount(results.length)}
          </div>
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
    <Link href={href} style={searchResultCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-story)", fontSize: "var(--text-story)", color: "var(--text-body)" }}>
          {item.title}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-label)", color: "var(--support)" }}>
          {item.eventLabel ?? hub.browse.undated}
        </span>
      </div>
      {item.summary ? (
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-label)", lineHeight: "var(--leading-body)", color: "var(--text-muted)", margin: 0 }}>
          {hit ? (
            <>
              {hit.before}
              <span style={highlightSpan}>{hit.match}</span>
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

/* ── Shared styles ──────────────────────────────────────────────────────────────── */
const subnavRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const segmentGroup: CSSProperties = {
  display: "inline-flex",
  gap: 4,
  background: "var(--surface-sunken)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-pill)",
  padding: 4,
};

function modePill(on: boolean): CSSProperties {
  return {
    padding: "10px 22px",
    border: "none",
    cursor: "pointer",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    whiteSpace: "nowrap",
    background: on ? "var(--surface-card)" : "transparent",
    color: on ? "var(--accent-strong)" : "var(--text-muted)",
    boxShadow: on ? "var(--shadow-sm)" : "none",
  };
}

const emptyCard: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 16,
  padding: "80px 40px",
  background: "var(--surface-card)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-xl)",
};

const emptyHeadline: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontWeight: 400,
  fontSize: "var(--text-story-lg)",
  lineHeight: "var(--leading-snug)",
  color: "var(--text-body)",
  margin: 0,
  maxWidth: "28ch",
};

const emptySub: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  lineHeight: "var(--leading-body)",
  color: "var(--text-muted)",
  margin: 0,
  maxWidth: "36ch",
};

const timelineHeaderRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 22,
};

const timelineHeading: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontWeight: 400,
  fontSize: "var(--text-story-lg)",
  color: "var(--text-body)",
  margin: 0,
};

const groupLabelRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  marginBottom: 14,
};

const monoGroupLabel: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

const hairline: CSSProperties = {
  flex: 1,
  height: 1,
  background: "var(--border)",
};

const timelineRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 18,
  width: "100%",
  textAlign: "left",
  textDecoration: "none",
  cursor: "pointer",
  background: "var(--surface-card)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "16px 20px",
};

const timelineRowUndated: CSSProperties = {
  ...timelineRow,
  background: "var(--surface-sunken)",
  border: "var(--border-width) dashed var(--border-strong)",
};

const timelineRowTitle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: "var(--font-story)",
  fontSize: "var(--text-story)",
  color: "var(--text-body)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const searchInput: CSSProperties = {
  width: "100%",
  padding: "16px 20px",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui)",
  color: "var(--text-body)",
  background: "var(--surface-card)",
  border: "var(--border-width) solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  outline: "none",
};

const searchNoResultsCard: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 12,
  padding: "60px 30px",
  marginTop: 20,
  background: "var(--surface-card)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-lg)",
};

const searchResultCard: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: "100%",
  textAlign: "left",
  textDecoration: "none",
  cursor: "pointer",
  background: "var(--surface-card)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "18px 22px",
};

const highlightSpan: CSSProperties = {
  background: "var(--accent-soft)",
  color: "var(--accent-strong)",
  fontWeight: 600,
  borderRadius: 3,
  padding: "0 2px",
};
