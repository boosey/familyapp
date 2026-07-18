"use client";

import { type CSSProperties } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FAMILIES_PARAM, serializeSelection } from "@/lib/family-filter";
import { familyChipStyle } from "./family-chip-style";
import { hub } from "@/app/_copy";
// The count-pill lives as ONE shared class in HubTabs.module.css (centralization convention) — the
// hub tabs and the Family selector row already reuse it (see FamilySurfaceNav), so a per-family count
// badge on a chip pulls the SAME `.badge` visual rather than re-declaring the pill and risking drift.
import hubTabStyles from "./HubTabs.module.css";

/**
 * A family as a chip renders. `shortName` (ADR-0021) is the steward-set brief label shown in place of
 * the formal `name` when set — chips live where the full name crowds the layout. Optional/nullable so
 * callers without a short name simply fall back to `name`.
 */
interface ChipFamily {
  id: string;
  name: string;
  shortName?: string | null;
}

/** The label a chip shows: the steward's short name when present, else the formal name. */
function chipLabel(f: ChipFamily): string {
  return f.shortName || f.name;
}

interface FamilyChipsFilterProps {
  /** The viewer's active families; array order = chip order. */
  families: ChipFamily[];
  /** "all" = every chip ON; [] = none ON; a subset = those ids ON. */
  selected: string[] | "all";
  /**
   * SINGLE-SELECT mode (ADR-0021 §Tree, #48): the tree surface shows exactly ONE family at a time, so
   * tapping a chip COLLAPSES the shared `?families=` set to just that family rather than toggling it.
   * In this mode `selected` carries the single scope id as a one-element array `[scopeId]`. Default
   * (false) keeps the album's multi-select toggle/expand behaviour byte-for-byte.
   */
  singleSelect?: boolean;
  /**
   * Inline mode drops the standalone bottom margin so the bar can share a flex row with sibling
   * controls (the album's consolidated control row, ADR-0021 · #52). Standalone (default) keeps the
   * trailing space before the next block on the stories/tree browse surfaces.
   */
  inline?: boolean;
  /** Optional per-family count badge (e.g. pending join-requests, #140): a chip whose id maps to a
   *  positive count renders the shared count-pill; 0/absent shows no badge. */
  badges?: Record<string, number>;
  /** Accessible name for each chip's count badge, keyed by family id (the caller owns what the count
   *  MEANS). Precomputed STRINGS, not a formatter fn: FamilyChips is a client component, and a Server
   *  Component caller cannot pass a plain function across the RSC boundary (it isn't serializable —
   *  that regressed the Requests tab into a 500). A family id absent here falls back to the raw count. */
  badgeLabels?: Record<string, string>;
  /** FILTER mode (default): omit `value`/`onSelect`. Multi-select, writes `?families=`. */
  value?: undefined;
  onSelect?: undefined;
}

interface FamilyChipsDesignatorProps {
  /** The viewer's active families; array order = chip order. */
  families: ChipFamily[];
  /** DESIGNATOR mode: the single currently-designated family id (controlled by the caller). */
  value: string;
  /** DESIGNATOR mode: called with the newly-picked family id. Never touches the router/URL. */
  onSelect: (id: string) => void;
  /** Optional per-family count badge (e.g. pending join-requests, #140) — see the filter-mode note. */
  badges?: Record<string, number>;
  /** Accessible name for each chip's count badge, keyed by family id — see the filter-mode note. */
  badgeLabels?: Record<string, string>;
  selected?: undefined;
}

type FamilyChipsProps = FamilyChipsFilterProps | FamilyChipsDesignatorProps;

/**
 * FamilyChips — the shared family chip bar (ADR-0021). One presentational widget, three behaviours;
 * the MODE (not the widget) carries the meaning.
 *
 * FILTER mode (default — pass `selected`, omit `value`/`onSelect`): a wrapping row of toggle chips,
 * one per active family. A chip is ON when `selected === "all"` OR `selected` includes its id.
 * Multi-select (default): clicking a chip expands the current selection to concrete ids, toggles the
 * clicked id, then rewrites the shared `?families=` param via `serializeSelection` (omitting it when
 * the full set is selected — absent = all — and writing the `none` sentinel when the set empties).
 * Single-select (`singleSelect`, the tree): clicking a chip COLLAPSES the set to JUST that id. Both
 * paths preserve every other search param (tab, anchor, …). This NARROWS what is browsed.
 *
 * DESIGNATOR mode (pass `value` + `onSelect`): single-select. Exactly one chip is ON (`value`);
 * clicking a different chip calls `onSelect(id)` and NEVER touches the router/URL — picking who you
 * act on must not change what you're browsing (ADR-0021 "seeded, never written back"). Clicking the
 * already-selected chip is a no-op (you can't designate zero). Uses `aria-pressed` on the ON chip.
 *
 * The bar renders NOTHING for a viewer with <2 families in EITHER mode — one family has nothing to
 * filter and nothing to designate (its sole family is auto-used by the caller).
 *
 * a11y: all modes keep `aria-pressed` (a chip is a two-state toggle button). Single-select is
 * semantically radio-ish, but the chips also collapse a shared browse filter (not a pure radiogroup),
 * and switching to `role="radio"` would fork keyboard/announcement behaviour for little gain. Kept
 * `aria-pressed` throughout to minimize surface (per #48's guidance).
 */
export function FamilyChips(props: FamilyChipsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { families } = props;
  // Optional per-family count badges (#140) — present in either mode; read off the raw props before the
  // mode narrowing below.
  const badges = props.badges;
  const badgeLabels = props.badgeLabels;
  // Discriminate the two modes ONCE, narrowing `props` for the whole body.
  const designatorProps = props.value !== undefined ? props : null;
  const filterProps = props.value === undefined ? props : null;
  const designator = designatorProps !== null;
  // Inline layout is a FILTER-mode-only concern (the album's consolidated control row, #52).
  const inline = filterProps?.inline ?? false;

  // A one-family (or family-less) viewer has nothing to filter or designate — render nothing.
  if (families.length < 2) return null;

  const allIds = families.map((f) => f.id);
  const isOn = (id: string) =>
    designatorProps
      ? designatorProps.value === id
      : filterProps!.selected === "all" || filterProps!.selected.includes(id);

  function select(id: string): void {
    if (!designatorProps) return;
    // Single-select: re-picking the already-designated chip is a no-op (never designate zero). The
    // caller owns the state; we NEVER touch the router/URL here — that is the load-bearing
    // no-write-back guarantee (ADR-0021).
    if (designatorProps.value === id) return;
    designatorProps.onSelect(id);
  }

  /** Push a new `?families=` value while preserving every other search param. FILTER mode only. */
  function pushSelection(orderedIds: string[]): void {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const value = serializeSelection(orderedIds, allIds);
    if (value === null) params.delete(FAMILIES_PARAM);
    else params.set(FAMILIES_PARAM, value);

    // `usePathname()` can be null during SSR/static generation; fall back to the hub so a truthy
    // query string never produces a literal "null?..." route.
    const base = pathname ?? "/hub";
    const qs = params.toString();
    router.push(qs ? `${base}?${qs}` : base);
  }

  /** Multi-select: expand to concrete ids, flip the clicked one, re-order to active-set order. */
  function toggle(id: string): void {
    // FILTER mode only (designator mode never calls this).
    if (!filterProps) return;
    const selected = filterProps.selected;
    const current = selected === "all" ? [...allIds] : [...selected];
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    // Keep the serialized order stable (active-set order), independent of click order.
    const ordered = allIds.filter((x) => next.includes(x));
    pushSelection(ordered);
  }

  /** Single-select (tree): collapse the shared set to JUST the clicked family — never expand/toggle. */
  function collapseTo(id: string): void {
    pushSelection([id]);
  }

  // FILTER-mode click handler: the tree collapses to one family; the album toggles the set.
  const onFilterChip = filterProps?.singleSelect ? collapseTo : toggle;

  const rowStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    // Standalone: trailing space before the next block. Inline (consolidated album row): no margin so
    // the chips bottom-align with the sibling When/Search controls (ADR-0021 · #52).
    margin: inline ? 0 : "0 0 20px",
  };

  return (
    <div
      role="group"
      aria-label={designator ? hub.shell.familyDesignatorAria : hub.shell.familyFilterAria}
      style={rowStyle}
    >
      {families.map((f) => {
        const on = isOn(f.id);
        const count = badges?.[f.id] ?? 0;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={on}
            style={familyChipStyle(on)}
            onClick={() => (designator ? select(f.id) : onFilterChip(f.id))}
          >
            {chipLabel(f)}
            {count > 0 ? (
              <span
                className={hubTabStyles.badge}
                aria-label={badgeLabels?.[f.id] ?? String(count)}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
