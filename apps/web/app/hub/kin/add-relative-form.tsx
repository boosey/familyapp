"use client";

/**
 * Add-a-relative form (issue #32, blended placement #285) — client component wrapping the
 * `addRelativeAction` server action.
 *
 * Minimal, matching the Kindred form conventions already used by the Ask tab (`.kin-form-label` /
 * `.kin-field` / `<KindredButton>`): a relation `<select>` (the five v1 relations), an OPTIONAL name
 * (blank => core mints an anonymous bridge relative), and optional DOB + life status. The current
 * family scope rides along in a hidden field; the server re-validates it (never trusts the client).
 *
 * #285 / ADR-0027:
 *   - Child: co-parent checkboxes (multi-partner); none checked = this-parent-only (half by derivation).
 *   - Parent/child: nature defaults to biological (editable).
 *   - Partner: when the anchor has kids, confirm offer for step parent-of before write (never silent);
 *     declining writes partner-only.
 *
 * #251 / ADR-0023: when the typed name matches an unplaced family member, we pause and offer to
 * `linkExistingMember` (connect the person already in the family) instead of silently minting a
 * duplicate. "Add as someone new" still calls `addRelativeAction`. Offer-never-silent.
 */
import { useState, useTransition } from "react";
import type { AddRelativeRelation, UnplacedMember } from "@chronicle/core";
import type { KinshipNature } from "@chronicle/db";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { addRelativeAction } from "./actions";
import { linkExistingMemberAction } from "../tree/actions";
import { matchUnplacedByDisplayName, type UnplacedNameCandidate } from "./match-unplaced";

const PARENT_CHILD_NATURES: readonly KinshipNature[] = [
  "biological",
  "adoptive",
  "step",
  "foster",
  "unknown",
];

export function AddRelativeForm({
  familyId,
  anchorPersonId,
  initialRelation,
  coParentOptions,
  preselectedCoParentId,
  childOptions = [],
  unplacedMembers = [],
  onLinkExisting = linkExistingMemberAction,
  onSuccess,
}: {
  familyId: string;
  /** When present (a targeted add from a person panel), rides along so core anchors on this person. */
  anchorPersonId?: string;
  /** Preselects the relation `<select>` when the add was launched with an intended relation. */
  initialRelation?: AddRelativeRelation;
  /** The anchor's partners (#285): co-parent checkboxes for relation=child. */
  coParentOptions?: { id: string; name: string }[];
  /** When the add came from a couple's seam "+", the click predetermined the co-parent — preselect it. */
  preselectedCoParentId?: string;
  /**
   * The anchor's current children (#285 / ADR-0027). When relation=partner and non-empty, we pause on
   * submit to offer step parent-of (never silent). Empty => partner-only path with no prompt.
   */
  childOptions?: { id: string; name: string }[];
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
  // Drives the conditional co-parent / partner-offer UI — shown ONLY for the matching relation.
  const [relation, setRelation] = useState<AddRelativeRelation>(initialRelation ?? "parent");
  const [displayName, setDisplayName] = useState("");
  const [nature, setNature] = useState<KinshipNature>("biological");
  const partners = coParentOptions ?? [];
  // Co-parent checkboxes: preselect the predetermined partner from a couple seam; else none
  // (this-parent-only until the user checks). Multi-partner: any subset.
  const [selectedCoParents, setSelectedCoParents] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (preselectedCoParentId && partners.some((p) => p.id === preselectedCoParentId)) {
      initial.add(preselectedCoParentId);
    }
    return initial;
  });
  // #251: after submit hits a name match, hold the pending FormData + candidates until the user
  // picks "connect existing" or "add as someone new".
  const [pendingMatch, setPendingMatch] = useState<{
    formData: FormData;
    matches: UnplacedNameCandidate[];
    selectedId: string;
  } | null>(null);
  // #285: partner→kids confirm offer before write (never silent).
  // When `linkExistingPersonId` is set, confirm/skip calls onLinkExisting (connect-existing path);
  // otherwise confirm/skip mints via addRelativeAction (create-new path).
  const [pendingStepOffer, setPendingStepOffer] = useState<{
    formData: FormData;
    selectedChildIds: Set<string>;
    linkExistingPersonId?: string;
  } | null>(null);

  function findMatches(name: string): UnplacedNameCandidate[] {
    const exclude = anchorPersonId ? [anchorPersonId] : [];
    return matchUnplacedByDisplayName(name, unplacedMembers, exclude);
  }

  function appendCoParents(formData: FormData) {
    formData.delete("coParentPersonIds");
    for (const id of selectedCoParents) {
      formData.append("coParentPersonIds", id);
    }
  }

  function appendStepParents(formData: FormData, childIds: Iterable<string>) {
    formData.delete("stepParentOfChildIds");
    for (const id of childIds) {
      formData.append("stepParentOfChildIds", id);
    }
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
      setPendingStepOffer(null);
      onSuccess?.();
    });
  }

  function onSubmit(formData: FormData) {
    setError(null);
    if (relation === "child") appendCoParents(formData);
    if (relation === "parent" || relation === "child") {
      formData.set("nature", nature);
    }

    const rawName = formData.get("displayName");
    const typed = typeof rawName === "string" ? rawName : displayName;
    const matches = findMatches(typed);
    if (matches.length > 0) {
      const first = matches[0]!;
      setPendingMatch({ formData, matches, selectedId: first.personId });
      return;
    }

    // Partner→kids offer: pause when the anchor has children (ADR-0027 — never silent).
    if (relation === "partner" && childOptions.length > 0) {
      setPendingStepOffer({
        formData,
        selectedChildIds: new Set(childOptions.map((c) => c.id)),
      });
      return;
    }

    mintRelative(formData);
  }

  function linkExistingFromForm(existingPersonId: string, formData: FormData, stepKids: string[]) {
    const rel = (formData.get("relation") as AddRelativeRelation) || relation;
    const coParents =
      rel === "child"
        ? [...formData.getAll("coParentPersonIds")].filter(
            (v): v is string => typeof v === "string" && !!v.trim(),
          )
        : [];
    const rawNature = formData.get("nature");
    const natureArg =
      (rel === "parent" || rel === "child") &&
      typeof rawNature === "string" &&
      (PARENT_CHILD_NATURES as readonly string[]).includes(rawNature)
        ? (rawNature as KinshipNature)
        : undefined;
    setError(null);
    startTransition(async () => {
      const res = await onLinkExisting(
        familyId,
        existingPersonId,
        rel,
        anchorPersonId,
        coParents.length === 1 ? coParents[0] : undefined,
        {
          coParentPersonIds: coParents.length > 0 ? coParents : undefined,
          stepParentOfChildIds: stepKids.length > 0 ? stepKids : undefined,
          nature: natureArg,
        },
      );
      if (!res.ok) {
        setError(hub.kin.existingMatchFailed);
        return;
      }
      setPendingMatch(null);
      setPendingStepOffer(null);
      onSuccess?.();
    });
  }

  function connectExisting() {
    if (!pendingMatch) return;
    const existingPersonId = pendingMatch.selectedId;
    const fd = pendingMatch.formData;
    const rel = (fd.get("relation") as AddRelativeRelation) || relation;
    // Partner→kids offer before link (ADR-0027 — never silent), same as create-new.
    if (rel === "partner" && childOptions.length > 0) {
      setPendingMatch(null);
      setPendingStepOffer({
        formData: fd,
        selectedChildIds: new Set(childOptions.map((c) => c.id)),
        linkExistingPersonId: existingPersonId,
      });
      return;
    }
    const stepKids =
      rel === "partner"
        ? [...fd.getAll("stepParentOfChildIds")].filter(
            (v): v is string => typeof v === "string" && !!v.trim(),
          )
        : [];
    linkExistingFromForm(existingPersonId, fd, stepKids);
  }

  function confirmStepOffer(attachKids: boolean) {
    if (!pendingStepOffer) return;
    const fd = pendingStepOffer.formData;
    if (attachKids) {
      appendStepParents(fd, pendingStepOffer.selectedChildIds);
    } else {
      appendStepParents(fd, []);
    }
    const stepKids = attachKids ? [...pendingStepOffer.selectedChildIds] : [];
    if (pendingStepOffer.linkExistingPersonId) {
      linkExistingFromForm(pendingStepOffer.linkExistingPersonId, fd, stepKids);
      return;
    }
    // Create-new path (or create-new after declining an existing-match).
    mintRelative(fd);
  }

  const matchName =
    pendingMatch?.matches.find((m) => m.personId === pendingMatch.selectedId)?.displayName?.trim() ||
    displayName.trim();

  const showNature = relation === "parent" || relation === "child";
  const gated = !!pendingMatch || !!pendingStepOffer;

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
            setPendingStepOffer(null);
          }}
          required
          disabled={gated}
        >
          <option value="parent">{hub.kin.relationOptions.parent}</option>
          <option value="child">{hub.kin.relationOptions.child}</option>
          <option value="partner">{hub.kin.relationOptions.partner}</option>
          <option value="sibling">{hub.kin.relationOptions.sibling}</option>
          <option value="grandparent">{hub.kin.relationOptions.grandparent}</option>
        </select>
      </label>

      {relation === "child" && partners.length > 0 ? (
        <fieldset
          style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}
          data-testid="add-relative-coparents"
        >
          <legend className="kin-form-label" style={{ padding: 0 }}>
            {hub.kin.otherParentLabel}
          </legend>
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-muted)",
            }}
          >
            {hub.kin.otherParentHint}
          </span>
          {partners.map((p) => (
            <label
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui)",
                color: "var(--text-body)",
              }}
            >
              <input
                type="checkbox"
                checked={selectedCoParents.has(p.id)}
                disabled={gated}
                onChange={(e) => {
                  setSelectedCoParents((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    return next;
                  });
                }}
                data-testid={`add-relative-coparent-${p.id}`}
              />
              {p.name}
            </label>
          ))}
        </fieldset>
      ) : null}

      {showNature ? (
        <label className="kin-form-label">
          {hub.kin.natureFieldLabelAdd}
          <select
            name="nature"
            className="kin-field"
            value={nature}
            onChange={(e) => setNature(e.target.value as KinshipNature)}
            disabled={gated}
            data-testid="add-relative-nature"
          >
            {PARENT_CHILD_NATURES.map((n) => (
              <option key={n} value={n}>
                {hub.kin.natureOptions[n]}
              </option>
            ))}
          </select>
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-muted)",
            }}
          >
            {hub.kin.natureHintBiological}
          </span>
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
            setPendingStepOffer(null);
          }}
          disabled={gated}
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
        <input type="date" name="birthDate" className="kin-field" disabled={gated} />
      </label>

      <label className="kin-form-label">
        {hub.kin.sexFieldLabel}
        <select name="sex" className="kin-field" defaultValue="unknown" disabled={gated}>
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
          disabled={gated}
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
            disabled={gated}
          />
        </label>
      ) : null}

      {pendingStepOffer ? (
        <div
          role="group"
          aria-label={hub.kin.stepParentOfferHeading}
          data-testid="add-relative-step-offer"
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
            {hub.kin.stepParentOfferIntro}
          </p>
          {childOptions.map((c) => (
            <label
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui)",
                color: "var(--text-body)",
              }}
            >
              <input
                type="checkbox"
                checked={pendingStepOffer.selectedChildIds.has(c.id)}
                onChange={(e) => {
                  setPendingStepOffer((prev) => {
                    if (!prev) return prev;
                    const next = new Set(prev.selectedChildIds);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    return { ...prev, selectedChildIds: next };
                  });
                }}
                data-testid={`add-relative-step-child-${c.id}`}
              />
              {c.name}
            </label>
          ))}
          <KindredButton
            type="button"
            label={pending ? hub.kin.submitting : hub.kin.stepParentOfferConfirm}
            disabled={pending}
            onClick={() => confirmStepOffer(true)}
            data-testid="add-relative-step-confirm"
          />
          <KindredButton
            type="button"
            variant="secondary"
            label={hub.kin.stepParentOfferSkip}
            disabled={pending}
            onClick={() => confirmStepOffer(false)}
            data-testid="add-relative-step-skip"
          />
        </div>
      ) : pendingMatch ? (
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
            onClick={() => {
              const fd = pendingMatch.formData;
              if (relation === "partner" && childOptions.length > 0) {
                setPendingMatch(null);
                setPendingStepOffer({
                  formData: fd,
                  selectedChildIds: new Set(childOptions.map((c) => c.id)),
                });
                return;
              }
              mintRelative(fd);
            }}
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
