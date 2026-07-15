"use client";

import { type CSSProperties } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FAMILIES_PARAM, serializeSelection } from "@/lib/family-filter";
import { hub } from "@/app/_copy";

interface FamilyChipsFilterProps {
  /** The viewer's active families; array order = chip order. */
  families: { id: string; name: string }[];
  /** "all" = every chip ON; [] = none ON; a subset = those ids ON. */
  selected: string[] | "all";
  /** FILTER mode (default): omit `value`/`onSelect`. Multi-select, writes `?families=`. */
  value?: undefined;
  onSelect?: undefined;
}

interface FamilyChipsDesignatorProps {
  /** The viewer's active families; array order = chip order. */
  families: { id: string; name: string }[];
  /** DESIGNATOR mode: the single currently-designated family id (controlled by the caller). */
  value: string;
  /** DESIGNATOR mode: called with the newly-picked family id. Never touches the router/URL. */
  onSelect: (id: string) => void;
  selected?: undefined;
}

type FamilyChipsProps = FamilyChipsFilterProps | FamilyChipsDesignatorProps;

/**
 * FamilyChips — the shared family chip bar (ADR-0021). One presentational widget, two modes; the
 * MODE (not the widget) carries the meaning.
 *
 * FILTER mode (default — pass `selected`, omit `value`/`onSelect`): a wrapping row of toggle chips,
 * one per active family. A chip is ON when `selected === "all"` OR `selected` includes its id.
 * Clicking a chip expands the current selection to concrete ids, toggles the clicked id, then
 * rewrites the shared `?families=` param via `serializeSelection` (omitting it when the full set is
 * selected — absent = all — and writing the `none` sentinel when the set empties), preserving every
 * other search param (tab, anchor, …). This NARROWS what is browsed.
 *
 * DESIGNATOR mode (pass `value` + `onSelect`): single-select. Exactly one chip is ON (`value`);
 * clicking a different chip calls `onSelect(id)` and NEVER touches the router/URL — picking who you
 * act on must not change what you're browsing (ADR-0021 "seeded, never written back"). Clicking the
 * already-selected chip is a no-op (you can't designate zero). Uses `aria-pressed` on the ON chip.
 *
 * The bar renders NOTHING for a viewer with <2 families in EITHER mode — one family has nothing to
 * filter and nothing to designate (its sole family is auto-used by the caller).
 */
export function FamilyChips(props: FamilyChipsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { families } = props;
  // Discriminate the two modes ONCE, narrowing `props` for the whole body.
  const designatorProps = props.value !== undefined ? props : null;
  const filterProps = props.value === undefined ? props : null;
  const designator = designatorProps !== null;

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

  function toggle(id: string): void {
    // FILTER mode only (designator mode never calls this). Expand the current selection to concrete
    // ids, then flip the clicked one.
    if (!filterProps) return;
    const selected = filterProps.selected;
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
      aria-label={designator ? hub.shell.familyDesignatorAria : hub.shell.familyFilterAria}
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
            onClick={() => (designator ? select(f.id) : toggle(f.id))}
          >
            {f.name}
          </button>
        );
      })}
    </div>
  );
}
