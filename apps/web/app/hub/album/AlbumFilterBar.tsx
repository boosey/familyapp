"use client";

/**
 * AlbumFilterBar (Phase C · item 9 · album layout 2026-07-14 · toolbar normalization #191 · controls
 * hoist) — the album's search / filter controls, laid out through the shared `HubToolbar` (#189) so the
 * album's toolbar can't drift from the other hub sub-tabs. STRICTLY two rows — there is no third facet
 * row; the People / Places facet chips ride INLINE in R1-left, between the When filter and the Search
 * field:
 *       R1: [When ▾ · People/Places chips · Search · Clear]  ·······  [Add Photos ▸ (addSlot)]
 *       R2: [Family selector (familyChips)]                  ·······  [size slider + view layout (rightSlot)]
 *
 * Purely presentational — {@link AlbumControls} owns the `AlbumFilterValue` state (and derives the facet
 * options); this only renders the current value and reports changes. Slot content decides its own
 * presence: an absent `addSlot` / `familyChips` / `rightSlot` collapses that toolbar slot (HubToolbar's
 * empty-row rule), so e.g. a <2-family viewer (no `familyChips`) reserves no R2-left space.
 *
 * The People / Places chip options are the UNION of the facet across the current photos, deduped by id,
 * so the chips only ever offer values that could actually match something. Each chip is a real
 * `aria-pressed` toggle button (keyboard-operable, elder-friendly). The period is a native <select>; the
 * text is a search input. A single "Clear filters" button resets everything.
 */
import { LayoutGrid, UsersRound, ListFilter } from "lucide-react";
import { hub } from "@/app/_copy";
import { HubToolbar } from "../HubToolbar";
import { IconSheet } from "../IconSheet";
import strip from "../HubControlStrip.module.css";
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
  addSlot,
  familyChips,
  compact = false,
}: {
  /** Union of subject+appears-in people across the current photos (deduped by id). */
  people: { id: string; name: string }[];
  /** Union of places across the current photos (deduped by id). */
  places: { id: string; name: string }[];
  value: AlbumFilterValue;
  onChange: (next: AlbumFilterValue) => void;
  /** The view/layout controls (size slider + Grid/Masonry/List selector) — HubToolbar's R2-right. */
  rightSlot?: React.ReactNode;
  /** The "Add Photos" affordance (#143) — HubToolbar's R1-right (right-justified on the When · Search
   *  row). Omit to render no add affordance in the toolbar. */
  addSlot?: React.ReactNode;
  /** The shared browse Family filter chips (ADR-0021) — HubToolbar's R2-left, on the same row as the
   *  view/layout controls. Omit (e.g. <2 families) and the R2-left slot collapses. */
  familyChips?: React.ReactNode;
  /** ADR-0024: on a phone the filter cluster + chips + view controls move into a "⚙ Filters & view"
   *  bottom sheet; only "Add Photos" stays on the primary row. Desktop (false) renders the inline
   *  two-row HubToolbar unchanged. AlbumControls decides this via useIsCompact. */
  compact?: boolean;
  /** Number of non-default filters/view options. Plumbed from AlbumControls for Increment 4's per-icon
   *  active badges; NOT consumed yet in Step B (the single-gear badge was dropped). */
  activeCount?: number;
}) {
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

  // R1-left: the When · (facets) · Search · Clear cluster. The When/Search visible labels are dropped
  // (#143): the select's default option ("Any time") and the input's placeholder ("Search…") carry the
  // meaning; each control keeps an aria-label so its accessible name is unchanged. The People/Places
  // facet chips ride INLINE here (between When and Search) — never a separate third row.
  const filterCluster = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, minWidth: 0 }}>
      {/* Capture-time preset — label dropped (#143); "Any time" is the hint, aria-label names it. */}
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

      {/* People / Places facet chips — inline between When and Search (only when the current photos
          carry those facets, so the chips only ever offer values that could match something). */}
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

      {/* Caption / tag text search — the ONE shared _kindred/SearchField (same field the Stories browse
          toolbar uses); label dropped (#143), placeholder + aria-label carry it. */}
      <SearchField
        value={value.text}
        onChange={(text) => onChange({ ...value, text })}
        ariaLabel={hub.album.filterTextLabel}
        placeholder={hub.album.filterTextPlaceholder}
      />

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

  // ADR-0025 Increment 3 Step B — the compact control strip (shared HubControlStrip layout). The single
  // "⚙ Filters & view" gear splits into per-concern labeled icon-sheets: View ← the view/layout controls
  // (rightSlot); Family ← the family chips (≥2 families); Filter ← the When/facets/Search cluster. Album
  // has NO sub-tab pills, so the strip's left side is empty and the icon cluster + iconified Add-Photos
  // action right-align. Each icon renders ONLY when its content exists. NON-STICKY. Per-icon active
  // badges are Increment 4 — `activeCount` is no longer consumed here (kept in the prop for that step).
  if (compact) {
    return (
      <div role="group" aria-label={hub.album.filterBarAria}>
        <div className={strip.strip}>
          {/* No pills group on Album — the icon cluster + action right-align via margin-left:auto. */}
          <div className={strip.right}>
            {rightSlot ? (
              <IconSheet
                icon={LayoutGrid}
                label={hub.mobileControls.viewLabel}
                sheetTitle={hub.mobileControls.viewLabel}
              >
                {rightSlot}
              </IconSheet>
            ) : null}
            {familyChips ? (
              <IconSheet
                icon={UsersRound}
                label={hub.mobileControls.familyLabel}
                sheetTitle={hub.mobileControls.familyLabel}
              >
                {familyChips}
              </IconSheet>
            ) : null}
            <IconSheet
              icon={ListFilter}
              label={hub.mobileControls.filterLabel}
              sheetTitle={hub.mobileControls.filterLabel}
            >
              {filterCluster}
            </IconSheet>
            {/* Add-Photos — iconified by AlbumUploader on the compact branch (menu behavior unchanged). */}
            {addSlot ?? null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="group" aria-label={hub.album.filterBarAria}>
      {/* The shared two-row toolbar (#189/#191) — STRICTLY two rows (the facet chips ride inside R1-left,
          not a third row). Each slot gates its own presence: pass `null` for an absent affordance so its
          row/slot collapses (HubToolbar's empty-row rule). */}
      <HubToolbar
        row1Left={filterCluster}
        row1Right={addSlot ?? null}
        row2Left={familyChips ?? null}
        row2Right={rightSlot ?? null}
      />
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
