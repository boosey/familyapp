"use client";
/**
 * AddRelativeModal — the Add-a-relative form (issue #32's `AddRelativeForm`) hosted in a dialog over the
 * tree (spec 2026-07-14). The tree's "+" gutter buttons, per-card ⋮ menu, and person panel open this
 * instead of navigating to the removed /hub/kin route. On a successful add it calls `onSuccess` (the
 * canvas refetches the anchor's subtree so the new relative appears, then closes).
 */
import { useEffect } from "react";
import type { AddRelativeRelation, UnplacedMember } from "@chronicle/core";
import { AddRelativeForm } from "./add-relative-form";
import { ModalShell } from "@/app/_kindred/ModalShell";
import { hub } from "@/app/_copy";

export interface AddRelativeModalProps {
  familyId: string;
  anchorPersonId: string;
  initialRelation: AddRelativeRelation;
  /** The anchor's partners — feeds co-parent checkboxes for relation=child. */
  coParentOptions: { id: string; name: string }[];
  /** Pre-selects a co-parent when the add came from a couple's seam "+" (predetermined parents). */
  preselectedCoParentId?: string;
  /** The anchor's children — feeds the partner→kids step offer (#285 / ADR-0027). */
  childOptions?: { id: string; name: string }[];
  /** #251 — unplaced members offered as connect-existing matches when the typed name collides. */
  unplacedMembers?: readonly UnplacedMember[];
  onClose: () => void;
  onSuccess: () => void;
}

export function AddRelativeModal({
  familyId,
  anchorPersonId,
  initialRelation,
  coParentOptions,
  preselectedCoParentId,
  childOptions,
  unplacedMembers,
  onClose,
  onSuccess,
}: AddRelativeModalProps) {
  // Escape closes (mirrors the tree's other dismissables).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <ModalShell
      onOverlayClick={onClose}
      maxWidth={440}
      role="dialog"
      aria-modal="true"
      aria-label={hub.tree.addRelativeHeading}
      data-testid="tree-add-relative-modal"
    >
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <h2
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              fontWeight: 500,
              color: "var(--text-body)",
              margin: 0,
            }}
          >
            {hub.tree.addRelativeHeading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={hub.tree.addRelativeClose}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "1.4rem",
              lineHeight: 1,
              padding: 4,
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <AddRelativeForm
          familyId={familyId}
          anchorPersonId={anchorPersonId}
          initialRelation={initialRelation}
          coParentOptions={coParentOptions}
          preselectedCoParentId={preselectedCoParentId}
          childOptions={childOptions}
          unplacedMembers={unplacedMembers}
          onSuccess={onSuccess}
        />
      </div>
    </ModalShell>
  );
}
