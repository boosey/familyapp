"use client";
/**
 * KebabMenu — a shared "⋮" add-relative menu (pedigree-nav redesign, spec §"kebab-menu.tsx").
 *
 * Per-card only (spec §2): a ⋮ on a PersonNode, targeting that card's person. The old global toolbar
 * instance is removed. The trigger is BORDERLESS (the carets/"+" carry the 1px border; the kebab does
 * not).
 *
 * Every item is a plain navigation link to the /hub/kin add-relative flow, anchored on `node.personId`
 * with a `relation=<r>` query param. It writes nothing itself — the target flow does. Items are GATED
 * by the loaded adjacency counts so we never offer an impossible add (a person already has ≤2 parents;
 * at most one partner in v1):
 *   - Add child / Add sibling — always
 *   - Add parent — only when `parentCount < 2`
 *   - Add partner — only when `partnerCount === 0`
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { hub } from "@/app/_copy";
import type { TreeNode } from "@chronicle/core";

export interface KebabMenuProps {
  node: TreeNode;
  familyId: string;
  /** Loaded `parent_of` edges where this node is the CHILD. Gates "Add parent" (< 2). */
  parentCount: number;
  /** Loaded `partnered_with` edges touching this node. Gates "Add partner" (=== 0). */
  partnerCount: number;
}

interface Item {
  relation: "child" | "sibling" | "parent" | "partner";
  label: string;
  testId: string;
}

export function KebabMenu({ node, familyId, parentCount, partnerCount }: KebabMenuProps) {
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

  const href = (relation: string) =>
    `/hub/kin?scope=${familyId}&anchor=${node.personId}&relation=${relation}`;

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
          {items.map((it) => (
            <Link
              key={it.relation}
              href={href(it.relation)}
              role="menuitem"
              data-testid={it.testId}
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "block",
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                color: "var(--text-body)",
                textDecoration: "none",
              }}
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
