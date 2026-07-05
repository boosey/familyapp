"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { hub } from "@/app/_copy";

interface ScopeFamily {
  familyId: string;
  familyName: string;
}

interface PendingRequest {
  familyName: string;
  stewardName: string;
}

export interface HubScopeSelectorProps {
  /** The active scope: "all" or a familyId. Already validated server-side against `families`. */
  scope: string;
  /** The active tab — preserved when a scope row navigates. */
  tab: string;
  /** The viewer's own active families (the only selectable scopes besides "All"). */
  families: ScopeFamily[];
  /** Muted, non-clickable pending-join-request rows. */
  pending: PendingRequest[];
}

/**
 * Hub scope selector — the `[ All ▾ ]` pill in the hub header. Lists All + each active family as a
 * navigable scope (threading `?scope=` through the current tab), shows muted pending-join rows, and
 * pins `+ Create a family` / `🔍 Find a family to join` at the bottom. The `scope` value is authored
 * server-side (validated against the viewer's OWN families) — this component only navigates.
 *
 * Visual approach mirrors the crest `<span>` and the Album switcher pill (KindredAccountMenu's
 * outside-click / Escape pattern is reused).
 */
export function HubScopeSelector({ scope, tab, families, pending }: HubScopeSelectorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click (mirror KindredAccountMenu).
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

  const currentLabel =
    scope === "all"
      ? hub.shell.scopeAll
      : (families.find((f) => f.familyId === scope)?.familyName ??
        (families.length === 0 ? hub.shell.scopeNoFamily : hub.shell.scopeAll));

  function go(s: string) {
    setOpen(false);
    router.push(`/hub?tab=${encodeURIComponent(tab)}&scope=${encodeURIComponent(s)}`);
  }

  const triggerStyle: CSSProperties = {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    padding: "0 14px",
    borderRadius: "var(--radius-md)",
    border: "var(--border-width) solid var(--border-strong)",
    background: "var(--surface-sunken)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-label)",
    color: "var(--text-muted)",
    cursor: "pointer",
    outline: "none",
  };

  const dropdownStyle: CSSProperties = {
    position: "absolute",
    top: 52,
    left: 0,
    minWidth: 240,
    background: "var(--surface-card)",
    border: "1.5px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-lift)",
    padding: 8,
    zIndex: 20,
  };

  const rowBaseStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
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
  };

  const dividerStyle: CSSProperties = {
    height: 1,
    background: "var(--border)",
    margin: "4px 0",
    border: "none",
  };

  const pendingRowStyle: CSSProperties = {
    ...rowBaseStyle,
    cursor: "default",
    color: "var(--text-muted)",
    fontWeight: 400,
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-label)",
  };

  function scopeRow(key: string, label: string, isActive: boolean) {
    return (
      <button
        key={key}
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        aria-pressed={isActive}
        style={{
          ...rowBaseStyle,
          background: isActive ? "var(--accent-soft)" : "transparent",
          color: isActive ? "var(--accent)" : "var(--text-body)",
          fontWeight: isActive ? 600 : 500,
        }}
        onClick={() => go(key === "all" ? "all" : key)}
        onMouseEnter={(e) => {
          if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-sunken)";
        }}
        onMouseLeave={(e) => {
          if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        <span>{label}</span>
        {isActive && <span aria-hidden="true">✓</span>}
      </button>
    );
  }

  const actionRowStyle: CSSProperties = { ...rowBaseStyle, justifyContent: "flex-start" };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={hub.shell.scopeAria}
        onClick={() => setOpen((v) => !v)}
        style={triggerStyle}
      >
        <span>{currentLabel}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div style={dropdownStyle} role="menu" aria-label={hub.shell.scopeAria}>
          {scopeRow("all", hub.shell.scopeAll, scope === "all")}
          {families.map((f) => scopeRow(f.familyId, f.familyName, scope === f.familyId))}

          {pending.length > 0 && (
            <>
              <hr style={dividerStyle} />
              {pending.map((p) => (
                <div key={p.familyName} style={pendingRowStyle} aria-disabled="true">
                  <span>{hub.shell.scopePending(p.familyName)}</span>
                </div>
              ))}
            </>
          )}

          <hr style={dividerStyle} />
          <a
            href="/families/new"
            role="menuitem"
            style={actionRowStyle}
            onClick={() => setOpen(false)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-sunken)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
            }}
          >
            {hub.shell.scopeCreateFamily}
          </a>
          <a
            href="/families/find"
            role="menuitem"
            style={actionRowStyle}
            onClick={() => setOpen(false)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-sunken)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
            }}
          >
            {hub.shell.scopeFindFamily}
          </a>
        </div>
      )}
    </div>
  );
}
