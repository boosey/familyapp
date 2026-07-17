"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useRef, type CSSProperties } from "react";
import { common } from "@/app/_copy";

/**
 * Dynamic import creates a code-split boundary: @clerk/nextjs lands in its own chunk
 * that the browser only fetches when <ClerkSignOutItemDynamic> actually renders — i.e.
 * when `clerkSignOut` is true. In mock/dev mode the component never mounts, so the
 * Clerk chunk is never requested even though this dynamic() call sits at module level.
 */
const ClerkSignOutItemDynamic = dynamic(
  () => import("./ClerkSignOutItem").then((m) => ({ default: m.ClerkSignOutItem })),
  { ssr: false },
);

export interface AccountMenuItem {
  key: string;
  icon?: React.ReactNode;
  label: string;
  href?: string;
  onSelect?: () => void;
}

export interface KindredAccountMenuProps {
  initials: string;
  displayName?: string;
  email?: string;
  items: AccountMenuItem[];
  /**
   * When true, the menu replaces the `key: "log-out"` item's click handler with a
   * dynamically-imported ClerkSignOutItem that calls useClerk().signOut(). The flag
   * must only be set when ClerkProvider is mounted (i.e. isClerkConfigured() is true)
   * — in mock mode ClerkProvider is absent and useClerk() would throw.
   */
  clerkSignOut?: boolean;
}

export function KindredAccountMenu({
  initials,
  displayName,
  email,
  items,
  clerkSignOut = false,
}: KindredAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const avatarStyle: CSSProperties = {
    width: 48,
    height: 48,
    borderRadius: "var(--radius-md)",
    background: "var(--accent)",
    color: "var(--accent-on)",
    fontFamily: "var(--font-story)",
    fontSize: "1.15rem",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "var(--border-width) solid var(--accent-strong)",
    boxShadow: "none",
    cursor: "pointer",
    flexShrink: 0,
    outline: "none",
    transition: "box-shadow var(--dur-fade) var(--ease-quiet)",
  };

  const dropdownStyle: CSSProperties = {
    position: "absolute",
    top: 58,
    right: 0,
    width: 260,
    background: "var(--surface-card)",
    border: "var(--border-width) solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    boxShadow: "none",
    padding: 8,
    zIndex: 20,
  };

  const headerStyle: CSSProperties = {
    padding: "10px 12px 8px",
    borderBottom: "1px solid var(--border)",
    marginBottom: 4,
  };

  const displayNameStyle: CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontWeight: 600,
    fontSize: "var(--text-ui-sm)",
    color: "var(--text-body)",
    lineHeight: "var(--leading-snug)",
  };

  const emailStyle: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-label)",
    color: "var(--text-muted)",
    letterSpacing: "var(--tracking-mono)",
    marginTop: 2,
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
  };

  function handleItemClick(item: AccountMenuItem) {
    setOpen(false);
    item.onSelect?.();
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-label={common.account.yourAccount}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={avatarStyle}
        onFocus={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 0 4px var(--accent-soft)";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
        }}
      >
        {initials.slice(0, 2).toUpperCase()}
      </button>

      {open && (
        <div style={dropdownStyle} role="menu" aria-label={common.account.accountMenu}>
          {(displayName || email) && (
            <div style={headerStyle}>
              {displayName && <div style={displayNameStyle}>{displayName}</div>}
              {email && <div style={emailStyle}>{email}</div>}
            </div>
          )}

          {items.map((item) => {
            // In Clerk mode, the log-out row is handled by the dynamically-imported
            // ClerkSignOutItemDynamic so useClerk() is only called when ClerkProvider
            // is mounted. The item's onSelect (the mock server action) is not invoked.
            if (clerkSignOut && item.key === "log-out") {
              return (
                <ClerkSignOutItemDynamic
                  key={item.key}
                  label={item.label}
                  style={itemBaseStyle}
                  onClose={() => setOpen(false)}
                />
              );
            }

            const content = (
              <>
                {item.icon && (
                  <span aria-hidden="true" style={{ fontSize: "1rem", lineHeight: 1, width: 18, textAlign: "center" }}>
                    {item.icon}
                  </span>
                )}
                {item.label}
              </>
            );

            if (item.href) {
              return (
                <a
                  key={item.key}
                  href={item.href}
                  role="menuitem"
                  style={itemBaseStyle}
                  onClick={() => setOpen(false)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-sunken)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                  }}
                >
                  {content}
                </a>
              );
            }

            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                style={itemBaseStyle}
                onClick={() => handleItemClick(item)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-sunken)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
