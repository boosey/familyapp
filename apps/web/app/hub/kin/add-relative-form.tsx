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
 *
 * #251 / ADR-0023: when the typed name matches an unplaced family member, we pause and offer to
 * `linkExistingMember` (connect the person already in the family) instead of silently minting a
 * duplicate. "Add as someone new" still calls `addRelativeAction`. Offer-never-silent.
 */
import { useState, useTransition } from "react";
import type { AddRelativeRelation, UnplacedMember } from "@chronicle/core";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { addRelativeAction } from "./actions";
import { linkExistingMemberAction } from "../tree/actions";
import { matchUnplacedByDisplayName, type UnplacedNameCandidate } from "./match-unplaced";

export function AddRelativeForm({
  familyId,
  anchorPersonId,
  initialRelation,
  coParentOptions,
  preselectedCoParentId,
  unplacedMembers = [],
  onLinkExisting = linkExistingMemberAction,
  onSuccess,
}: {
  familyId: string;
  /** When present (a targeted add from a person panel), rides along so core anchors on this person. */
  anchorPersonId?: string;
  /** Preselects the relation `<select>` when the add was launched with an intended relation. */
  initialRelation?: AddRelativeRelation;
  /** The anchor's partners (issue: adding a child only linked one parent, not their partner too).
   *  Non-empty => the "Other parent" picker shows for relation=child. */
  coParentOptions?: { id: string; name: string }[];
  /** When the add came from a couple's seam "+", the click predetermined the co-parent — preselect it
   *  (falling back to the first partner if it isn't among the options). */
  preselectedCoParentId?: string;
  /**
   * #251 — active members not yet on a kinship edge. When the typed name matches one, we offer to
   * connect them instead of minting a duplicate. Empty/omitted => no match UI (create-only path).
   */
  unplacedMembers?: readonly UnplacedMember[];
  /** Overridable in tests; defaults to the real place-in-tree link action. */
  onLinkExisting?: typeof linkExistingMemberAction;
  /** Called after a successful add (no error). The tree modal uses it to close + refetch the anchor. */
  onSuccess?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Drives the conditional "Year they died" field — shown ONLY when the relative is deceased
  // (spec §4). The select is controlled so the death-year field appears/disappears live.
  const [lifeStatus, setLifeStatus] = useState<"living" | "deceased">("living");
  // Drives the conditional co-parent picker — shown ONLY for relation=child. The relation select must
  // be controlled so the field appears/disappears live as the user changes it.
  const [relation, setRelation] = useState<AddRelativeRelation>(initialRelation ?? "parent");
  const [displayName, setDisplayName] = useState("");
  // #251: after submit hits a name match, hold the pending FormData + candidates until the user
  // picks "connect existing" or "add as someone new".
  const [pendingMatch, setPendingMatch] = useState<{
    formData: FormData;
    matches: UnplacedNameCandidate[];
    selectedId: string;
  } | null>(null);
  const partners = coParentOptions ?? [];
  // The co-parent the click predetermined, when it's a real partner; else default to the first partner.
  const defaultCoParentId =
    preselectedCoParentId && partners.some((p) => p.id === preselectedCoParentId)
      ? preselectedCoParentId
      : partners[0]?.id;

  function findMatches(name: string): UnplacedNameCandidate[] {
    const exclude = anchorPersonId ? [anchorPersonId] : [];
    return matchUnplacedByDisplayName(name, unplacedMembers, exclude);
  }

  function mintRelative(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addRelativeAction(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setPendingMatch(null);
      onSuccess?.();
    });
  }

  function onSubmit(formData: FormData) {
    setError(null);
    const rawName = formData.get("displayName");
    const typed = typeof rawName === "string" ? rawName : displayName;
    const matches = findMatches(typed);
    if (matches.length > 0) {
      const first = matches[0]!;
      setPendingMatch({ formData, matches, selectedId: first.personId });
      return;
    }
    mintRelative(formData);
  }

  function connectExisting() {
    if (!pendingMatch) return;
    const existingPersonId = pendingMatch.selectedId;
    const fd = pendingMatch.formData;
    const rel = (fd.get("relation") as AddRelativeRelation) || relation;
    const rawCo = fd.get("coParentPersonId");
    const coParent =
      rel === "child" && typeof rawCo === "string" && rawCo.trim() ? rawCo.trim() : undefined;
    setError(null);
    startTransition(async () => {
      const res = await onLinkExisting(
        familyId,
        existingPersonId,
        rel,
        anchorPersonId,
        coParent,
      );
      if (!res.ok) {
        setError(hub.kin.existingMatchFailed);
        return;
      }
      setPendingMatch(null);
      onSuccess?.();
    });
  }

  const matchName =
    pendingMatch?.matches.find((m) => m.personId === pendingMatch.selectedId)?.displayName?.trim() ||
    displayName.trim();

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
          onChange={(e) => {
            setRelation(e.target.value as AddRelativeRelation);
            setPendingMatch(null);
          }}
          required
          disabled={!!pendingMatch}
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
          <select
            name="coParentPersonId"
            className="kin-field"
            defaultValue={defaultCoParentId}
            disabled={!!pendingMatch}
          >
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
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setPendingMatch(null);
          }}
          disabled={!!pendingMatch}
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
        <input type="date" name="birthDate" className="kin-field" disabled={!!pendingMatch} />
      </label>

      <label className="kin-form-label">
        {hub.kin.sexFieldLabel}
        <select name="sex" className="kin-field" defaultValue="unknown" disabled={!!pendingMatch}>
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
          disabled={!!pendingMatch}
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
            disabled={!!pendingMatch}
          />
        </label>
      ) : null}

      {pendingMatch ? (
        <div
          role="group"
          aria-label={hub.kin.existingMatchAria}
          data-testid="add-relative-existing-match"
          style={{ display: "grid", gap: 12 }}
        >
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-body)",
              margin: 0,
            }}
          >
            {hub.kin.existingMatchPrompt(matchName || hub.unplaced.unnamedMember)}
          </p>
          {pendingMatch.matches.length > 1 ? (
            <label className="kin-form-label">
              {hub.kin.existingMatchPickLabel}
              <select
                className="kin-field"
                value={pendingMatch.selectedId}
                onChange={(e) =>
                  setPendingMatch({ ...pendingMatch, selectedId: e.target.value })
                }
                data-testid="add-relative-existing-pick"
              >
                {pendingMatch.matches.map((m) => (
                  <option key={m.personId} value={m.personId}>
                    {m.displayName?.trim() || hub.unplaced.unnamedMember}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <KindredButton
            type="button"
            label={pending ? hub.kin.existingMatchConnecting : hub.kin.existingMatchUse}
            disabled={pending}
            onClick={connectExisting}
            data-testid="add-relative-use-existing"
          />
          <KindredButton
            type="button"
            variant="secondary"
            label={hub.kin.existingMatchCreateNew}
            disabled={pending}
            onClick={() => mintRelative(pendingMatch.formData)}
            data-testid="add-relative-create-new"
          />
        </div>
      ) : (
        <KindredButton
          type="submit"
          label={pending ? hub.kin.submitting : hub.kin.submit}
          disabled={pending}
        />
      )}

      {error ? (
        <p
          role="alert"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-danger)",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
