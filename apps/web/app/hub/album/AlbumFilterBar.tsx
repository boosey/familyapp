"use client";

/**
 * AlbumFilterBar (Phase C · item 9) — the search / filter row above the album's view controls. It
 * narrows the photos ON SCREEN client-side (over the photos already loaded by the surface): who is in
 * them (subjects ∪ people), where (places), when (a coarse capture-time preset), and a caption/tag text
 * search. Purely presentational — `AlbumGrid` owns the `AlbumFilterValue` state AND does the filtering;
 * this component only renders the current value and reports changes.
 *
 * The People / Places options are the UNION of the facet across the current photos, deduped by id, so
 * the menus only ever offer values that could actually match something. Each is a native multi-select
 * (keyboard-operable, elder-friendly, no custom popover). The period is a native <select>; the text is a
 * search input. A single "Clear filters" button resets everything.
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

function selectedValues(el: HTMLSelectElement): Set<string> {
  const out = new Set<string>();
  for (const opt of Array.from(el.selectedOptions)) out.add(opt.value);
  return out;
}

export function AlbumFilterBar({
  people,
  places,
  value,
  onChange,
}: {
  /** Union of subject+appears-in people across the current photos (deduped by id). */
  people: { id: string; name: string }[];
  /** Union of places across the current photos (deduped by id). */
  places: { id: string; name: string }[];
  value: AlbumFilterValue;
  onChange: (next: AlbumFilterValue) => void;
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

  return (
    <div
      role="group"
      aria-label={hub.album.filterBarAria}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: 12,
        margin: "0 0 16px",
      }}
    >
      {/* People multi-select — only rendered when at least one photo carries a person. */}
      {people.length > 0 ? (
        <label style={fieldLabel}>
          {hub.album.filterPeopleLabel}
          <select
            multiple
            aria-label={hub.album.filterPeopleLabel}
            value={[...value.personIds]}
            onChange={(e) => onChange({ ...value, personIds: selectedValues(e.currentTarget) })}
            style={{ ...control, minWidth: 160, minHeight: 72 }}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* Places multi-select — only when a photo carries a place. */}
      {places.length > 0 ? (
        <label style={fieldLabel}>
          {hub.album.filterPlacesLabel}
          <select
            multiple
            aria-label={hub.album.filterPlacesLabel}
            value={[...value.placeIds]}
            onChange={(e) => onChange({ ...value, placeIds: selectedValues(e.currentTarget) })}
            style={{ ...control, minWidth: 160, minHeight: 72 }}
          >
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
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
  );
}
