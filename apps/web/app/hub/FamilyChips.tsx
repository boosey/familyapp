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
}

/**
 * FamilyChips — the shared browse-filter chip bar (ADR-0021, FILTER mode).
 *
 * A wrapping row of toggle chips, one per active family. A chip is ON when `selected === "all"` OR
 * `selected` includes its id. Clicking a chip expands the current selection to concrete ids, toggles
 * the clicked id, then rewrites the shared `?families=` param via `serializeSelection` (omitting it
 * when the full set is selected — absent = all — and writing the `none` sentinel when the set empties),
 * preserving every other search param (tab, anchor, …).
 *
 * The bar renders NOTHING for a viewer with <2 families — one family has nothing to filter. This is
 * the FILTER surface only; the action-flow "Family designator" is a separate, later slice.
 */
export function FamilyChips({ families, selected }: FamilyChipsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A one-family (or family-less) viewer has nothing to filter — render nothing.
  if (families.length < 2) return null;

  const allIds = families.map((f) => f.id);
  const isOn = (id: string) => selected === "all" || selected.includes(id);

  function toggle(id: string): void {
    // Expand the current selection to concrete ids, then flip the clicked one.
    const current = selected === "all" ? [...allIds] : [...selected];
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    // Keep the serialized order stable (active-set order), independent of click order.
    const ordered = allIds.filter((x) => next.includes(x));

    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const value = serializeSelection(ordered, allIds);
    if (value === null) params.delete(FAMILIES_PARAM);
    else params.set(FAMILIES_PARAM, value);

    // `usePathname()` can be null during SSR/static generation; fall back to the hub so a truthy
    // query string never produces a literal "null?..." route.
    const base = pathname ?? "/hub";
    const qs = params.toString();
    router.push(qs ? `${base}?${qs}` : base);
  }

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
            onClick={() => toggle(f.id)}
          >
            {f.name}
          </button>
        );
      })}
    </div>
  );
}
