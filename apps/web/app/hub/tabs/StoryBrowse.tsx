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
import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { hub, common } from "@/app/_copy";
import type { StoryItem, ViewerFamily } from "./story-browse-types";
import {
  groupByDecade,
  highlightMatch,
  initials,
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
}

type Mode = "feed" | "timeline" | "search";

const MODES: Mode[] = ["feed", "timeline", "search"];

export function StoryBrowse({ items, viewerFamilies, viewerPersonId, viewerName }: StoryBrowseProps) {
  const searchParams = useSearchParams();

  // Initial mode + scope come from the URL (?mode= / ?scope=) so the Read view's Back can restore
  // them; thereafter they are local state for instant, no-server-roundtrip switching.
  const initialMode: Mode = MODES.includes(searchParams.get("mode") as Mode)
    ? (searchParams.get("mode") as Mode)
    : "feed";
  const scopeParam = searchParams.get("scope");
  const initialScope =
    scopeParam && viewerFamilies.some((f) => f.id === scopeParam) ? scopeParam : "all";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [scope, setScope] = useState<string>(initialScope);
  // Timeline: default "Whole family" (all in-scope stories by era); toggle to "Just {viewer}".
  const [wholeFamily, setWholeFamily] = useState(true);
  const [query, setQuery] = useState("");

  // Family-scope narrowing over the authorized pool. "all" keeps everything.
  const scoped = useMemo(
    () =>
      scope === "all"
        ? items
        : items.filter((it) => it.families.some((f) => f.id === scope)),
    [items, scope],
  );

  const href = (item: StoryItem) => `${item.href}?from=${mode}&scope=${scope}`;

  return (
    <div>
      {/* Sub-nav: browse modes (left) + family scope (right). */}
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

        {viewerFamilies.length > 0 ? (
          <div style={segmentGroup} role="group" aria-label={hub.browse.scopeAll}>
            <button
              type="button"
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
              style={scopePill(scope === "all")}
            >
              {hub.browse.scopeAll}
            </button>
            {viewerFamilies.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={scope === f.id}
                onClick={() => setScope(f.id)}
                style={scopePill(scope === f.id)}
              >
                {f.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 24 }}>
        {mode === "feed" ? (
          <Feed items={scoped} scope={scope} viewerFamilies={viewerFamilies} href={href} />
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
  scope,
  viewerFamilies,
  href,
}: {
  items: StoryItem[];
  scope: string;
  viewerFamilies: ViewerFamily[];
  href: (item: StoryItem) => string;
}) {
  if (items.length === 0) {
    const scopeName =
      scope === "all"
        ? hub.browse.scopeNameAll
        : hub.browse.scopeNameFamily(
            viewerFamilies.find((f) => f.id === scope)?.name ?? "",
          );
    return (
      <div style={emptyCard}>
        <span style={{ fontSize: 40 }} aria-hidden="true">
          📖
        </span>
        <p style={emptyHeadline}>{hub.browse.feedEmpty(scopeName)}</p>
        <p style={emptySub}>{hub.browse.feedEmptySub}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {items.map((item) => (
        <FeedCard key={item.id} item={item} href={href(item)} />
      ))}
    </div>
  );
}

function FeedCard({ item, href }: { item: StoryItem; href: string }) {
  return (
    <Link href={href} style={feedCardStyle}>
      {item.isNew ? (
        <span style={newBadge}>
          <span style={newDot} aria-hidden="true" />
          {common.storyCard.badgeNew}
        </span>
      ) : null}

      {/* Striped photo placeholder — the one design-sanctioned literal-hex decoration. */}
      <div aria-hidden="true" style={photoPlaceholder} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={initialsCircle} aria-hidden="true">
            {initials(item.personName)}
          </span>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-label)", color: "var(--text-meta)" }}>
            {item.personName}
          </span>
          <span style={metaDot} aria-hidden="true" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-label)", color: "var(--support)" }}>
            {item.eventLabel ?? hub.browse.undated}
          </span>
        </div>

        <p style={cardTitle}>{item.title}</p>
        {item.summary ? <p style={cardSummary}>{item.summary}</p> : null}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {item.tags.map((tag) => (
            <span key={tag} style={contentTagPill}>
              {tag}
            </span>
          ))}
          {item.families.map((f) => (
            <span key={f.id} style={familyTagPill}>
              {f.name}
            </span>
          ))}
        </div>
      </div>
    </Link>
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

function scopePill(on: boolean): CSSProperties {
  return {
    padding: "10px 20px",
    border: "none",
    cursor: "pointer",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    whiteSpace: "nowrap",
    background: on ? "var(--accent-soft)" : "transparent",
    color: on ? "var(--accent-strong)" : "var(--text-muted)",
  };
}

const feedCardStyle: CSSProperties = {
  display: "flex",
  gap: 22,
  width: "100%",
  textAlign: "left",
  textDecoration: "none",
  cursor: "pointer",
  background: "var(--surface-card)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 22,
  boxShadow: "var(--shadow-card)",
  position: "relative",
};

const newBadge: CSSProperties = {
  position: "absolute",
  top: 16,
  right: 20,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--accent-strong)",
};

const newDot: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "var(--accent)",
};

const photoPlaceholder: CSSProperties = {
  flex: "0 0 auto",
  width: 120,
  height: 120,
  borderRadius: "var(--radius-md)",
  backgroundColor: "#E4D8C2",
  backgroundImage: "repeating-linear-gradient(135deg, #DCCFB6 0 12px, #E4D8C2 12px 24px)",
};

const initialsCircle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: "50%",
  background: "var(--accent-soft)",
  color: "var(--accent-strong)",
  fontFamily: "var(--font-story)",
  fontSize: 14,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
};

const metaDot: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: "50%",
  background: "var(--border-strong)",
  flex: "0 0 auto",
};

const cardTitle: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontWeight: 500,
  fontSize: "var(--text-story-lg)",
  lineHeight: "var(--leading-snug)",
  color: "var(--text-body)",
  margin: "10px 0 6px",
};

const cardSummary: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  lineHeight: "var(--leading-body)",
  color: "var(--text-muted)",
  margin: "0 0 14px",
  maxWidth: "60ch",
};

const contentTagPill: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-label)",
  fontWeight: 500,
  color: "var(--text-muted)",
  background: "transparent",
  border: "var(--border-width) solid var(--border-strong)",
  borderRadius: "var(--radius-pill)",
  padding: "5px 13px",
};

const familyTagPill: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  fontWeight: 500,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--accent-strong)",
  background: "var(--accent-soft)",
  borderRadius: "var(--radius-pill)",
  padding: "5px 13px",
};

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
