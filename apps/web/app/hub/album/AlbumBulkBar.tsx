"use client";

/**
 * AlbumBulkBar (Phase C · item 6) — the sticky action bar that appears once ≥1 photo is selected in
 * the album's selection mode. It carries the live count and the four bulk actions; `AlbumGrid` owns the
 * selected-id set and wires each handler:
 *   - Ask  → deep-links the ask surface with every selected photo pre-selected as a subject.
 *   - Tell → deep-links the tell composer with the selection (first = cover, rest = accompaniment).
 *   - Delete selected → two-tap confirm owned HERE; the confirmed tap calls `onDelete` (the caller runs
 *     the bulk server action + refresh + result note).
 *   - Clear → drop the selection (stays in selection mode).
 *
 * Purely presentational apart from the local two-tap arming state. Token-styled, elder-friendly targets.
 */
import { useState } from "react";
import { hub } from "@/app/_copy";

export function AlbumBulkBar({
  count,
  onAsk,
  onTell,
  onDelete,
  onClear,
  deleting = false,
}: {
  count: number;
  onAsk: () => void;
  onTell: () => void;
  /** Called on the CONFIRMED (second) delete tap. Caller owns the async + refresh + note. */
  onDelete: () => void;
  onClear: () => void;
  /** Disables the actions while the bulk delete is in flight. */
  deleting?: boolean;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function onDeleteTap() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete();
    setConfirmingDelete(false);
  }

  const btn: React.CSSProperties = {
    minHeight: 44,
    padding: "10px 16px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 500,
    borderRadius: "var(--radius-pill)",
    cursor: deleting ? "not-allowed" : "pointer",
    opacity: deleting ? 0.6 : 1,
    whiteSpace: "nowrap",
  };

  return (
    <div
      role="group"
      aria-label={hub.album.bulkBarAria}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 3,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        margin: "0 0 16px",
        padding: "12px 16px",
        borderRadius: "var(--radius-md)",
        background: "var(--surface-card)",
        border: "var(--border-width) solid var(--border-strong)",
        boxShadow: "var(--shadow-lift)",
      }}
    >
      <span
        aria-live="polite"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          fontWeight: 600,
          color: "var(--text-heading)",
          marginRight: "auto",
        }}
      >
        {hub.album.bulkSelectedCount(count)}
      </span>

      <button
        type="button"
        onClick={onAsk}
        disabled={deleting}
        style={{
          ...btn,
          color: "var(--text-body)",
          background: "transparent",
          border: "var(--border-width) solid var(--border-strong)",
        }}
      >
        {hub.album.bulkAsk}
      </button>
      <button
        type="button"
        onClick={onTell}
        disabled={deleting}
        style={{
          ...btn,
          color: "var(--text-body)",
          background: "transparent",
          border: "var(--border-width) solid var(--border-strong)",
        }}
      >
        {hub.album.bulkTell}
      </button>
      <button
        type="button"
        onClick={onDeleteTap}
        disabled={deleting}
        aria-pressed={confirmingDelete}
        style={{
          ...btn,
          color: "var(--accent-strong, #BD5B3D)",
          background: confirmingDelete ? "var(--accent-soft)" : "transparent",
          border: "var(--border-width) solid var(--accent)",
        }}
      >
        {deleting
          ? hub.album.bulkDeleting
          : confirmingDelete
            ? hub.album.bulkDeleteConfirm
            : hub.album.bulkDelete}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={deleting}
        style={{
          ...btn,
          color: "var(--text-meta)",
          background: "transparent",
          border: "none",
        }}
      >
        {hub.album.bulkClear}
      </button>
    </div>
  );
}
