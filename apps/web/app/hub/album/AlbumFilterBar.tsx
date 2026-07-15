"use client";

/**
 * AlbumFilterBar (Phase C · item 9 · album layout 2026-07-14) — the album's search / filter controls,
 * laid out as TWO rows: (1) small tag-size People / Places toggle CHIPS on their own row above (only
 * rendered when the current photos carry those facets), and (2) a consolidated controls row whose LEFT
 * holds the shared browse Family filter chips (ADR-0021) + When · Search · Clear and whose RIGHT holds
 * the `rightSlot` (the view selector + size slider + Select toggle, passed in by `AlbumGrid`) — all in
 * one `flexWrap` row so they wrap together on narrow viewports without horizontal page scroll. It
 * narrows the photos ON SCREEN client-side (over the photos
 * already loaded by the surface). Purely presentational — `AlbumGrid` owns the `AlbumFilterValue` state
 * AND does the filtering; this component only renders the current value and reports changes.
 *
 * The People / Places chip options are the UNION of the facet across the current photos, deduped by id,
 * so the chips only ever offer values that could actually match something. Each chip is a real
 * `aria-pressed` toggle button (keyboard-operable, elder-friendly). The period is a native <select>; the
 * text is a search input. A single "Clear filters" button resets everything.
 */
import { hub } from "@/app/_copy";

/** Coarse capture-time buckets over each photo's `capturedAt` ISO string. */
export type AlbumPeriod = "all" | "thisYear" | "fiveYears" | "older";

export interface AlbumFilterValue {
  personIds: Set<string>;
  placeIds: Set<string>;
  period: AlbumPeriod;
  text: string;
}

export const EMPTY_FILTER: AlbumFilterValue = {
  personIds: new Set(),
  placeIds: new Set(),
  period: "all",
  text: "",
};

/** True when nothing is filtering — used to decide whether to show the "no matches" note vs the empty note. */
export function isFilterActive(v: AlbumFilterValue): boolean {
  return (
    v.personIds.size > 0 ||
    v.placeIds.size > 0 ||
    v.period !== "all" ||
    v.text.trim() !== ""
  );
}

const PERIODS: ReadonlyArray<{ value: AlbumPeriod; label: string }> = [
  { value: "all", label: hub.album.filterPeriodAll },
  { value: "thisYear", label: hub.album.filterPeriodThisYear },
  { value: "fiveYears", label: hub.album.filterPeriodFiveYears },
  { value: "older", label: hub.album.filterPeriodOlder },
];

export function AlbumFilterBar({
  people,
  places,
  value,
  onChange,
  rightSlot,
  familyChips,
}: {
  /** Union of subject+appears-in people across the current photos (deduped by id). */
  people: { id: string; name: string }[];
  /** Union of places across the current photos (deduped by id). */
  places: { id: string; name: string }[];
  value: AlbumFilterValue;
  onChange: (next: AlbumFilterValue) => void;
  /** Right-justified controls that share the consolidated row (view selector + slider + Select). */
  rightSlot?: React.ReactNode;
  /** The shared browse Family filter chips (ADR-0021), sharing the consolidated control row on the
   *  LEFT alongside When · Search so view/size/Select + chips all wrap together on narrow viewports. */
  familyChips?: React.ReactNode;
}) {
  const fieldLabel: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    color: "var(--text-meta)",
  };
  const control: React.CSSProperties = {
    minHeight: 40,
    padding: "6px 10px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    color: "var(--text-body)",
    borderRadius: "var(--radius-sm)",
    border: "var(--border-width) solid var(--border-strong)",
    background: "var(--surface-card)",
  };

  // Toggle one id in a facet Set without mutating the current value (immutably rebuild the Set).
  const toggleIn = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const hasFacetChips = people.length > 0 || places.length > 0;

  return (
    <div
      role="group"
      aria-label={hub.album.filterBarAria}
      style={{ display: "flex", flexDirection: "column", gap: 12, margin: "0 0 16px" }}
    >
      {/* Row 1 — small tag-size People / Places toggle chips (only when the photos carry those facets).
          Kept compact so the facets never dominate the controls area. */}
      {hasFacetChips ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          {people.length > 0 ? (
            <FacetChips
              label={hub.album.filterPeopleLabel}
              options={people}
              selected={value.personIds}
              onToggle={(id) => onChange({ ...value, personIds: toggleIn(value.personIds, id) })}
            />
          ) : null}
          {places.length > 0 ? (
            <FacetChips
              label={hub.album.filterPlacesLabel}
              options={places}
              selected={value.placeIds}
              onToggle={(id) => onChange({ ...value, placeIds: toggleIn(value.placeIds, id) })}
            />
          ) : null}
        </div>
      ) : null}

      {/* Row 2 — When · Search · Clear (left) share ONE row with the view controls (right, rightSlot). */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12, minWidth: 0 }}>
          {/* Shared browse Family filter chips (ADR-0021) — laid out inline in the consolidated row.
              FamilyChips DROPS its bottom margin via the `inline` prop so the chips bottom-align with
              When · Search; the wrapper is a plain flex box so they sit alongside and wrap with them. */}
          {familyChips ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", minWidth: 0 }}>
              {familyChips}
            </div>
          ) : null}

          {/* Capture-time preset. */}
          <label style={fieldLabel}>
            {hub.album.filterPeriodLabel}
            <select
              aria-label={hub.album.filterPeriodLabel}
              value={value.period}
              onChange={(e) => onChange({ ...value, period: e.currentTarget.value as AlbumPeriod })}
              style={{ ...control, minWidth: 140 }}
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {/* Caption / tag text search. */}
          <label style={fieldLabel}>
            {hub.album.filterTextLabel}
            <input
              type="search"
              aria-label={hub.album.filterTextLabel}
              placeholder={hub.album.filterTextPlaceholder}
              value={value.text}
              onChange={(e) => onChange({ ...value, text: e.currentTarget.value })}
              style={{ ...control, minWidth: 180 }}
            />
          </label>

          {isFilterActive(value) ? (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTER)}
              style={{
                minHeight: 40,
                padding: "8px 16px",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                fontWeight: 500,
                color: "var(--text-body)",
                background: "transparent",
                border: "var(--border-width) solid var(--border-strong)",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
              }}
            >
              {hub.album.filterClear}
            </button>
          ) : null}
        </div>

        {rightSlot ? (
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            {rightSlot}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A small tag-size chip group for one facet (People or Places). Each chip is an `aria-pressed` toggle. */
function FacetChips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}
    >
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-meta)",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((o) => {
          const on = selected.has(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o.id)}
              style={{
                padding: "4px 12px",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-label)",
                fontWeight: 500,
                color: on ? "var(--accent-strong)" : "var(--text-muted)",
                background: on ? "var(--accent-soft)" : "transparent",
                border: `1.5px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
              }}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
