"use client";

/**
 * "Add Photos ▾" dropdown (#93 · album). The album's SINGLE right-justified entry point: it
 * consolidates every add affordance that used to sit inline (device picker, Google connect/import)
 * plus — below a divider — the Manage-connections Disconnect rows. Each item renders under the SAME
 * conditions as the old inline cluster; the actions themselves are unchanged (this is pure
 * consolidation).
 *
 * Mechanics are borrowed from OwnerActionMenu: click-outside via pointerdown,
 * Escape-to-close, role="menu" / aria-haspopup="menu" / aria-expanded, and the CSS-custom-prop styling
 * idiom. The trigger is pinned right (marginLeft:auto). The caller owns every handler + disabled flag;
 * this shell only decides what renders and drives the open/close state.
 *
 * The caller MUST gate the mount itself: render this only when there is ≥1 add action available
 * (`showFileUpload || googlePhotosConfigured`). A menu with only a Disconnect row (connected but
 * neither device upload nor Google configured) is not an "add" surface — but connected implies
 * configured, so that case cannot arise.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface AddPhotosMenuProps {
  /** Trigger label + aria-label (e.g. "Add Photos"). */
  label: string;
  /** Ref to the trigger button, so a caller (the #94 destination modal) can restore focus to it when
   *  the modal it opened via a menuitem closes — the menuitem itself has unmounted by then. */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  /** "Add from your device" item — opens the OS file picker. Omit to hide (no device upload). */
  device?: {
    label: string;
    disabled: boolean;
    onSelect: () => void;
  };
  /** Google Photos add action. `connect` links to the OAuth start (real navigation); `import` runs
   *  the picker flow. Exactly one is present when Google is configured (connect → not-connected,
   *  import → connected); omit the whole object when Google is not configured. */
  google?:
    | { kind: "connect"; label: string; href: string }
    | { kind: "import"; label: string; disabled: boolean; onSelect: () => void };
  /** Manage-connections section, shown below a divider (connected sources' Disconnect rows). Omit
   *  when nothing is connected. Its `header` is the account email / source name. */
  manage?: {
    header: string;
    disconnectLabel: string;
    pendingLabel: string;
    onDisconnect: () => void;
    pending: boolean;
  };
}

export function AddPhotosMenu({ label, triggerRef, device, google, manage }: AddPhotosMenuProps) {
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
    background: "var(--accent)",
    border: "1.5px solid var(--accent)",
    borderRadius: "var(--radius-md)",
    color: "var(--on-accent, #fff)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    padding: "8px 14px",
    outline: "none",
    transition: "filter var(--dur-fade) var(--ease-quiet)",
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
    color: "var(--text-body, #2A2521)",
    textDecoration: "none",
    background: "transparent",
    border: "none",
    textAlign: "left",
    transition: "background var(--dur-fade) var(--ease-quiet)",
    outline: "none",
    cursor: "pointer",
  };

  const dividerStyle: CSSProperties = {
    height: 1,
    background: "var(--border)",
    border: "none",
    margin: "4px 0",
  };

  // Item hover shading — enter tints, leave clears (unless disabled). Shared by every menuitem.
  const hoverOn = (e: React.MouseEvent<HTMLElement>, disabled = false) => {
    if (!disabled) e.currentTarget.style.background = "var(--accent-soft)";
  };
  const hoverOff = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "transparent";
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", display: "inline-block", marginLeft: "auto" }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        style={triggerStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.filter = "brightness(0.95)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.filter = "none";
        }}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div style={dropdownStyle} role="menu" aria-label={label}>
          {device ? (
            <button
              type="button"
              role="menuitem"
              disabled={device.disabled}
              onClick={() => {
                if (device.disabled) return;
                setOpen(false);
                device.onSelect();
              }}
              style={{
                ...itemBaseStyle,
                cursor: device.disabled ? "not-allowed" : "pointer",
                opacity: device.disabled ? 0.6 : 1,
              }}
              onMouseEnter={(e) => hoverOn(e, device.disabled)}
              onMouseLeave={hoverOff}
            >
              <span aria-hidden="true">📷</span> {device.label}
            </button>
          ) : null}

          {google?.kind === "connect" ? (
            <a
              href={google.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              style={itemBaseStyle}
              onMouseEnter={(e) => hoverOn(e)}
              onMouseLeave={hoverOff}
            >
              <span aria-hidden="true">🔗</span> {google.label}
            </a>
          ) : null}

          {google?.kind === "import" ? (
            <button
              type="button"
              role="menuitem"
              disabled={google.disabled}
              onClick={() => {
                if (google.disabled) return;
                setOpen(false);
                google.onSelect();
              }}
              style={{
                ...itemBaseStyle,
                cursor: google.disabled ? "not-allowed" : "pointer",
                opacity: google.disabled ? 0.6 : 1,
              }}
              onMouseEnter={(e) => hoverOn(e, google.disabled)}
              onMouseLeave={hoverOff}
            >
              <span aria-hidden="true">🖼️</span> {google.label}
            </button>
          ) : null}

          {manage ? (
            <>
              <hr style={dividerStyle} aria-hidden="true" />
              <div style={headerStyle}>{manage.header}</div>
              <button
                type="button"
                role="menuitem"
                disabled={manage.pending}
                // Reflect the pending label in the accessible name too (not just the visible text),
                // so assistive tech announces the "Disconnecting…" transition rather than a stale label.
                aria-label={manage.pending ? manage.pendingLabel : manage.disconnectLabel}
                onClick={() => manage.onDisconnect()}
                style={{
                  ...itemBaseStyle,
                  color: "var(--accent-strong, #0F766E)",
                  cursor: manage.pending ? "not-allowed" : "pointer",
                  opacity: manage.pending ? 0.7 : 1,
                }}
                onMouseEnter={(e) => hoverOn(e, manage.pending)}
                onMouseLeave={hoverOff}
              >
                <span aria-hidden="true">🔌</span>{" "}
                {manage.pending ? manage.pendingLabel : manage.disconnectLabel}
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
