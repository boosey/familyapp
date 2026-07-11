"use client";

/**
 * "Manage connections ▾" dropdown (ADR-0009 · album). A right-aligned trigger that holds the
 * Disconnect action(s) for the album's connected import sources. Today Google Photos is the only
 * source, but the menu takes a `connections` array so future sources can add their own Disconnect
 * row without reworking the shell — each row supplies its own header (account email / source name),
 * disconnect handler, pending flag, and copy.
 *
 * Mechanics are borrowed from OwnerActionMenu: click-outside via pointerdown, Escape-to-close,
 * role="menu" / aria-haspopup="menu" / aria-expanded, and the CSS-custom-prop styling idiom. There
 * is NO confirm step — single-tap Disconnect (unlike OwnerActionMenu's two-step delete). While a row
 * is disconnecting it shows a brief pending label, is disabled, and the caller's handler refreshes.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface ManageConnection {
  /** Stable key (e.g. the source id). */
  id: string;
  /** Menu-section header for this connection — the account email, or a generic source name. */
  header: string;
  /** Disconnect item label (e.g. "Disconnect Google Photos"). */
  disconnectLabel: string;
  /** Brief pending label shown on the item while `pending` (e.g. "Disconnecting…"). */
  pendingLabel: string;
  /** Single-tap disconnect handler (no confirm). Caller owns the transition + router.refresh(). */
  onDisconnect: () => void;
  /** When true, the row is disabled and shows `pendingLabel`. */
  pending: boolean;
}

export interface ManageConnectionsMenuProps {
  /** Trigger label + aria-label (e.g. "Manage connections"). */
  label: string;
  /** One entry per connected source. Disconnect-only. */
  connections: ManageConnection[];
}

export function ManageConnectionsMenu({ label, connections }: ManageConnectionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside (pointerdown, mirrors OwnerActionMenu).
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const triggerStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1.5px solid var(--border)",
    borderRadius: "var(--radius-md)",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 500,
    padding: "8px 12px",
    outline: "none",
    transition: "background var(--dur-fade) var(--ease-quiet), color var(--dur-fade) var(--ease-quiet)",
  };

  const dropdownStyle: CSSProperties = {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: 4,
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

  const headerStyle: CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    color: "var(--text-meta)",
    padding: "6px 12px 2px",
    wordBreak: "break-word",
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
    color: "var(--accent-strong, #BD5B3D)",
    textDecoration: "none",
    background: "transparent",
    border: "none",
    textAlign: "left",
    transition: "background var(--dur-fade) var(--ease-quiet)",
    outline: "none",
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block", marginLeft: "auto" }}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
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
        {label} <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div style={dropdownStyle} role="menu" aria-label={label}>
          {connections.map((c) => (
            <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={headerStyle}>{c.header}</div>
              <button
                type="button"
                role="menuitem"
                disabled={c.pending}
                // Reflect the pending label in the accessible name too (not just the visible text),
                // so assistive tech announces the "Disconnecting…" transition rather than a stale label.
                aria-label={c.pending ? c.pendingLabel : c.disconnectLabel}
                onClick={() => c.onDisconnect()}
                style={{
                  ...itemBaseStyle,
                  cursor: c.pending ? "not-allowed" : "pointer",
                  opacity: c.pending ? 0.7 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!c.pending) e.currentTarget.style.background = "var(--accent-soft)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                🔌 {c.pending ? c.pendingLabel : c.disconnectLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
