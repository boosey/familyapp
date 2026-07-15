"use client";
/**
 * KebabMenu — a shared "⋮" add-relative menu (pedigree-nav redesign, spec §"kebab-menu.tsx").
 *
 * Per-card only (spec §2): a ⋮ on a PersonNode, targeting that card's person. The old global toolbar
 * instance is removed. The trigger is BORDERLESS (the carets/"+" carry the 1px border; the kebab does
 * not).
 *
 * The FIRST item is **Focus** (tree Slice A #2) — it re-roots the tree on this card (via
 * TreeFocusProvider's `onFocus`), recomputing relation chips + the focus ring without moving the
 * camera. It is OMITTED on the card that is already the focus person. (Slice B will insert Stories
 * contributed / Photos contributed / Mentions above Focus.)
 *
 * The remaining items open the tree's shared Add-a-relative MODAL (via TreeAddProvider), anchored on
 * `node.personId` with the chosen relation. They write nothing themselves — the modal's form does.
 * Items are GATED by the loaded adjacency counts so we never offer an impossible add (a person already
 * has ≤2 parents; at most one partner in v1):
 *   - Add child / Add sibling — always
 *   - Add parent — only when `parentCount < 2`
 *   - Add partner — only when `partnerCount === 0`
 */
import { useEffect, useId, useRef, useState } from "react";
import { hub } from "@/app/_copy";
import type { AddRelativeRelation, TreeNode } from "@chronicle/core";
import { useTreeAdd } from "./add-relative-context";
import { useTreeFocus } from "./focus-context";

export interface KebabMenuProps {
  node: TreeNode;
  /** Loaded `parent_of` edges where this node is the CHILD. Gates "Add parent" (< 2). */
  parentCount: number;
  /** Loaded `partnered_with` edges touching this node. Gates "Add partner" (=== 0). */
  partnerCount: number;
  /** True when this card is already the focus person — the Focus item is then omitted. */
  isFocus?: boolean;
}

interface Item {
  relation: Extract<AddRelativeRelation, "child" | "sibling" | "parent" | "partner">;
  label: string;
  testId: string;
}

export function KebabMenu({ node, parentCount, partnerCount, isFocus }: KebabMenuProps) {
  const openAdd = useTreeAdd();
  const focusPerson = useTreeFocus();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  // Close on outside click / Escape (nice-to-have per spec).
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: Item[] = [
    { relation: "child", label: hub.tree.kebabAddChild, testId: "tree-kebab-addchild" },
    { relation: "sibling", label: hub.tree.kebabAddSibling, testId: "tree-kebab-addsibling" },
  ];
  if (parentCount < 2) {
    items.push({ relation: "parent", label: hub.tree.kebabAddParent, testId: "tree-kebab-addparent" });
  }
  if (partnerCount === 0) {
    items.push({ relation: "partner", label: hub.tree.kebabAddPartner, testId: "tree-kebab-addpartner" });
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        data-testid="tree-kebab-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={hub.tree.moreActions}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: "1.1rem",
          lineHeight: 1,
          padding: 0,
        }}
      >
        <span aria-hidden="true">{"⋮"}</span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          data-testid="tree-kebab-menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 160,
            background: "var(--surface-card)",
            border: "var(--border-width) solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lift, 0 8px 28px rgba(0,0,0,0.16))",
            padding: 6,
            zIndex: 3,
            display: "grid",
            gap: 2,
          }}
        >
          {/* Focus (re-root) — first item; omitted on the card that is already the focus person. */}
          {!isFocus && (
            <button
              type="button"
              role="menuitem"
              data-testid="tree-kebab-focus"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                focusPerson(node.personId);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={MENU_ITEM_STYLE}
            >
              {hub.tree.kebabFocus}
            </button>
          )}
          {items.map((it) => (
            <button
              key={it.relation}
              type="button"
              role="menuitem"
              data-testid={it.testId}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                openAdd(node.personId, it.relation);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={MENU_ITEM_STYLE}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MENU_ITEM_STYLE: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-body)",
};
