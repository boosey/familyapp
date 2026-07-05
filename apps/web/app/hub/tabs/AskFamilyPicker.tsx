"use client";

/**
 * Ask compose family multi-select (Increment 4B, Task 4.4). Rendered only when the asker is in more
 * than one family (a single-family asker is auto-resolved server-side). Seeded from the hub scope:
 * a family scope pre-checks that family; "all" with one family pre-checks it; "all" with several
 * pre-checks nothing and requires an explicit choice.
 *
 * Client-side validation (`required`): a visually-hidden, focusable text input mirrors "≥1 box
 * checked". When the ambiguous case demands a choice and none is made, native form-constraint
 * validation blocks submit with a friendly message — backstopped by the server guard in `submitAsk`.
 */
import { useState } from "react";
import { hub } from "@/app/_copy";
import { FamilyPicker } from "../FamilyPicker";

export function AskFamilyPicker({
  families,
  seeded,
  required,
}: {
  families: { familyId: string; familyName: string }[];
  seeded: string[];
  required: boolean;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(seeded));
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 10 }}>
      <legend
        className="kin-form-label"
        style={{ padding: 0, marginBottom: 2 }}
      >
        {hub.ask.familiesLabel}
      </legend>
      {required ? (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          {hub.ask.familiesHelp}
        </p>
      ) : null}
      <FamilyPicker
        families={families}
        selected={checked}
        onToggle={toggle}
        required={required}
        requiredMessage={hub.ask.familiesRequired}
      />
    </fieldset>
  );
}
