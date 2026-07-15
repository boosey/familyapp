import { type CSSProperties } from "react";

/**
 * The shared family-chip visual (ADR-0021) — one toggle-chip look used by BOTH the browse
 * `FamilyChips` (filter + designator) and the action-flow `FamilyChoiceChips` (audience/placement).
 * Keeping the pill styling in ONE place is the centralization convention (CLAUDE.md § Conventions):
 * the same design values must never live in two components, so the two chip surfaces can never
 * visually drift. `on` is the pressed/selected state; `disabled` dims the chip and drops the pointer.
 */
export function familyChipStyle(
  on: boolean,
  opts?: { disabled?: boolean },
): CSSProperties {
  const disabled = opts?.disabled ?? false;
  return {
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
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
    outline: "none",
    transition: "background var(--dur-fade) var(--ease-quiet)",
  };
}
