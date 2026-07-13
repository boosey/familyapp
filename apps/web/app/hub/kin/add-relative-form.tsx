"use client";

/**
 * Add-a-relative form (issue #32) — client component wrapping the `addRelativeAction` server action.
 *
 * Minimal, matching the Kindred form conventions already used by the Ask tab (`.kin-form-label` /
 * `.kin-field` / `<KindredButton>`): a relation `<select>` (the five v1 relations), an OPTIONAL name
 * (blank => core mints an anonymous bridge relative), and optional DOB + life status. The current
 * family scope rides along in a hidden field; the server re-validates it (never trusts the client).
 *
 * "One-tap add grandparent" is satisfied here purely by choosing relation=grandparent and submitting:
 * the implicit unknown-parent bridge is created SERVER-SIDE by core — this form authors no bridge.
 */
import { useState, useTransition } from "react";
import type { AddRelativeRelation } from "@chronicle/core";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { addRelativeAction } from "./actions";

export function AddRelativeForm({
  familyId,
  anchorPersonId,
  initialRelation,
  coParentOptions,
}: {
  familyId: string;
  /** When present (a targeted add from a person panel), rides along so core anchors on this person. */
  anchorPersonId?: string;
  /** Preselects the relation `<select>` when the add was launched with an intended relation. */
  initialRelation?: AddRelativeRelation;
  /** The anchor's partners (issue: adding a child only linked one parent, not their partner too).
   *  Non-empty => the "Other parent" picker shows for relation=child. */
  coParentOptions?: { id: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Drives the conditional "Year they died" field — shown ONLY when the relative is deceased
  // (spec §4). The select is controlled so the death-year field appears/disappears live.
  const [lifeStatus, setLifeStatus] = useState<"living" | "deceased">("living");
  // Drives the conditional co-parent picker — shown ONLY for relation=child. The relation select must
  // be controlled so the field appears/disappears live as the user changes it.
  const [relation, setRelation] = useState<AddRelativeRelation>(initialRelation ?? "parent");
  const partners = coParentOptions ?? [];

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addRelativeAction(formData);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form action={onSubmit} style={{ display: "grid", gap: 20 }}>
      {/* Current family scope — re-validated server-side against the viewer's own families. */}
      <input type="hidden" name="familyId" value={familyId} />
      {/* Targeted add: the anchor person to hang the new relative off (server re-validates). */}
      {anchorPersonId ? (
        <input type="hidden" name="anchorPersonId" value={anchorPersonId} />
      ) : null}

      <label className="kin-form-label">
        {hub.kin.relationFieldLabel}
        <select
          name="relation"
          className="kin-field"
          value={relation}
          onChange={(e) => setRelation(e.target.value as AddRelativeRelation)}
          required
        >
          <option value="parent">{hub.kin.relationOptions.parent}</option>
          <option value="child">{hub.kin.relationOptions.child}</option>
          <option value="partner">{hub.kin.relationOptions.partner}</option>
          <option value="sibling">{hub.kin.relationOptions.sibling}</option>
          <option value="grandparent">{hub.kin.relationOptions.grandparent}</option>
        </select>
      </label>

      {relation === "child" && partners.length > 0 ? (
        <label className="kin-form-label">
          {hub.kin.otherParentLabel}
          <select name="coParentPersonId" className="kin-field" defaultValue={partners[0]!.id}>
            <option value="">{hub.kin.otherParentNone}</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="kin-form-label">
        {hub.kin.nameFieldLabel}
        <input
          type="text"
          name="displayName"
          className="kin-field"
          placeholder={hub.kin.namePlaceholder}
          autoComplete="off"
        />
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
          }}
        >
          {hub.kin.nameHint}
        </span>
      </label>

      <label className="kin-form-label">
        {hub.kin.dobFieldLabel}
        <input type="date" name="birthDate" className="kin-field" />
      </label>

      <label className="kin-form-label">
        {hub.kin.sexFieldLabel}
        <select name="sex" className="kin-field" defaultValue="unknown">
          <option value="unknown">{hub.kin.sexUnknown}</option>
          <option value="male">{hub.kin.sexMale}</option>
          <option value="female">{hub.kin.sexFemale}</option>
        </select>
      </label>

      <label className="kin-form-label">
        {hub.kin.lifeStatusFieldLabel}
        <select
          name="lifeStatus"
          className="kin-field"
          value={lifeStatus}
          onChange={(e) => setLifeStatus(e.target.value === "deceased" ? "deceased" : "living")}
        >
          <option value="living">{hub.kin.lifeStatusLiving}</option>
          <option value="deceased">{hub.kin.lifeStatusDeceased}</option>
        </select>
      </label>

      {lifeStatus === "deceased" ? (
        <label className="kin-form-label">
          {hub.kin.deathYearFieldLabel}
          <input
            type="number"
            name="deathYear"
            className="kin-field"
            placeholder={hub.kin.deathYearPlaceholder}
            min={0}
            max={new Date().getFullYear()}
            step={1}
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
      ) : null}

      {error ? (
        <p
          role="alert"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-danger, #b00)",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}

      <KindredButton
        type="submit"
        label={pending ? hub.kin.submitting : hub.kin.submit}
        disabled={pending}
      />
    </form>
  );
}
