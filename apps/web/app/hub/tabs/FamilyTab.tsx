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
import { useEffect, useState } from "react";
import type { KinListEntry, KinshipTreeData } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { TreeCanvas } from "../tree/tree-canvas";
import { KinList } from "./KinList";

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
          marginBottom: 20,
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

      {view === "tree" ? (
        <TreeCanvas
          familyId={familyId}
          focusPersonId={focusPersonId}
          viewerPersonId={viewerPersonId}
          initial={tree}
        />
      ) : (
        <KinList kin={kin} />
      )}
    </div>
  );
}
