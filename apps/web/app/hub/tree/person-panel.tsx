"use client";
/**
 * PersonPanel — the read-only tap detail for a tree node (spec §7).
 *
 * Shows name (or "Unknown <relation>"), relation-to-you, the life line, and identified/anonymous.
 * Three purely NAVIGATIONAL actions (no writes): Stories about them, Center tree here, Manage kin.
 * The panel never mutates data — it only links out.
 */
import Link from "next/link";
import { hub } from "@/app/_copy";
import type { TreeNode } from "@chronicle/core";
import { KindredButton } from "@/app/_kindred";
import { displayNameFor, isAnonymousBridge, lifeLineFor, relationToRootLabel } from "./person-node";

export interface PersonPanelProps {
  node: TreeNode;
  isRoot: boolean;
  familyId: string;
  onClose: () => void;
}

export function PersonPanel({ node, isRoot, familyId, onClose }: PersonPanelProps) {
  const name = displayNameFor(node);
  const relation = relationToRootLabel(node, isRoot);
  const life = lifeLineFor(node);
  // An anonymous bridge is a placeholder; an identified person with no name on file is still real.
  const anon = isAnonymousBridge(node);
  const hasName = node.displayName != null && node.displayName.trim().length > 0;

  const storiesHref = `/hub/about/${node.personId}`;
  const centerHref = `/hub/tree?scope=${familyId}&root=${node.personId}`;
  const manageKinHref = `/hub/kin?scope=${familyId}`;

  return (
    <aside
      role="dialog"
      aria-label={name}
      data-testid="tree-person-panel"
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: 280,
        maxWidth: "calc(100% - 24px)",
        background: "var(--surface-card)",
        border: "var(--border-width) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg, 0 8px 30px rgba(0,0,0,0.12))",
        padding: 20,
        zIndex: 2,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={hub.tree.backToKin}
        data-testid="tree-panel-close"
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontSize: "1.25rem",
          lineHeight: 1,
          color: "var(--text-muted)",
        }}
      >
        {"×"}
      </button>

      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: "0 24px 4px 0",
          fontStyle: anon ? "italic" : "normal",
        }}
      >
        {name}
      </h2>

      {(relation || life) && (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "0 0 4px",
          }}
        >
          {[relation, life].filter(Boolean).join(" · ")}
        </p>
      )}

      {/* Only for an identified-but-nameless real person — an anon bridge already reads "Unknown
          <relation>" in the heading, so a second "Unknown relative" line would be redundant. */}
      {!hasName && !anon && (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "0.7rem",
            color: "var(--text-meta)",
            margin: "0 0 18px",
          }}
        >
          {hub.tree.unknownRelative}
        </p>
      )}

      <nav style={{ display: "grid", gap: 8 }}>
        <Link href={storiesHref} style={{ textDecoration: "none" }} data-testid="tree-panel-stories">
          <KindredButton variant="secondary" size="small" fullWidth type="button">
            {hub.tree.panelStories}
          </KindredButton>
        </Link>
        {!isRoot && (
          <Link href={centerHref} style={{ textDecoration: "none" }} data-testid="tree-panel-center">
            <KindredButton variant="secondary" size="small" fullWidth type="button">
              {hub.tree.panelCenterHere}
            </KindredButton>
          </Link>
        )}
        <Link href={manageKinHref} style={{ textDecoration: "none" }} data-testid="tree-panel-managekin">
          <KindredButton variant="ghost" size="small" fullWidth type="button">
            {hub.tree.panelManageKin}
          </KindredButton>
        </Link>
      </nav>
    </aside>
  );
}
