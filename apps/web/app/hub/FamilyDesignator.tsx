"use client";

import { useState } from "react";

/**
 * FamilyDesignator — the shared action-flow family picker (ADR-0021, issue #49; DESIGNATOR mode).
 *
 * A single-select family picker whose selection is its OWN React state, SEEDED once from `seeded`
 * (derived by `seedDesignatorFamily` from the current browse filter), and which posts the chosen id
 * via a hidden `<select name>` the server action reads. It NEVER touches the router/pathname/search
 * params — that is the no-write-back guarantee (ADR-0021): changing the designator must not mutate the
 * shared `?families=` browse filter. It imports NO next/navigation at all, which also keeps it
 * renderable under renderToStaticMarkup for tests that don't need interaction.
 *
 * Native-select technique (mirrors the old InviteTab server select): when there is no seed AND >1
 * family, a disabled empty-value placeholder is prepended and selected, so `required` blocks an empty
 * submit and forces a deliberate pick. With a single family the lone option is auto-selected.
 */
export function FamilyDesignator({
  families,
  seeded,
  name = "familyId",
  label,
  placeholder,
  requiredMessage,
}: {
  /** ALL the viewer's active families; array order = option order. */
  families: { id: string; name: string }[];
  /** The initial operating family (from seedDesignatorFamily), or null when the user must pick. */
  seeded: string | null;
  /** The form field the server action reads. */
  name?: string;
  /** Legend/label text for the field. */
  label: string;
  /** Disabled placeholder copy shown when there is no seed and >1 family. */
  placeholder: string;
  /** Custom validity message when `required` blocks an empty submit. */
  requiredMessage: string;
}) {
  const [value, setValue] = useState<string>(seeded ?? "");

  // Placeholder only in the genuinely ambiguous case: no deliberate seed AND >1 family. With a single
  // family the lone option is unambiguous (auto-selected), so no placeholder is needed.
  const showPlaceholder = !seeded && families.length > 1;

  return (
    <label className="kin-form-label">
      {label}
      <select
        name={name}
        className="kin-field"
        required
        value={value}
        onChange={(e) => {
          e.currentTarget.setCustomValidity("");
          setValue(e.currentTarget.value);
        }}
        onInvalid={(e) => e.currentTarget.setCustomValidity(requiredMessage)}
      >
        {showPlaceholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {families.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}
