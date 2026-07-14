"use client";

/**
 * PhotoActionBar — the ONE per-photo action set (album enhancements, 2026-07-13). It is rendered in
 * two places with two variants so the actions stay identical everywhere:
 *   - `compact`: an icon-only toolbar overlaid at the top of a grid thumbnail (item 2).
 *   - `full`: a labeled row of buttons below the caption field in the photo viewer (item 3).
 *
 * Actions:
 *   - Edit         → `onEdit` (viewer: focus the caption field; grid: open the viewer). Manage-only.
 *   - Ask          → deep-links to the ask surface with this photo pre-selected as a subject.
 *   - Tell a story → deep-links to the tell surface with this photo as the story's subject.
 *   - Tag people   → `onTagPeople` when provided; a visible no-op placeholder until Phase B wires it.
 *   - Tag faces    → ALWAYS a no-op placeholder (face-region tagging needs ML; deferred). Manage-only.
 *   - Delete       → two-tap confirm owned HERE; the confirmed tap calls `onDelete` (caller runs the
 *                    async server action + refresh + error). Manage-only.
 *
 * `canManage` (contributor/steward hint from the surface) only decides whether the manage-only
 * controls SHOW; the delete/caption seams re-check authorization server-side and are authoritative.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { hub } from "@/app/_copy";

export interface PhotoActionBarPhoto {
  id: string;
  caption: string | null;
  canManage: boolean;
}

export function PhotoActionBar({
  photo,
  variant,
  onEdit,
  onDelete,
  onTagPeople,
  busy = false,
}: {
  photo: PhotoActionBarPhoto;
  variant: "compact" | "full";
  /** Manage-only. Compact: open the viewer. Full: focus/begin caption editing. */
  onEdit: () => void;
  /** Called on the CONFIRMED (second) delete tap. Caller owns the async + refresh + error. */
  onDelete: () => void;
  /** Phase B wires real people tagging; omit for the Phase-A no-op placeholder. */
  onTagPeople?: () => void;
  /** Disables every action (a pending op elsewhere in the host). */
  busy?: boolean;
}) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  const compact = variant === "compact";

  // Disarm an abandoned delete confirm. CRITICAL for the compact hover toolbar: that toolbar is kept
  // MOUNTED and merely CSS-hidden on pointer/focus leave, so without an explicit reset the "Tap again
  // to remove" state would survive a hide/show cycle and a later single click would delete with no
  // fresh confirm. We reset when the pointer leaves the group, and when focus moves outside it.
  function disarmDelete() {
    setConfirmingDelete(false);
  }

  function goAsk() {
    router.push(`/hub?tab=ask&subjectPhotoIds=${encodeURIComponent(photo.id)}`);
  }
  function goTell() {
    router.push(
      `/hub/tell?subjectPhotoId=${encodeURIComponent(photo.id)}` +
        `&promptQuestion=${encodeURIComponent(hub.compose.photoStoryPrompt(photo.caption))}`,
    );
  }
  function onDeleteTap() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete();
  }

  // One button renderer for both variants: compact = icon-only square with the label as aria/title;
  // full = icon + visible label pill. `danger` tints the delete control via the accent-strong token.
  function Action({
    icon,
    label,
    onClick,
    disabled,
    danger,
    pressed,
    title,
  }: {
    icon: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
    pressed?: boolean;
    title?: string;
  }) {
    const color = danger ? "var(--accent-strong, #BD5B3D)" : "var(--text-body)";
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        aria-label={label}
        aria-pressed={pressed}
        title={title ?? label}
        style={
          compact
            ? {
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 40,
                padding: 0,
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                color: danger ? "var(--accent-strong, #BD5B3D)" : "var(--text-body)",
                fontSize: "1.35rem",
                lineHeight: 1,
                cursor: disabled || busy ? "not-allowed" : "pointer",
                opacity: disabled || busy ? 0.5 : 1,
              }
            : {
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                border: `var(--border-width) solid ${danger ? "var(--accent)" : "var(--border-strong)"}`,
                borderRadius: "var(--radius-pill)",
                background: pressed ? "var(--accent-soft)" : "transparent",
                color,
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                fontWeight: 500,
                cursor: disabled || busy ? "not-allowed" : "pointer",
                opacity: disabled || busy ? 0.55 : 1,
                whiteSpace: "nowrap",
              }
        }
      >
        <span aria-hidden="true">{icon}</span>
        {compact ? null : <span>{label}</span>}
      </button>
    );
  }

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={hub.album.photoActionsAria(photo.caption)}
      onMouseLeave={disarmDelete}
      onBlur={(e) => {
        // Disarm only when focus actually leaves the group (not on focus moves BETWEEN its buttons).
        if (!groupRef.current?.contains(e.relatedTarget as Node | null)) disarmDelete();
      }}
      style={
        compact
          ? {
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              padding: "4px 6px",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-card)",
              boxShadow: "var(--shadow-lift)",
            }
          : {
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }
      }
    >
      {photo.canManage ? (
        <Action icon="✎" label={hub.album.editPhoto} onClick={onEdit} />
      ) : null}

      <Action
        icon="💬"
        label={compact ? hub.album.askAboutPhoto : hub.album.askAboutPhotoShort}
        onClick={goAsk}
      />
      <Action
        icon="📖"
        label={compact ? hub.album.tellStoryOfPhoto : hub.album.tellStoryOfPhotoShort}
        onClick={goTell}
      />

      {photo.canManage ? (
        <>
          {/* Phase A: no `onTagPeople` ⇒ a present-but-disabled placeholder. Phase B passes a handler. */}
          <Action
            icon="👥"
            label={hub.album.tagPeople}
            onClick={() => onTagPeople?.()}
            disabled={onTagPeople === undefined}
          />
          {/* Faces is always a no-op placeholder until face-region ML lands. */}
          <Action
            icon="🙂"
            label={hub.album.tagFaces}
            title={hub.album.tagFacesComingSoon}
            onClick={() => {}}
            disabled
          />
          <Action
            icon="🗑"
            label={confirmingDelete ? hub.album.confirmDelete : hub.album.deletePhoto}
            onClick={onDeleteTap}
            danger
            pressed={confirmingDelete}
          />
        </>
      ) : null}
    </div>
  );
}
