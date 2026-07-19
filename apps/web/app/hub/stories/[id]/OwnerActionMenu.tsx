"use client";

import { useState, useEffect, useRef } from "react";
import { deleteStoryAction } from "./actions";
import { hub } from "@/app/_copy";
import styles from "./OwnerActionMenu.module.css";

export interface OwnerActionMenuProps {
  storyId: string;
  isOwner: boolean;
  onEditStory: () => void;
  onAddPhotos: () => void;
  onManageSharing: () => void;
  // When true, the kebab trigger is disabled and closed. Used to keep the two owner-only
  // family-target mutators (StoryEditor and the Manage-Sharing overlay) mutually exclusive —
  // both post the FULL target-family set from independent local snapshots, so having both open
  // at once lets a later submit silently clobber/revoke families added by the other. See
  // apps/web/__tests__/story-detail-owner-exclusive.test.tsx.
  disabled?: boolean;
}

export function OwnerActionMenu({
  storyId,
  isOwner,
  onEditStory,
  onAddPhotos,
  onManageSharing,
  disabled = false,
}: OwnerActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // If disabled while open (e.g. another owner surface just opened), force-close.
  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
      setConfirmDelete(false);
      setError(null);
    }
  }, [disabled, open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
        setError(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirmDelete(false);
        setError(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!isOwner) return null;

  const handleDeleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.append("storyId", storyId);
    try {
      const result = await deleteStoryAction(formData);
      if (result && result.error) {
        setError(result.error);
        setPending(false);
      }
    } catch (err) {
      if (err instanceof Error && (err.message.includes("NEXT_REDIRECT") || err.message.includes("digest: 'NEXT_REDIRECT'"))) {
        throw err;
      }
      setError("An unexpected error occurred.");
      setPending(false);
    }
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <button
        type="button"
        aria-label={hub.storyDetail.optionsLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
          setConfirmDelete(false);
          setError(null);
        }}
        className={styles.trigger}
      >
        ⋮
      </button>

      {open && !disabled && (
        <div className={styles.dropdown} role="menu" aria-label={hub.storyDetail.optionsMenuLabel}>
          {!confirmDelete ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onEditStory();
                }}
                className={styles.item}
              >
                📝 Edit story
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onAddPhotos();
                }}
                className={styles.item}
              >
                🖼️ Add photos
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onManageSharing();
                }}
                className={styles.item}
              >
                👥 Manage sharing
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirmDelete(true)}
                className={styles.itemDanger}
              >
                🗑️ Delete story
              </button>
            </>
          ) : (
            <form onSubmit={handleDeleteSubmit} className={styles.confirmForm}>
              <div className={styles.confirmPrompt}>
                Are you sure you want to permanently delete this story? This cannot be undone.
              </div>
              {error && <div className={styles.confirmError}>{error}</div>}
              <div className={styles.confirmActions}>
                <button type="submit" disabled={pending} className={styles.btnConfirm}>
                  {pending ? "Deleting..." : "Confirm"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmDelete(false);
                    setError(null);
                  }}
                  className={styles.btnCancel}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
