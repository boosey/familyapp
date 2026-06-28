"use client";

/**
 * Stories browser — the hi-fi "Family Chronicle" main screen.
 *
 * Faithful to docs/design-system/.../Family Chronicle.dc.html (the family hub · Stories tab):
 *   - a "Find Stories" pill that opens a finder panel,
 *   - three finder modes that all drive the SAME filter state: Search / Sentence / Lists,
 *   - a large featured story card (top result), then a responsive grid of "Earlier memories".
 *
 * Facets are derived from real data only: Person (the narrators in the feed), Era (the decade of
 * each story's date), and Topic (the free-form `tags` on each story). The design's separate
 * "Event" facet has no backing field yet, so it is intentionally absent.
 */
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { KindredStoryCard, KindredListenBar } from "@/app/_kindred";

export interface StoryItem {
  id: string;
  title: string;
  summary: string | null;
  prose: string | null;
  tags: string[];
  personId: string;
  personName: string;
  /** Mono metadata line, e.g. "1962 · MARCH". */
  dateLabel: string;
  /** Decade bucket used by the Era facet, e.g. "1960s". */
  decade: string;
  href: string;
  mediaSrc: string;
}

export interface StoryFacets {
  persons: { id: string; name: string }[];
  decades: string[];
  topics: string[];
}

interface StoriesBrowserProps {
  items: StoryItem[];
  facets: StoryFacets;
  /** Section context line, e.g. "Shared with you". */
  contextLabel: string;
}

type FinderMode = "search" | "sentence" | "lists";

interface Filters {
  person: string; // person id or "all"
  era: string; // decade or "all"
  topic: string; // tag or "all"
  query: string;
}

const DEFAULTS: Filters = { person: "all", era: "all", topic: "all", query: "" };

export function StoriesBrowser({ items, facets, contextLabel }: StoriesBrowserProps) {
  const [finderOpen, setFinderOpen] = useState(false);
  const [mode, setMode] = useState<FinderMode>("search");
  const [openSlot, setOpenSlot] = useState<null | "person" | "topic" | "era">(null);
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const anyFilter =
    filters.person !== "all" ||
    filters.era !== "all" ||
    filters.topic !== "all" ||
    filters.query.trim() !== "";

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return items.filter((it) => {
      if (filters.person !== "all" && it.personId !== filters.person) return false;
      if (filters.era !== "all" && it.decade !== filters.era) return false;
      if (filters.topic !== "all" && !it.tags.includes(filters.topic)) return false;
      if (q) {
        const hay = [it.title, it.summary, it.prose, it.personName, it.tags.join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filters]);

  const total = items.length;
  const resultLabel = anyFilter
    ? `${filtered.length} OF ${total}`
    : `${total} ${total === 1 ? "STORY" : "STORIES"}`;
  const resultSentence =
    filtered.length === 1 ? "1 story matches" : `${filtered.length} stories match`;

  function setFacet(group: "person" | "era" | "topic", value: string) {
    setFilters((f) => ({ ...f, [group]: value }));
    setOpenSlot(null);
  }
  function clearAll() {
    setFilters(DEFAULTS);
    setOpenSlot(null);
  }

  /* Friendly summary shown when the finder is closed but filters are active. */
  const summaryParts: string[] = [];
  if (filters.person !== "all") {
    summaryParts.push(facets.persons.find((p) => p.id === filters.person)?.name ?? "Someone");
  }
  if (filters.topic !== "all") summaryParts.push(filters.topic);
  if (filters.era !== "all") summaryParts.push(filters.era);
  if (filters.query.trim()) summaryParts.push(`“${filters.query.trim()}”`);

  const featured = filtered[0];
  const earlier = filtered.slice(1);

  return (
    <div>
      {/* Context + result count row */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story-lg)",
            color: "var(--text-muted)",
          }}
        >
          {contextLabel}
        </span>
        <span style={monoLabel}>{resultLabel}</span>
      </div>

      {/* Find Stories pill */}
      <div style={{ marginTop: 18 }}>
        <button
          type="button"
          onClick={() => {
            setFinderOpen((o) => !o);
            setOpenSlot(null);
          }}
          aria-expanded={finderOpen}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            width: "100%",
            cursor: "pointer",
            background: "var(--surface-card)",
            border: "var(--border-width) solid var(--border-strong)",
            borderRadius: "var(--radius-pill)",
            padding: "14px 22px",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <span style={{ fontSize: 20 }} aria-hidden="true">
            🔎
          </span>
          <span
            style={{
              flex: 1,
              textAlign: "left",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui)",
              fontWeight: 600,
              color: "var(--text-body)",
            }}
          >
            Find stories
          </span>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 18, color: "var(--text-muted)" }}>
            {finderOpen ? "▴" : "▾"}
          </span>
        </button>

        {/* Closed-state active-filter summary */}
        {anyFilter && !finderOpen ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginTop: 12,
              paddingLeft: 8,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                color: "var(--text-muted)",
              }}
            >
              {filtered.length} {filtered.length === 1 ? "story" : "stories"}
              {summaryParts.length ? " · " + summaryParts.join(" · ") : ""}
            </span>
            <button type="button" onClick={clearAll} style={linkButton}>
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {/* Finder panel */}
      {finderOpen ? (
        <div
          style={{
            marginTop: 14,
            background: "var(--surface-card)",
            border: "var(--border-width) solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lift)",
            padding: "22px 24px",
          }}
        >
          {/* Mode switcher */}
          <div
            style={{
              display: "inline-flex",
              gap: 4,
              background: "var(--surface-sunken)",
              border: "var(--border-width) solid var(--border)",
              borderRadius: "var(--radius-pill)",
              padding: 4,
            }}
          >
            {(["search", "sentence", "lists"] as FinderMode[]).map((m) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setOpenSlot(null);
                  }}
                  style={{
                    padding: "8px 20px",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: "var(--radius-pill)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    fontWeight: 600,
                    textTransform: "capitalize",
                    background: on ? "var(--surface-card)" : "transparent",
                    color: on ? "var(--accent-strong)" : "var(--text-muted)",
                    boxShadow: on ? "var(--shadow-sm)" : "none",
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* SEARCH */}
          {mode === "search" ? (
            <div style={{ marginTop: 22 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <input
                  ref={searchRef}
                  type="text"
                  value={filters.query}
                  onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                  placeholder="Try a name, a place, or a moment…"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "14px 18px",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui)",
                    color: "var(--text-body)",
                    background: "var(--surface-page)",
                    border: "var(--border-width) solid var(--border-strong)",
                    borderRadius: "var(--radius-md)",
                    outline: "none",
                  }}
                />
              </div>
              {filters.query.trim() && filtered.length === 0 ? (
                <p
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    color: "var(--text-muted)",
                    margin: "14px 0 0",
                  }}
                >
                  Hmm — nothing matched. Try a name, a year, or a word from the story.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* SENTENCE */}
          {mode === "sentence" ? (
            <div style={{ marginTop: 22 }}>
              <p
                style={{
                  fontFamily: "var(--font-story)",
                  fontSize: "var(--text-prompt)",
                  lineHeight: "var(--leading-loose)",
                  color: "var(--text-muted)",
                  margin: 0,
                }}
              >
                Show me{" "}
                <SlotButton
                  label={
                    filters.person === "all"
                      ? "everyone’s"
                      : (facets.persons.find((p) => p.id === filters.person)?.name ?? "someone") +
                        "’s"
                  }
                  active={filters.person !== "all"}
                  open={openSlot === "person"}
                  onClick={() => setOpenSlot((s) => (s === "person" ? null : "person"))}
                />{" "}
                stories about{" "}
                <SlotButton
                  label={filters.topic === "all" ? "anything" : filters.topic}
                  active={filters.topic !== "all"}
                  open={openSlot === "topic"}
                  onClick={() => setOpenSlot((s) => (s === "topic" ? null : "topic"))}
                />
                , from{" "}
                <SlotButton
                  label={filters.era === "all" ? "any time" : `the ${filters.era}`}
                  active={filters.era !== "all"}
                  open={openSlot === "era"}
                  onClick={() => setOpenSlot((s) => (s === "era" ? null : "era"))}
                />
                .
              </p>

              {openSlot ? (
                <div
                  style={{
                    marginTop: 22,
                    borderTop: "1px solid var(--border)",
                    paddingTop: 20,
                  }}
                >
                  <div style={{ ...monoLabel, marginBottom: 14 }}>
                    {openSlot === "person"
                      ? "Whose stories?"
                      : openSlot === "topic"
                        ? "About what?"
                        : "From when?"}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {slotOptionsFor(openSlot, facets).map((opt) => {
                      const group = openSlot === "era" ? "era" : openSlot === "topic" ? "topic" : "person";
                      const selected = filters[group] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFacet(group, opt.value)}
                          style={optionPill(selected)}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* LISTS */}
          {mode === "lists" ? (
            <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 16 }}>
              <FacetRow
                label="Person"
                options={[
                  { value: "all", label: "Everyone" },
                  ...facets.persons.map((p) => ({ value: p.id, label: p.name })),
                ]}
                selected={filters.person}
                onSelect={(v) => setFacet("person", v)}
              />
              <FacetRow
                label="Era"
                options={[
                  { value: "all", label: "Any era" },
                  ...facets.decades.map((d) => ({ value: d, label: d })),
                ]}
                selected={filters.era}
                onSelect={(v) => setFacet("era", v)}
              />
              <FacetRow
                label="Topic"
                options={[
                  { value: "all", label: "Anything" },
                  ...facets.topics.map((t) => ({ value: t, label: t })),
                ]}
                selected={filters.topic}
                onSelect={(v) => setFacet("topic", v)}
              />
            </div>
          ) : null}

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 26,
              borderTop: "1px solid var(--border)",
              paddingTop: 20,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                color: "var(--text-muted)",
              }}
            >
              {resultSentence}
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              {anyFilter ? (
                <button type="button" onClick={clearAll} style={ghostBtn}>
                  Start over
                </button>
              ) : null}
              <button type="button" onClick={() => setFinderOpen(false)} style={primaryBtn}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Results */}
      {filtered.length === 0 ? (
        <div
          style={{
            marginTop: 24,
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
            No stories match. Try widening your search.
          </p>
        </div>
      ) : (
        <>
          {featured ? <FeaturedCard item={featured} /> : null}

          {earlier.length > 0 ? (
            <>
              <div style={{ ...monoLabel, margin: "30px 0 16px" }}>Earlier memories</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: 16,
                }}
              >
                {earlier.map((it) => (
                  <KindredStoryCard
                    key={it.id}
                    title={it.title}
                    year={it.dateLabel}
                    excerpt={it.summary ?? undefined}
                    href={it.href}
                    style={{ width: "100%" }}
                  />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ── Featured (large) story card ─────────────────────────────────────────────── */
function FeaturedCard({ item }: { item: StoryItem }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "var(--border-width) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        padding: 24,
        marginTop: 24,
        display: "flex",
        gap: 24,
        flexWrap: "wrap",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          flex: "0 0 auto",
          width: 180,
          height: 180,
          borderRadius: "var(--radius-md)",
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--support-soft) 0 14px, var(--accent-soft) 14px 28px)",
        }}
      />
      <div style={{ flex: 1, minWidth: 240 }}>
        <p style={{ ...monoLabel, margin: 0, color: "var(--text-meta)" }}>{item.dateLabel}</p>
        <h3
          style={{
            fontFamily: "var(--font-story)",
            fontWeight: 500,
            fontSize: "var(--text-display)",
            lineHeight: "var(--leading-snug)",
            color: "var(--text-body)",
            margin: "6px 0 0",
          }}
        >
          {item.title}
        </h3>
        <div style={{ marginTop: 16 }}>
          <KindredListenBar src={item.mediaSrc} title="The original recording" />
        </div>
        {item.summary ? (
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              lineHeight: "var(--leading-body)",
              color: "var(--text-muted)",
              margin: "16px 0 0",
            }}
          >
            {item.summary}
          </p>
        ) : null}
        {item.prose ? (
          <details style={{ marginTop: 12 }}>
            <summary
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                fontWeight: 600,
                color: "var(--accent-strong)",
                cursor: "pointer",
              }}
            >
              Read the prose ›
            </summary>
            <p
              style={{
                fontFamily: "var(--font-story)",
                fontSize: "var(--text-story)",
                lineHeight: "var(--leading-loose)",
                color: "var(--text-body)",
                margin: "12px 0 0",
                whiteSpace: "pre-wrap",
              }}
            >
              {item.prose}
            </p>
          </details>
        ) : null}
        <div style={{ marginTop: 16 }}>
          <a href={item.href} style={{ ...linkButton, fontSize: "var(--text-ui-sm)" }}>
            Open this story ›
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Sentence-mode slot button ───────────────────────────────────────────────── */
function SlotButton({
  label,
  active,
  open,
  onClick,
}: {
  label: string;
  active: boolean;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        font: "inherit",
        padding: "2px 12px",
        margin: "0 2px",
        border: "none",
        cursor: "pointer",
        borderRadius: "var(--radius-pill)",
        textDecoration: "underline",
        textDecorationThickness: 2,
        textUnderlineOffset: 4,
        color: active ? "var(--accent-strong)" : "var(--accent)",
        background: open ? "var(--accent-soft)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

/* ── Lists-mode facet row ────────────────────────────────────────────────────── */
function FacetRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
      <span style={{ ...monoLabel, flex: "0 0 84px", paddingTop: 10 }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => {
          const on = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              style={{
                padding: "8px 16px",
                cursor: "pointer",
                borderRadius: "var(--radius-pill)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                fontWeight: 600,
                textTransform: label === "Topic" ? "capitalize" : "none",
                background: on ? "var(--accent)" : "var(--surface-card)",
                color: on ? "var(--accent-on)" : "var(--text-body)",
                border: `var(--border-width) solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── helpers / shared styles ─────────────────────────────────────────────────── */
function slotOptionsFor(
  slot: "person" | "topic" | "era",
  facets: StoryFacets,
): { value: string; label: string }[] {
  if (slot === "person") {
    return [
      { value: "all", label: "Everyone" },
      ...facets.persons.map((p) => ({ value: p.id, label: p.name })),
    ];
  }
  if (slot === "topic") {
    return [
      { value: "all", label: "Anything" },
      ...facets.topics.map((t) => ({ value: t, label: t })),
    ];
  }
  return [
    { value: "all", label: "Any time" },
    ...facets.decades.map((d) => ({ value: d, label: d })),
  ];
}

function optionPill(selected: boolean): CSSProperties {
  return {
    minHeight: 48,
    padding: "10px 20px",
    cursor: "pointer",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    textTransform: "capitalize",
    background: selected ? "var(--accent)" : "var(--surface-card)",
    color: selected ? "var(--accent-on)" : "var(--text-body)",
    border: `var(--border-width) solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
  };
}

const monoLabel: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  letterSpacing: "var(--tracking-mono)",
  textTransform: "uppercase",
  color: "var(--support)",
};

const linkButton: CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  fontWeight: 600,
  color: "var(--accent-strong)",
  textDecoration: "none",
};

const ghostBtn: CSSProperties = {
  padding: "12px 20px",
  borderRadius: "var(--radius-md)",
  border: "var(--border-width) solid var(--border-strong)",
  background: "transparent",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  fontWeight: 600,
  color: "var(--text-meta)",
};

const primaryBtn: CSSProperties = {
  padding: "12px 24px",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--accent)",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  fontWeight: 600,
  color: "var(--accent-on)",
};
