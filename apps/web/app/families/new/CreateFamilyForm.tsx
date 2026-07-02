"use client";
/**
 * Client form for /families/new. Client-only so the "Create family" button can stay disabled until
 * the family name is non-empty (design: primary disabled until non-empty). The create logic itself
 * stays on the server — the server action is passed in as `action` and this component never touches
 * the DB. Description + "let relatives find this family" (ADR-0001) are preserved.
 */
import { useState } from "react";
import { KindredButton } from "@/app/_kindred";
import { families } from "@/app/_copy";

export function CreateFamilyForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const empty = name.trim().length === 0;

  return (
    <form action={action} style={{ display: "grid", gap: 20 }}>
      <label className="kin-form-label">
        {families.new.nameLabel}
        <input
          name="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="kin-field"
          placeholder={families.new.namePlaceholder}
          style={{ textAlign: "center" }}
        />
      </label>
      <label className="kin-form-label">
        {families.new.descLabel}{" "}
        <span style={{ fontWeight: 400 }}>{families.new.descLabelOptional}</span>
        <textarea
          name="description"
          className="kin-field"
          placeholder={families.new.descPlaceholder}
          style={{ minHeight: 96 }}
        />
      </label>
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-body)",
          cursor: "pointer",
        }}
      >
        <input
          name="discoverable"
          type="checkbox"
          style={{ width: 22, height: 22, marginTop: 2, accentColor: "var(--accent)" }}
        />
        <span>
          {families.new.discoverableLabel}
          <span
            style={{
              display: "block",
              fontSize: "var(--text-label)",
              color: "var(--text-muted)",
              marginTop: 2,
            }}
          >
            {families.new.discoverableHint}
          </span>
        </span>
      </label>
      <KindredButton
        type="submit"
        label={families.new.submit}
        fullWidth
        size="large"
        disabled={empty}
      />
    </form>
  );
}
