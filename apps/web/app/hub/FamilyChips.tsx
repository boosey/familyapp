"use client";

import { type CSSProperties } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FAMILIES_PARAM, serializeSelection } from "@/lib/family-filter";
import { hub } from "@/app/_copy";

interface FamilyChipsProps {
  /** The viewer's active families; array order = chip order. */
  families: { id: string; name: string }[];
  /** "all" = every chip ON; [] = none ON; a subset = those ids ON. */
  selected: string[] | "all";
  /**
   * SINGLE-SELECT mode (ADR-0021 §Tree, #48): the tree surface shows exactly ONE family at a time, so
   * tapping a chip COLLAPSES the shared `?families=` set to just that family rather than toggling it.
   * In this mode `selected` carries the single scope id as a one-element array `[scopeId]`. Default
   * (false) keeps the album's multi-select toggle/expand behaviour byte-for-byte.
   */
  singleSelect?: boolean;
}

/**
 * FamilyChips — the shared browse-filter chip bar (ADR-0021, FILTER mode).
 *
 * A wrapping row of toggle chips, one per active family. A chip is ON when `selected === "all"` OR
 * `selected` includes its id. Multi-select (default): clicking a chip expands the current selection to
 * concrete ids, toggles the clicked id, then rewrites the shared `?families=` param via
 * `serializeSelection` (omitting it when the full set is selected — absent = all — and writing the
 * `none` sentinel when the set empties). Single-select (`singleSelect`, the tree): clicking a chip
 * COLLAPSES the set to just that id. Both paths preserve every other search param (tab, anchor, …).
 *
 * The bar renders NOTHING for a viewer with <2 families — one family has nothing to filter. This is
 * the FILTER surface only; the action-flow "Family designator" is a separate, later slice.
 *
 * a11y: both modes keep `aria-pressed` (a chip is a two-state toggle button). Single-select is
 * semantically radio-ish, but the chips also collapse a shared browse filter (not a pure radiogroup),
 * and switching to `role="radio"` would fork keyboard/announcement behaviour across the two modes for
 * little gain. Kept `aria-pressed` for both to minimize surface (per #48's guidance).
 */
export function FamilyChips({ families, selected, singleSelect = false }: FamilyChipsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A one-family (or family-less) viewer has nothing to filter — render nothing. Applies to BOTH modes.
  if (families.length < 2) return null;

  const allIds = families.map((f) => f.id);
  const isOn = (id: string) => selected === "all" || selected.includes(id);

  /** Push a new `?families=` value while preserving every other search param. */
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

  const onChip = singleSelect ? collapseTo : toggle;

  const rowStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    margin: "0 0 20px",
  };

  const chipStyle = (on: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 36,
    padding: "0 14px",
    borderRadius: "var(--radius-pill)",
    border: on
      ? "var(--border-width) solid var(--accent)"
      : "var(--border-width) solid var(--border-strong)",
    background: on ? "var(--accent-soft)" : "var(--surface-sunken)",
    color: on ? "var(--accent)" : "var(--text-muted)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: on ? 600 : 500,
    cursor: "pointer",
    outline: "none",
    transition: "background var(--dur-fade) var(--ease-quiet)",
  });

  return (
    <div
      role="group"
      aria-label={hub.shell.familyFilterAria}
      style={rowStyle}
    >
      {families.map((f) => {
        const on = isOn(f.id);
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={on}
            style={chipStyle(on)}
            onClick={() => onChip(f.id)}
          >
            {f.name}
          </button>
        );
      })}
    </div>
  );
}
