"use client";
/**
 * PersonDetails — the details sheet opened by a DOUBLE-click/double-tap on a card (tree Slice A, and
 * Slice C's edit mode, #4/#5). Replaces the deleted PersonPanel.
 *
 * Slice A gave it a read-only view (name, dates, relation, nav links). Slice C (ADR-0021) adds an
 * EDIT affordance and an inline edit form, shown ONLY when the server says the viewer may edit this
 * person. The editability predicate (`canEditPerson`) is NEVER shipped to the client: on open we call
 * `personEditabilityAction` to get a bare boolean; Save calls `savePersonEditAction`, which wraps the
 * core write choke point that RE-CHECKS the predicate (a forged flag can't write). On success we call
 * `onSaved` so the canvas refetches the anchor subtree and the card updates (name, sex color, dates).
 *
 * #5: an UNKNOWN card (unidentified / nameless) opens the sheet directly in edit mode when editable
 * (via `startInEdit`), else read-only with no Edit button.
 *
 * Read-only view is otherwise navigational only: it NEVER re-roots (that is the kebab's Focus action)
 * and its three nav links (Stories · Photos · Mentions) are unchanged from Slice A.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { hub } from "@/app/_copy";
import type { KinRelation, PersonSex, TreeNode } from "@chronicle/core";
import { KindredButton } from "@/app/_kindred";
import { datesLineFor, displayNameFor, isAnonymousBridge } from "./person-node";
import {
  personEditabilityAction,
  savePersonEditAction,
  type PersonEditabilityResult,
  type SavePersonEditResult,
} from "./actions";

const RELATION_LABEL: Record<KinRelation, string> = hub.kin.relationLabel;

/** Injected seams so the sheet is testable without the server (default to the real server actions). */
export type CheckEditableFn = (familyId: string, personId: string) => Promise<PersonEditabilityResult>;
export type SaveEditFn = (
  familyId: string,
  personId: string,
  patch: {
    displayName?: string;
    /** Coarse year only (the tree's grain); null clears it. Full m/d editing is the self-profile path. */
    birthYear?: number | null;
    lifeStatus?: "living" | "deceased";
    deathYear?: number | null;
    sex?: PersonSex;
  },
) => Promise<SavePersonEditResult>;

export interface PersonDetailsProps {
  node: TreeNode;
  /** Relation of this person to the VIEWER, derived client-side; "self"/null ⇒ no relation line. */
  relationToViewer: KinRelation | "self" | null;
  /** The family context — passed to the edit actions for server-side scope re-validation. */
  familyId: string;
  /** #5: open the sheet directly in edit mode (used for unknown cards) when the viewer may edit. */
  startInEdit?: boolean;
  onClose: () => void;
  /** Called after a successful save so the canvas can refetch the anchor subtree. */
  onSaved?: (personId: string) => void;
  /** Overridable for tests; default to the real server actions. */
  checkEditable?: CheckEditableFn;
  saveEdit?: SaveEditFn;
}

export function PersonDetails({
  node,
  relationToViewer,
  familyId,
  startInEdit,
  onClose,
  onSaved,
  checkEditable = personEditabilityAction,
  saveEdit = savePersonEditAction,
}: PersonDetailsProps) {
  const name = displayNameFor(node);
  const relation =
    relationToViewer === null || relationToViewer === "self" ? "" : RELATION_LABEL[relationToViewer];
  const dates = datesLineFor(node);
  const anon = isAnonymousBridge(node);
  const hasName = node.displayName != null && node.displayName.trim().length > 0;
  const rootRef = useRef<HTMLElement | null>(null);

  const mentionsHref = `/hub/about/${node.personId}`;

  // Editability is resolved server-side on open (the predicate never ships to the client).
  const [editable, setEditable] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    void checkEditable(familyId, node.personId)
      .then((r) => {
        if (!alive) return;
        const ok = r.ok && r.editable;
        setEditable(ok);
        // #5: an unknown card opens straight into edit mode when permitted; else stays read-only.
        if (ok && startInEdit) setEditing(true);
      })
      .catch(() => {
        // A failed editability probe leaves the sheet read-only (no Edit) — never a client crash.
      });
    return () => {
      alive = false;
    };
  }, [checkEditable, familyId, node.personId, startInEdit]);

  // Dismiss on Escape / outside-click (× is the explicit control). Suppressed WHILE editing so an
  // errant outside-click doesn't discard in-progress edits — the form's Cancel is the exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editing) onClose();
    };
    const onDocPointer = (e: PointerEvent) => {
      if (editing) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDocPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocPointer);
    };
  }, [onClose, editing]);

  return (
    <aside
      ref={rootRef}
      role="dialog"
      aria-label={name}
      data-testid="tree-person-details"
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: 280,
        maxWidth: "calc(100% - 24px)",
        background: "var(--surface-card)",
        border: "var(--border-width) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg, 0 8px 30px rgba(0,0,0,0.12))",
        padding: 20,
        zIndex: 2,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={hub.tree.detailsClose}
        data-testid="tree-details-close"
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontSize: "1.25rem",
          lineHeight: 1,
          color: "var(--text-muted)",
        }}
      >
        {"×"}
      </button>

      {editing ? (
        <PersonEditForm
          node={node}
          familyId={familyId}
          saveEdit={saveEdit}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved?.(node.personId);
            onClose();
          }}
        />
      ) : (
        <>
          <h2
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              fontWeight: 500,
              color: "var(--text-body)",
              margin: "0 24px 4px 0",
              fontStyle: anon ? "italic" : "normal",
            }}
          >
            {name}
          </h2>

          {(relation || dates) && (
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                color: "var(--text-muted)",
                margin: "0 0 4px",
              }}
            >
              {[relation, dates].filter(Boolean).join(" · ")}
            </p>
          )}

          {!hasName && !anon && (
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "0.7rem",
                color: "var(--text-meta)",
                margin: "0 0 18px",
              }}
            >
              {hub.tree.unknownRelative}
            </p>
          )}

          {editable && (
            <div style={{ marginTop: 12 }}>
              <KindredButton
                variant="primary"
                size="small"
                type="button"
                data-testid="tree-details-edit"
                onClick={() => setEditing(true)}
              >
                {hub.tree.editButton}
              </KindredButton>
            </div>
          )}

          <nav style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {/* Stories/Photos contributed — destinations arrive in Slice B; disabled + "coming soon". */}
            <ComingSoonLink label={hub.tree.detailsStories} testId="tree-details-stories" />
            <ComingSoonLink label={hub.tree.detailsPhotos} testId="tree-details-photos" />
            {/* Mentions — the one live destination in Slice A. */}
            <Link href={mentionsHref} style={{ textDecoration: "none" }} data-testid="tree-details-mentions">
              <KindredButton variant="secondary" size="small" fullWidth type="button">
                {hub.tree.detailsMentions}
              </KindredButton>
            </Link>
          </nav>
        </>
      )}
    </aside>
  );
}

/** Inline identity edit form (Slice C, ADR-0021). Name / birth date / sex / life status (+ death year). */
function PersonEditForm({
  node,
  familyId,
  saveEdit,
  onCancel,
  onSaved,
}: {
  node: TreeNode;
  familyId: string;
  saveEdit: SaveEditFn;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(node.displayName ?? "");
  const [birthYear, setBirthYear] = useState(node.birthYear != null ? String(node.birthYear) : "");
  const [sex, setSex] = useState<PersonSex>(node.sex);
  const [lifeStatus, setLifeStatus] = useState<"living" | "deceased">(node.lifeStatus);
  const [deathYear, setDeathYear] = useState(node.deathYear != null ? String(node.deathYear) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Parse a year input: "" ⇒ null (cleared); a valid integer ⇒ the number; anything else ⇒ NaN. */
  const parsedYear = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isInteger(n) ? n : NaN;
  };

  const submit = async () => {
    setError(null);
    const trimmedName = displayName.trim();
    if (trimmedName.length === 0) {
      setError(hub.tree.editErrorName);
      return;
    }
    const by = parsedYear(birthYear);
    if (Number.isNaN(by)) {
      setError(hub.tree.editErrorBirthDate);
      return;
    }
    const patch: Parameters<SaveEditFn>[2] = {
      displayName: trimmedName,
      sex,
      lifeStatus,
      // Coarse year only (the tree's grain); null clears it.
      birthYear: by,
    };
    if (lifeStatus === "deceased") {
      const dy = parsedYear(deathYear);
      patch.deathYear = Number.isNaN(dy) ? null : dy;
    }

    setSaving(true);
    try {
      const res = await saveEdit(familyId, node.personId, patch);
      if (res.ok) {
        onSaved();
        return;
      }
      setError(
        res.error === "not-allowed"
          ? hub.tree.editErrorNotAllowed
          : res.error === "bad-input"
            ? hub.tree.editErrorBirthDate
            : hub.tree.editErrorGeneric,
      );
    } catch {
      setError(hub.tree.editErrorGeneric);
    } finally {
      setSaving(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "var(--text-meta)",
    display: "block",
    marginBottom: 3,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "var(--font-ui)",
    fontSize: "0.85rem",
    padding: "6px 8px",
    borderRadius: "var(--radius-md, 8px)",
    border: "var(--border-width) solid var(--border)",
    background: "var(--surface-page)",
    color: "var(--text-body)",
  };

  return (
    <form
      data-testid="tree-person-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{ display: "grid", gap: 12, margin: "0 20px 0 0" }}
    >
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: 0,
        }}
      >
        {hub.tree.editHeading}
      </h2>

      <label style={{ display: "block" }}>
        <span style={labelStyle}>{hub.tree.editName}</span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={hub.tree.editNamePlaceholder}
          data-testid="tree-edit-name"
          style={inputStyle}
        />
      </label>

      <label style={{ display: "block" }}>
        <span style={labelStyle}>{hub.tree.editBirthYear}</span>
        <input
          type="number"
          inputMode="numeric"
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
          data-testid="tree-edit-birth-year"
          style={inputStyle}
        />
      </label>

      <label style={{ display: "block" }}>
        <span style={labelStyle}>{hub.tree.editSex}</span>
        <select
          value={sex}
          onChange={(e) => setSex(e.target.value as PersonSex)}
          data-testid="tree-edit-sex"
          style={inputStyle}
        >
          <option value="unknown">{hub.tree.editSexUnknown}</option>
          <option value="female">{hub.tree.editSexFemale}</option>
          <option value="male">{hub.tree.editSexMale}</option>
        </select>
      </label>

      <label style={{ display: "block" }}>
        <span style={labelStyle}>{hub.tree.editLifeStatus}</span>
        <select
          value={lifeStatus}
          onChange={(e) => setLifeStatus(e.target.value as "living" | "deceased")}
          data-testid="tree-edit-life-status"
          style={inputStyle}
        >
          <option value="living">{hub.tree.editLifeStatusLiving}</option>
          <option value="deceased">{hub.tree.editLifeStatusDeceased}</option>
        </select>
      </label>

      {lifeStatus === "deceased" && (
        <label style={{ display: "block" }}>
          <span style={labelStyle}>{hub.tree.editDeathYear}</span>
          <input
            type="number"
            inputMode="numeric"
            value={deathYear}
            onChange={(e) => setDeathYear(e.target.value)}
            data-testid="tree-edit-death-year"
            style={inputStyle}
          />
        </label>
      )}

      {error && (
        <p
          role="alert"
          data-testid="tree-edit-error"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "0.75rem",
            color: "var(--danger, #b3261e)",
            margin: 0,
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        <KindredButton
          variant="primary"
          size="small"
          type="submit"
          disabled={saving}
          data-testid="tree-edit-save"
        >
          {saving ? hub.tree.editSaving : hub.tree.editSave}
        </KindredButton>
        <KindredButton
          variant="secondary"
          size="small"
          type="button"
          disabled={saving}
          onClick={onCancel}
          data-testid="tree-edit-cancel"
        >
          {hub.tree.editCancel}
        </KindredButton>
      </div>
    </form>
  );
}

/** A disabled nav link with a "coming soon" affordance (a real destination lands in Slice B). */
function ComingSoonLink({ label, testId }: { label: string; testId: string }) {
  return (
    <span
      data-testid={testId}
      title={hub.tree.comingSoon}
      style={{ display: "block", position: "relative" }}
    >
      <KindredButton variant="secondary" size="small" fullWidth type="button" disabled>
        {label}
      </KindredButton>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          right: 12,
          transform: "translateY(-50%)",
          fontFamily: "var(--font-ui)",
          fontSize: "0.62rem",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-meta)",
          pointerEvents: "none",
        }}
      >
        {hub.tree.comingSoon}
      </span>
    </span>
  );
}
