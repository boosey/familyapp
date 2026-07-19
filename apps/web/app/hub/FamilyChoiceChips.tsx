"use client";

import { type CSSProperties } from "react";
import seg from "@/app/_kindred/SegmentedControl.module.css";

/**
 * FamilyChoiceChips — the action-flow family AUDIENCE / PLACEMENT picker (ADR-0021), rendered as the
 * shared toggle-chips (replacing the pre-ADR two-checkbox `FamilyPicker`). Controlled: the parent owns
 * the `selected` set and toggles on click. It is deliberately router-free (imports NO next/navigation)
 * — choosing WHO content is shared with must never touch the shared `?families=` browse filter, and
 * staying router-free keeps every caller renderable without a router context. It backs both the
 * placement/audience surfaces (album uploader, photo tagging, story compose/edit) and, via
 * `FamilyDesignatorChips`, the single-select action designators (ask/invite).
 *
 * Single- vs multi-select is the CALLER's concern (it owns `selected`/`onToggle`): a multi-select
 * surface toggles ids in/out of the set; a single-select surface can collapse the set to one on toggle.
 * Each chip is an `aria-pressed` toggle button (keyboard-operable, elder-friendly). The caller decides
 * WHEN to render it — every surface hides it for a single-family actor (nothing to choose) and
 * auto-resolves the sole family. `shortName` (steward-set brief label) is shown in place of the formal
 * name when set.
 */
export interface FamilyChoiceOption {
  id: string;
  name: string;
  /** Steward-set brief label (ADR-0021); shown instead of `name` when present. */
  shortName?: string | null;
}

export function FamilyChoiceChips({
  families,
  selected,
  onToggle,
  disabled = false,
  ariaLabel,
}: {
  families: FamilyChoiceOption[];
  /** The chosen family ids (parent-owned). A chip is ON when its id is in the set. */
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
  /** Optional group label; omit when a sibling <legend> already names the group. */
  ariaLabel?: string;
}) {
  const rowStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  };

  return (
    // Only take the group role when we have a name for it — an unlabelled group role is noise to a
    // screen reader, and these chips usually sit inside a <fieldset> whose <legend> already groups them.
    <div role={ariaLabel ? "group" : undefined} aria-label={ariaLabel} style={rowStyle}>
      {families.map((f) => {
        const on = selected.has(f.id);
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            className={on ? `${seg.chip} ${seg.chipOn}` : seg.chip}
            onClick={() => onToggle(f.id)}
          >
            {f.shortName || f.name}
          </button>
        );
      })}
    </div>
  );
}
