"use client";
/**
 * PersonDetails — the details sheet opened by a DOUBLE-click/double-tap on a card (tree Slice A, and
 * Slice C's edit mode, #4/#5). Replaces the deleted PersonPanel.
 *
 * Chrome lives in PersonDetails.module.css (token-driven). Sheet surface stays flat (#223); action
 * icons match hub ActionButton (#7). Edge governance lives on the line-governance menu, not here.
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
import { BookOpen, Images, Quote, SquarePen } from "lucide-react";
import { hub } from "@/app/_copy";
import type { KinRelation, PersonSex, TreeNode } from "@chronicle/core";
import { ICON_SHEET_GLYPH_SIZE } from "../icon-sheet-constants";
import styles from "./PersonDetails.module.css";
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
  /**
   * #330 fix — Tree's node-anchored wrapper grows with the canvas, so `position: absolute` (the
   * default, `"anchored"`) keeps the sheet pinned to that wrapper's own top/right corner, which is
   * always in view for Tree's fixed-height frame. List's wrapper instead grows with the (potentially
   * long, scrollable) row list, so an `"anchored"` sheet can land far below the viewport when a lower
   * row is selected. `"viewport"` uses `position: fixed` with the SAME 12px inset so the sheet always
   * stays on-screen regardless of scroll position. Tree never passes this — its behavior is unchanged.
   */
  placement?: "anchored" | "viewport";
  onClose: () => void;
  /** Called after a successful save so the canvas can refetch the anchor subtree. */
  onSaved?: (personId: string) => void;
  /**
   * #334 (originally Slice D #6): open the in-place person-bound Invite modal for this person.
   * Rendered as an "Invite" button only when `node.inviteStatus === "invitable"`. The SAME handler
   * backs the kebab's Invite… item on Tree (canvas passes it to both, #334 AC 5); List (`FamilyTab`)
   * passes its own instance opening the same `PersonInviteModal`. Absent ⇒ no invite affordance (e.g.
   * a bare test mount).
   */
  onInvite?: (node: TreeNode) => void;
  /** Overridable for tests; default to the real server actions. */
  checkEditable?: CheckEditableFn;
  saveEdit?: SaveEditFn;
}

export function PersonDetails({
  node,
  relationToViewer,
  familyId,
  startInEdit,
  placement = "anchored",
  onClose,
  onSaved,
  onInvite,
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

  // Slice B: the three contribution links now point at the unified per-person page's sections.
  const storiesHref = `/hub/person/${node.personId}?section=stories`;
  const photosHref = `/hub/person/${node.personId}?section=photos`;
  const mentionsHref = `/hub/person/${node.personId}?section=mentions`;

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
      data-placement={placement}
      className={styles.sheet}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={hub.tree.detailsClose}
        data-testid="tree-details-close"
        className={styles.close}
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
          <h2 className={anon ? styles.titleAnon : styles.title}>{name}</h2>

          {(relation || dates) && (
            <p className={styles.meta}>{[relation, dates].filter(Boolean).join(" · ")}</p>
          )}

          {!hasName && !anon && <p className={styles.unknownNote}>{hub.tree.unknownRelative}</p>}

          <div className={styles.actions} data-testid="tree-details-actions">
            {editable && (
              <button
                type="button"
                data-testid="tree-details-edit"
                className={styles.iconAction}
                aria-label={hub.tree.editButton}
                onClick={() => setEditing(true)}
              >
                <SquarePen size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
              </button>
            )}
            <Link
              href={storiesHref}
              className={styles.iconAction}
              data-testid="tree-details-stories"
              aria-label={hub.tree.detailsStories}
            >
              <BookOpen size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
            </Link>
            <Link
              href={photosHref}
              className={styles.iconAction}
              data-testid="tree-details-photos"
              aria-label={hub.tree.detailsPhotos}
            >
              <Images size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
            </Link>
            <Link
              href={mentionsHref}
              className={styles.iconAction}
              data-testid="tree-details-mentions"
              aria-label={hub.tree.detailsMentions}
            >
              <Quote size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
            </Link>
          </div>

          {/* #334 (originally Slice D #6): invite affordance — a button when invitable, a muted note
              when pending, nothing for not-applicable. Clicking opens the in-place
              person-bound Invite modal (the caller wires `onInvite` to open it). */}
          {onInvite && node.inviteStatus === "invitable" && (
            <div className={styles.inviteRow}>
              <button
                type="button"
                data-testid="tree-details-invite"
                className={styles.buttonSecondary}
                onClick={() => onInvite(node)}
              >
                {hub.tree.inviteButton}
              </button>
            </div>
          )}
          {node.inviteStatus === "pending" && (
            <p data-testid="tree-details-invite-pending" className={styles.invitePending}>
              {hub.tree.invitePendingNote}
            </p>
          )}
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
      // Reject an invalid year instead of silently coercing NaN → null, which would quietly clear an
      // existing year of death on a typo (matches the birthYear validation above).
      if (Number.isNaN(dy)) {
        setError(hub.tree.editErrorDeathDate);
        return;
      }
      patch.deathYear = dy;
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

  return (
    <form
      data-testid="tree-person-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className={styles.form}
    >
      <h2 className={styles.formTitle}>{hub.tree.editHeading}</h2>

      <label className={styles.field}>
        <span className={styles.labelText}>{hub.tree.editName}</span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={hub.tree.editNamePlaceholder}
          data-testid="tree-edit-name"
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.labelText}>{hub.tree.editBirthYear}</span>
        <input
          type="number"
          inputMode="numeric"
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
          data-testid="tree-edit-birth-year"
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.labelText}>{hub.tree.editSex}</span>
        <select
          value={sex}
          onChange={(e) => setSex(e.target.value as PersonSex)}
          data-testid="tree-edit-sex"
          className={styles.input}
        >
          <option value="unknown">{hub.tree.editSexUnknown}</option>
          <option value="female">{hub.tree.editSexFemale}</option>
          <option value="male">{hub.tree.editSexMale}</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.labelText}>{hub.tree.editLifeStatus}</span>
        <select
          value={lifeStatus}
          onChange={(e) => setLifeStatus(e.target.value as "living" | "deceased")}
          data-testid="tree-edit-life-status"
          className={styles.input}
        >
          <option value="living">{hub.tree.editLifeStatusLiving}</option>
          <option value="deceased">{hub.tree.editLifeStatusDeceased}</option>
        </select>
      </label>

      {lifeStatus === "deceased" && (
        <label className={styles.field}>
          <span className={styles.labelText}>{hub.tree.editDeathYear}</span>
          <input
            type="number"
            inputMode="numeric"
            value={deathYear}
            onChange={(e) => setDeathYear(e.target.value)}
            data-testid="tree-edit-death-year"
            className={styles.input}
          />
        </label>
      )}

      {error && (
        <p role="alert" data-testid="tree-edit-error" className={styles.formError}>
          {error}
        </p>
      )}

      <div className={styles.formActions}>
        <button
          type="submit"
          disabled={saving}
          data-testid="tree-edit-save"
          className={styles.buttonPrimary}
        >
          {saving ? hub.tree.editSaving : hub.tree.editSave}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          data-testid="tree-edit-cancel"
          className={styles.buttonSecondary}
        >
          {hub.tree.editCancel}
        </button>
      </div>
    </form>
  );
}
