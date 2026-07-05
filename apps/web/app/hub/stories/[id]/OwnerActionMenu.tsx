"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { deleteStoryAction } from "./actions";

export interface OwnerActionMenuProps {
  storyId: string;
  isOwner: boolean;
  onEditDetails: () => void;
  onManageSharing: () => void;
  onEditStory: () => void;
}

export function OwnerActionMenu({
  storyId,
  isOwner,
  onEditDetails,
  onManageSharing,
  onEditStory,
}: OwnerActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const triggerStyle: CSSProperties = {
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: "24px",
    padding: "8px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    width: "44px",
    height: "44px",
    outline: "none",
    transition: "background var(--dur-fade) var(--ease-quiet), color var(--dur-fade) var(--ease-quiet)",
  };

  const dropdownStyle: CSSProperties = {
    position: "absolute",
    top: "100%",
    right: 0,
    width: 240,
    background: "var(--surface-card)",
    border: "1.5px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-lift)",
    padding: 8,
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };

  const itemBaseStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 500,
    color: "var(--text-body)",
    textDecoration: "none",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    transition: "background var(--dur-fade) var(--ease-quiet)",
    outline: "none",
  };

  const dangerItemStyle: CSSProperties = {
    ...itemBaseStyle,
    color: "var(--accent-strong, #BD5B3D)",
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-label="Story options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
          setConfirmDelete(false);
          setError(null);
        }}
        style={triggerStyle}
        onFocus={(e) => {
          e.currentTarget.style.background = "var(--accent-soft)";
          e.currentTarget.style.color = "var(--accent-strong)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--accent-soft)";
          e.currentTarget.style.color = "var(--accent-strong)";
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-muted)";
          }
        }}
      >
        ⋮
      </button>

      {open && (
        <div style={dropdownStyle} role="menu" aria-label="Story options menu">
          {!confirmDelete ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onEditDetails();
                }}
                style={itemBaseStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent-soft)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                ✏️ Edit details
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onManageSharing();
                }}
                style={itemBaseStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent-soft)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                👥 Manage sharing
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onEditStory();
                }}
                style={itemBaseStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent-soft)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                📝 Edit story
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirmDelete(true)}
                style={dangerItemStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent-soft)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                🗑️ Delete story
              </button>
            </>
          ) : (
            <form onSubmit={handleDeleteSubmit} style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: "0.875rem", color: "var(--text-body)", fontWeight: 600 }}>
                Are you sure you want to permanently delete this story? This cannot be undone.
              </div>
              {error && (
                <div style={{ fontFamily: "var(--font-ui)", fontSize: "0.8rem", color: "var(--accent-strong)", fontWeight: 500 }}>
                  {error}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  type="submit"
                  disabled={pending}
                  style={{
                    flex: 1,
                    background: "var(--accent-strong, #BD5B3D)",
                    color: "white",
                    border: "none",
                    borderRadius: "var(--radius-sm, 4px)",
                    padding: "6px 8px",
                    fontFamily: "var(--font-ui)",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: pending ? "not-allowed" : "pointer",
                    opacity: pending ? 0.7 : 1,
                  }}
                >
                  {pending ? "Deleting..." : "Confirm"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmDelete(false);
                    setError(null);
                  }}
                  style={{
                    flex: 1,
                    background: "var(--surface-sunken)",
                    color: "var(--text-body)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm, 4px)",
                    padding: "6px 8px",
                    fontFamily: "var(--font-ui)",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: pending ? "not-allowed" : "pointer",
                  }}
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
