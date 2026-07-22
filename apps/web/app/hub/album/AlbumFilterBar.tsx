"use client";

/**
 * Album filter primitives (#191 · #302) — types, activity helpers, and the When / People / Places
 * facet cluster. Layout chrome lives in {@link AlbumControls} via {@link HubProgressiveControlRow};
 * this file no longer owns HubToolbar or the compact strip.
 */
import { hub } from "@/app/_copy";
import { SearchField } from "@/app/_kindred/SearchField";

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

/** True when any refinement is active (facets, period, or text) — AlbumGrid no-matches note. */
export function isFilterActive(v: AlbumFilterValue): boolean {
  return isFacetFilterActive(v) || isSearchActive(v);
}

/** When / People / Places only — badges the Filters unit (not Search). */
export function isFacetFilterActive(v: AlbumFilterValue): boolean {
  return v.personIds.size > 0 || v.placeIds.size > 0 || v.period !== "all";
}

/** Caption/tag text only — badges the Search unit (not Filters). */
export function isSearchActive(v: AlbumFilterValue): boolean {
  return v.text.trim() !== "";
}

const PERIODS: ReadonlyArray<{ value: AlbumPeriod; label: string }> = [
  { value: "all", label: hub.album.filterPeriodAll },
  { value: "thisYear", label: hub.album.filterPeriodThisYear },
  { value: "fiveYears", label: hub.album.filterPeriodFiveYears },
  { value: "older", label: hub.album.filterPeriodOlder },
];

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

const clearStyle: React.CSSProperties = {
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
};

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** When · People/Places facets · Clear (when facets/period engaged). Search is a separate unit. */
export function AlbumFacetFilters({
  people,
  places,
  value,
  onChange,
}: {
  people: { id: string; name: string }[];
  places: { id: string; name: string }[];
  value: AlbumFilterValue;
  onChange: (next: AlbumFilterValue) => void;
}) {
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, minWidth: 0 }}
      role="group"
      aria-label={hub.album.filterBarAria}
    >
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

      {isFacetFilterActive(value) ? (
        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              personIds: new Set(),
              placeIds: new Set(),
              period: "all",
            })
          }
          style={clearStyle}
        >
          {hub.album.filterClear}
        </button>
      ) : null}
    </div>
  );
}

/** Caption / tag text search — the shared SearchField; Clear when text is engaged. */
export function AlbumSearchFilter({
  value,
  onChange,
}: {
  value: AlbumFilterValue;
  onChange: (next: AlbumFilterValue) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, minWidth: 0 }}>
      <SearchField
        value={value.text}
        onChange={(text) => onChange({ ...value, text })}
        ariaLabel={hub.album.filterTextLabel}
        placeholder={hub.album.filterTextPlaceholder}
      />
      {isSearchActive(value) ? (
        <button
          type="button"
          onClick={() => onChange({ ...value, text: "" })}
          style={clearStyle}
        >
          {hub.album.filterClear}
        </button>
      ) : null}
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
