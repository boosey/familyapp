"use client";
/**
 * AddRelativeModal — the Add-a-relative form (issue #32's `AddRelativeForm`) hosted in a dialog over the
 * tree (spec 2026-07-14). The tree's "+" gutter buttons, per-card ⋮ menu, and person panel open this
 * instead of navigating to the removed /hub/kin route. On a successful add it calls `onSuccess` (the
 * canvas refetches the anchor's subtree so the new relative appears, then closes).
 */
import { useEffect } from "react";
import type { AddRelativeRelation } from "@chronicle/core";
import { AddRelativeForm } from "../kin/add-relative-form";
import { hub } from "@/app/_copy";

export interface AddRelativeModalProps {
  familyId: string;
  anchorPersonId: string;
  initialRelation: AddRelativeRelation;
  /** The anchor's partners — feeds the "Other parent" picker for relation=child. */
  coParentOptions: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

export function AddRelativeModal({
  familyId,
  anchorPersonId,
  initialRelation,
  coParentOptions,
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
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={hub.tree.addRelativeHeading}
        data-testid="tree-add-relative-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-card)",
          border: "var(--border-width) solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lift, 0 10px 25px rgba(0,0,0,0.18))",
          padding: 24,
          width: "100%",
          maxWidth: 440,
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
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
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}
