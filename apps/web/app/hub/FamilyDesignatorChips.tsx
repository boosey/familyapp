"use client";

import { useEffect, useRef, useState } from "react";
import { FamilyChoiceChips } from "./FamilyChoiceChips";

/**
 * FamilyDesignatorChips — the action-flow single-select family DESIGNATOR (ADR-0021, #49), rendered as
 * the shared chips (FamilyChoiceChips) that replaced the pre-ADR `<select>` designator. Its selection
 * is its OWN client state, SEEDED once from `seeded` (from `seedDesignatorFamily`) and re-seeded when
 * `seeded` changes, and it NEVER touches the router / `?families=` — the no-write-back guarantee. It
 * imports NO next/navigation, so it stays renderable under renderToStaticMarkup like its predecessor.
 *
 * Single-select: clicking a chip designates that family (you can't designate zero once picked). The
 * chosen id rides the native form submit via a visually-hidden `required` input the server action reads
 * under `name` — preserving the old select's guard: with >1 family and no seed, an empty submit is
 * blocked with `requiredMessage`; a single family auto-resolves to its lone id (the server resolver
 * agrees). `shortName` is shown in place of the formal name when set.
 */
export function FamilyDesignatorChips({
  families,
  seeded,
  name = "familyId",
  label,
  requiredMessage,
  onSelectedChange,
}: {
  /** ALL the viewer's active families; array order = chip order. */
  families: { id: string; name: string; shortName?: string | null }[];
  /** The initial operating family (from seedDesignatorFamily), or null when the user must pick. */
  seeded: string | null;
  /** The form field the server action reads. */
  name?: string;
  /** Label text for the field. */
  label: string;
  /** Custom validity message when `required` blocks an empty submit. */
  requiredMessage: string;
  /** Notifies the parent when the posted family id changes (empty string = none selected). */
  onSelectedChange?: (familyId: string) => void;
}) {
  const [value, setValue] = useState<string>(seeded ?? "");
  // A filter change is a same-route soft navigation (no remount) — only `seeded` changes. Re-seed on
  // prop change (the "adjust state during render" pattern, matching AlbumUploader/the old designator)
  // so the picker tracks the current seed instead of keeping its stale mounted-once value.
  const [prevSeeded, setPrevSeeded] = useState<string | null>(seeded);
  if (prevSeeded !== seeded) {
    setPrevSeeded(seeded);
    setValue(seeded ?? "");
  }

  // A single-family actor has exactly one option: auto-resolve to it so the required guard never blocks
  // and the lone family is always the target (mirrors the old select auto-selecting its only option).
  const effective = value || (families.length === 1 ? (families[0]?.id ?? "") : "");
  const selected = new Set(effective ? [effective] : []);

  // Keep the hidden input's custom validity in lockstep with the selection. The chips drive `effective`
  // PROGRAMMATICALLY, so no input/change event fires on the input — an event-driven clear (onInput)
  // would leave the field stuck invalid after a first blocked submit even once a family is picked. A
  // deterministic effect on `effective` blocks an empty submit with `requiredMessage` and clears the
  // moment a family is chosen.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.setCustomValidity(effective ? "" : requiredMessage);
  }, [effective, requiredMessage]);

  useEffect(() => {
    onSelectedChange?.(effective);
  }, [effective, onSelectedChange]);

  return (
    <div className="kin-form-label">
      <span>{label}</span>
      <FamilyChoiceChips
        families={families}
        selected={selected}
        onToggle={setValue}
        ariaLabel={label}
      />
      {/*
        Visually-hidden, focusable input that carries the chosen id into the native form submit AND
        enforces `required`. A `type="hidden"` input is barred from constraint validation, so this is a
        positioned text input driven entirely by the chips (never user-typed): empty ⇒ the effect above
        marks it invalid so the submit is blocked with `requiredMessage`; a chosen id ⇒ valid, and the
        id posts under `name`.
      */}
      <input
        ref={inputRef}
        type="text"
        name={name}
        tabIndex={-1}
        aria-hidden="true"
        required
        value={effective}
        onChange={() => {}}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
    </div>
  );
}
