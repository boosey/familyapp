"use client";

/**
 * AlbumDestinationModal (#94) — the files-first destination picker. Choosing files (device upload) or
 * completing the Google picker STASHES the pending payload and opens THIS modal; only here does the
 * contributor pick which family album(s) receive the batch — the target designator moved OFF the
 * standing album toolbar (the retired "Which albums?" fieldset) and INTO the add/import action itself.
 *
 * This modal is the SOLE home of the no-silent-fan-out rule: **Add is disabled until ≥1 family is
 * chosen**, so a multi-family viewer on an `all`/ambiguous filter can never complete an add without a
 * deliberate pick. **Cancel** discards the pending selection with zero storage writes — the actual
 * upload/import fires only on Add.
 *
 * It renders only when the viewer has >1 family (the caller gates the mount): a solo-family viewer has
 * nothing to choose, so no modal appears and the add/import proceeds straight through (the server
 * auto-selects the sole family).
 *
 * Accessibility mirrors AlbumPhotoViewer's dialog idiom: `role="dialog"` + `aria-modal` + a labelled
 * title, Escape = Cancel, a backdrop click = Cancel, Tab/Shift+Tab trapped inside, focus moved into the
 * dialog on open, and focus RESTORED to the Add Photos trigger on close (the caller passes the trigger
 * to restore to — restoring to `document.activeElement` here would land on a menuitem that has since
 * unmounted).
 */
import { useEffect, useRef } from "react";
import { FamilyChoiceChips } from "../FamilyChoiceChips";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import type { AlbumFamilyOption } from "./AlbumUploader";

export function AlbumDestinationModal({
  families,
  selected,
  onToggle,
  title,
  onAdd,
  onCancel,
  restoreFocusRef,
}: {
  families: AlbumFamilyOption[];
  /** The chosen destination family ids (caller-owned, seeded from the designator seed). */
  selected: Set<string>;
  onToggle: (familyId: string) => void;
  /** The count-aware (device) or count-agnostic (Google) title text. */
  title: string;
  /** Fires the pending upload/import against the chosen destination. */
  onAdd: () => void;
  /** Discards the pending payload — nothing has been stored yet. */
  onCancel: () => void;
  /** The Add Photos trigger to restore focus to when the modal closes. */
  restoreFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = "album-destination-title";

  // Move focus into the dialog on open; restore it to the Add Photos trigger on close (unmount). The
  // trigger is passed in rather than read from document.activeElement because the control that opened
  // this modal (a menuitem) has already unmounted with its dropdown.
  useEffect(() => {
    dialogRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [restoreFocusRef]);

  // Focusable descendants of the dialog in DOM order — re-queried per keydown (Add's disabled state
  // changes with the selection), mirroring AlbumPhotoViewer.
  function getFocusable(): HTMLElement[] {
    const root = dialogRef.current;
    if (!root) return [];
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  }

  // Escape = Cancel; Tab/Shift+Tab trapped inside so a keyboard user can't reach the toolbar behind it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const activeIndex = active ? focusable.indexOf(active) : -1;
      if (e.shiftKey) {
        if (activeIndex <= 0) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeIndex === -1 || activeIndex === focusable.length - 1) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const addDisabled = selected.size === 0;

  return (
    <div
      data-testid="album-destination-backdrop"
      // Backdrop click cancels, but only when the backdrop ITSELF is the target (not a click bubbling
      // up from the dialog card) — the robust alternative to stopPropagation used across the album.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(12px, 4vw, 32px)",
        background: "rgba(46, 38, 32, 0.55)",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          background: "var(--surface-card)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lift)",
          maxWidth: 420,
          width: "100%",
          maxHeight: "90dvh",
          overflowY: "auto",
          padding: "clamp(16px, 4vw, 24px)",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          outline: "none",
        }}
      >
        <h2
          id={titleId}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            fontWeight: 600,
            color: "var(--text-body)",
            margin: 0,
          }}
        >
          {title}
        </h2>

        <FamilyChoiceChips
          families={families.map((f) => ({
            id: f.familyId,
            name: f.familyName,
            shortName: f.familyShortName,
          }))}
          selected={selected}
          onToggle={onToggle}
          ariaLabel={hub.shell.familyDesignatorAria}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <KindredButton variant="ghost" size="small" onClick={onCancel}>
            {hub.album.destinationCancel}
          </KindredButton>
          <KindredButton
            variant="primary"
            size="small"
            disabled={addDisabled}
            onClick={() => {
              if (addDisabled) return;
              onAdd();
            }}
          >
            {hub.album.destinationAdd}
          </KindredButton>
        </div>
      </div>
    </div>
  );
}
