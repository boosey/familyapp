"use client";
/**
 * FamilyTab — the hub's "Family" tab (2026-07-14). The visual family tree used to be a standalone
 * `/hub/tree` route (which hid the hub tab bar) and the relatives list a separate `/hub/kin` route;
 * both are folded in here behind a Tree | List view selector so the tab chrome never disappears.
 *
 *   - Tree view → the interactive <TreeCanvas> (pan/zoom, per-card add via modal).
 *   - List  view → the searchable read-only <KinList> of the viewer's relatives.
 *
 * The chosen view persists to localStorage (SSR-safe: default "tree", hydrated in an effect).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { KinListEntry, KinshipTreeData } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { TreeCanvas, type TreeCanvasHandle } from "../tree/tree-canvas";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../tree/tree-constants";
import { KinList } from "./KinList";

const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

type FamilyView = "tree" | "list";

const VIEW_KEY = "hub:familyView";

function isView(v: string | null): v is FamilyView {
  return v === "tree" || v === "list";
}

export interface FamilyTabProps {
  familyId: string;
  focusPersonId: string;
  viewerPersonId: string;
  tree: KinshipTreeData;
  kin: KinListEntry[];
  /** When the tab was opened with `?view=list` (e.g. a deep link), start on the List view. */
  initialView?: FamilyView;
}

export function FamilyTab({
  familyId,
  focusPersonId,
  viewerPersonId,
  tree,
  kin,
  initialView = "tree",
}: FamilyTabProps) {
  const [view, setView] = useState<FamilyView>(initialView);
  const router = useRouter();

  // CAMERA state lifted out of TreeCanvas (§5) so the Fit/−/+ controls can live in the selector row.
  // TreeCanvas keeps `fit()`/`center()` (they need layout bounds + the viewport ref) behind an
  // imperative handle; Fit calls it. Zoom −/+ are simple clamped setScale calls owned here.
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const canvasRef = useRef<TreeCanvasHandle | null>(null);

  // Hydrate the persisted choice on mount (client only), unless a deep-link asked for a specific view.
  useEffect(() => {
    if (initialView !== "tree") return; // an explicit ?view= wins over the stored preference
    try {
      const stored = window.localStorage.getItem(VIEW_KEY);
      if (isView(stored)) setView(stored);
    } catch {
      /* localStorage unavailable — keep the default. */
    }
  }, [initialView]);

  function changeView(v: FamilyView) {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore persistence failure */
    }
  }

  return (
    <div>
      {/* Selector row: Tree | List on the LEFT; Fit / − / + on the RIGHT (tree view only, §5). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div
          role="radiogroup"
          aria-label={hub.tree.viewSelectorAria}
          style={{
            display: "inline-flex",
            padding: 3,
            gap: 2,
            borderRadius: "var(--radius-pill)",
            background: "var(--surface-sunken)",
            border: "var(--border-width) solid var(--border)",
          }}
        >
          {(["tree", "list"] as const).map((v) => {
            const selected = v === view;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => changeView(v)}
                style={{
                  minHeight: 40,
                  padding: "8px 20px",
                  border: "none",
                  borderRadius: "var(--radius-pill)",
                  background: selected ? "var(--surface-card)" : "transparent",
                  boxShadow: selected ? "var(--shadow-lift)" : "none",
                  color: selected ? "var(--text-heading)" : "var(--text-meta)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  fontWeight: selected ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {v === "tree" ? hub.tree.viewTree : hub.tree.viewList}
              </button>
            );
          })}
        </div>

        {view === "tree" && (
          <div
            data-testid="tree-controls"
            style={{ display: "inline-flex", alignItems: "center", gap: 12, marginLeft: "auto" }}
          >
            <button type="button" onClick={() => canvasRef.current?.fit()} data-testid="tree-fit" style={controlPill}>
              {hub.tree.fit}
            </button>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => setScale((s) => clampScale(s / ZOOM_STEP))}
                data-testid="tree-zoom-out"
                aria-label={hub.tree.zoomOut}
                disabled={scale <= ZOOM_MIN + 0.001}
                style={zoomBtn(scale <= ZOOM_MIN + 0.001)}
              >
                <span aria-hidden="true">−</span>
              </button>
              <button
                type="button"
                onClick={() => setScale((s) => clampScale(s * ZOOM_STEP))}
                data-testid="tree-zoom-in"
                aria-label={hub.tree.zoomIn}
                disabled={scale >= ZOOM_MAX - 0.001}
                style={zoomBtn(scale >= ZOOM_MAX - 0.001)}
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "0.75rem", color: "var(--text-meta)" }}>
              {hub.tree.pan}
            </span>
          </div>
        )}
      </div>

      {view === "tree" ? (
        <TreeCanvas
          ref={canvasRef}
          familyId={familyId}
          focusPersonId={focusPersonId}
          viewerPersonId={viewerPersonId}
          initial={tree}
          pan={pan}
          onPanChange={(updater) => setPan(updater)}
          scale={scale}
          onScaleChange={(updater) => setScale(updater)}
          // Slice D (#6): client-side nav for the invite deep-link so pan/zoom state isn't lost to a
          // full reload (the rest of /hub uses router.push). TreeCanvas keeps window.location.assign as
          // its DEFAULT so it stays mountable without a router in unit tests.
          navigate={(url) => router.push(url)}
        />
      ) : (
        <KinList kin={kin} />
      )}
    </div>
  );
}

const controlPill: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  fontWeight: 600,
  padding: "8px 16px",
  borderRadius: "var(--radius-pill)",
  border: "var(--border-width) solid var(--border-strong)",
  background: "transparent",
  color: "var(--text-body)",
  cursor: "pointer",
};

function zoomBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "var(--border-width) solid var(--border-strong)",
    background: "transparent",
    color: "var(--text-body)",
    fontSize: "1.2rem",
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    padding: 0,
  };
}
