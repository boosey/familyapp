"use client";
/**
 * Client form for /families/new. Client-only so the "Create family" button can stay disabled until
 * the family name is non-empty (design: primary disabled until non-empty). The create logic itself
 * stays on the server — the server action is passed in as `action` and this component never touches
 * the DB. Description + "let relatives find this family" (ADR-0001) are preserved.
 */
import { useState } from "react";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { families } from "@/app/_copy";
import { suggestShortName } from "@/lib/suggest-short-name";

export function CreateFamilyForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [shortNameDirty, setShortNameDirty] = useState(false);
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
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            if (!shortNameDirty) setShortName(suggestShortName(v));
          }}
          className="kin-field"
          placeholder={families.new.namePlaceholder}
          style={{ textAlign: "center" }}
        />
      </label>
      <label className="kin-form-label">
        {families.new.shortNameLabel}{" "}
        <span style={{ fontWeight: 400 }}>{families.new.shortNameOptional}</span>
        <input
          name="shortName"
          type="text"
          value={shortName}
          onChange={(e) => {
            setShortName(e.target.value);
            setShortNameDirty(true);
          }}
          className="kin-field"
          placeholder={families.new.shortNamePlaceholder}
          style={{ textAlign: "center" }}
        />
        <span
          style={{
            display: "block",
            fontWeight: 400,
            fontSize: "var(--text-label)",
            color: "var(--text-muted)",
            marginTop: 2,
          }}
        >
          {families.new.shortNameHint}
        </span>
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
      <ActionButton
        type="submit"
        label={families.new.submit}
        fullWidth
        disabled={empty}
      />
    </form>
  );
}
