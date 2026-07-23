"use client";
/**
 * Client form for /families/[id]/edit (steward-only Edit-a-Family, #54). Mirrors CreateFamilyForm:
 * client-only so the "Save changes" button stays disabled until the family name is non-empty, and so
 * the short-name field can live-suggest from the name. The update logic stays on the server — the
 * server action is passed in as `action` and this component never touches the DB. A hidden `familyId`
 * field carries the id the action re-checks stewardship against.
 */
import { useState } from "react";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { families } from "@/app/_copy";
import { suggestShortName } from "@/lib/suggest-short-name";

export function EditFamilyForm({
  action,
  familyId,
  initialName,
  initialShortName,
  initialDescription,
  initialDiscoverable,
}: {
  action: (formData: FormData) => void | Promise<void>;
  familyId: string;
  initialName: string;
  initialShortName: string;
  initialDescription: string;
  initialDiscoverable: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [shortName, setShortName] = useState(initialShortName);
  // Live-suggest tracks EDITS to the formal name (mirrors the create form): a family without a short
  // name starts with an empty field and only fills as the steward changes the name, so an unrelated
  // save never persists a short name the steward never chose. An existing short name seeds the field
  // and starts dirty, so editing the name never clobbers it.
  const [shortNameDirty, setShortNameDirty] = useState(initialShortName.trim().length > 0);
  const empty = name.trim().length === 0;

  return (
    <form action={action} style={{ display: "grid", gap: 20 }}>
      <input type="hidden" name="familyId" value={familyId} />
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
          defaultValue={initialDescription}
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
          defaultChecked={initialDiscoverable}
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
        label={families.edit.submit}
        fullWidth
        disabled={empty}
      />
    </form>
  );
}
