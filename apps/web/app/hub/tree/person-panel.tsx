"use client";
/**
 * PersonPanel — the read-only detail panel opened by a name click (spec §2).
 *
 * Read-only / navigational; it NEVER re-roots (the old "Center tree here" action is removed) and NEVER
 * writes. Shows the name (or "Unknown <relation>"), the relation-to-VIEWER, and the dates. Because the
 * tree is now rooted on the FOCUS (not the viewer), relation-to-viewer is derived client-side by the
 * canvas from the loaded edges and passed in as `relationToViewer` (null when the viewer isn't in the
 * loaded projection, e.g. a distant focus, or no relation resolves — the line is then omitted). Retains
 * the navigational links (stories, add-relative anchored on this person, manage kin). A seam is left for
 * TBD personal-detail fields.
 */
import Link from "next/link";
import { hub } from "@/app/_copy";
import type { KinRelation, TreeNode } from "@chronicle/core";
import { KindredButton } from "@/app/_kindred";
import { datesLineFor, displayNameFor, isAnonymousBridge } from "./person-node";
import { useTreeAdd } from "./add-relative-context";

const RELATION_LABEL: Record<KinRelation, string> = hub.kin.relationLabel;

export interface PersonPanelProps {
  node: TreeNode;
  /** Relation of this person to the VIEWER, derived client-side; "self"/null ⇒ no relation line. */
  relationToViewer: KinRelation | "self" | null;
  onClose: () => void;
}

export function PersonPanel({ node, relationToViewer, onClose }: PersonPanelProps) {
  const openAdd = useTreeAdd();
  const name = displayNameFor(node);
  const relation =
    relationToViewer === null || relationToViewer === "self" ? "" : RELATION_LABEL[relationToViewer];
  const dates = datesLineFor(node);
  const anon = isAnonymousBridge(node);
  const hasName = node.displayName != null && node.displayName.trim().length > 0;

  const storiesHref = `/hub/about/${node.personId}`;
  // Add-a-relative opens the tree's shared modal (anchored on this person), then closes the panel.
  const startAdd = (relation: "parent" | "child" | "sibling" | "partner") => {
    openAdd(node.personId, relation);
    onClose();
  };

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

      {(relation || dates) && (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "0 0 4px",
          }}
        >
          {[relation, dates].filter(Boolean).join(" · ")}
        </p>
      )}

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

      {/* Seam for TBD personal-detail fields (spec §2): additional read-only facts render here. */}

      <nav style={{ display: "grid", gap: 8, marginTop: 14 }}>
        <Link href={storiesHref} style={{ textDecoration: "none" }} data-testid="tree-panel-stories">
          <KindredButton variant="secondary" size="small" fullWidth type="button">
            {hub.tree.panelStories}
          </KindredButton>
        </Link>
        <KindredButton
          variant="secondary"
          size="small"
          fullWidth
          type="button"
          data-testid="tree-panel-addparent"
          onClick={() => startAdd("parent")}
        >
          {hub.tree.panelAddParent}
        </KindredButton>
        <KindredButton
          variant="secondary"
          size="small"
          fullWidth
          type="button"
          data-testid="tree-panel-addchild"
          onClick={() => startAdd("child")}
        >
          {hub.tree.panelAddChild}
        </KindredButton>
        <KindredButton
          variant="secondary"
          size="small"
          fullWidth
          type="button"
          data-testid="tree-panel-addsibling"
          onClick={() => startAdd("sibling")}
        >
          {hub.tree.panelAddSibling}
        </KindredButton>
        <KindredButton
          variant="secondary"
          size="small"
          fullWidth
          type="button"
          data-testid="tree-panel-addpartner"
          onClick={() => startAdd("partner")}
        >
          {hub.tree.addPartner}
        </KindredButton>
      </nav>
    </aside>
  );
}
