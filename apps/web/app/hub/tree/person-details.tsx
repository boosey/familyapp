"use client";
/**
 * PersonDetails — the read-only details sheet opened by a DOUBLE-click/double-tap on a card (tree
 * Slice A, display half of #4). Replaces the deleted PersonPanel.
 *
 * Read-only / navigational only: it NEVER re-roots (that is the kebab's Focus action now) and NEVER
 * writes (edit affordances are Slice C). Shows the name (or "Unknown <relation>"), dates, and the
 * relation-to-VIEWER (derived client-side by the canvas from the loaded edges — the tree is
 * focus-rooted so `node.relationToRoot` can't stand in for it). Passed in as `relationToViewer`;
 * "self"/null omit the relation line.
 *
 * Three navigation links: Stories contributed · Photos contributed · Mentions. Only Mentions has a
 * live destination in Slice A (`/hub/about/[personId]`); the other two render DISABLED with a
 * "coming soon" affordance (their real destinations land in Slice B). Dismissible via × / Escape /
 * outside-click.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { hub } from "@/app/_copy";
import type { KinRelation, TreeNode } from "@chronicle/core";
import { KindredButton } from "@/app/_kindred";
import { datesLineFor, displayNameFor, isAnonymousBridge } from "./person-node";

const RELATION_LABEL: Record<KinRelation, string> = hub.kin.relationLabel;

export interface PersonDetailsProps {
  node: TreeNode;
  /** Relation of this person to the VIEWER, derived client-side; "self"/null ⇒ no relation line. */
  relationToViewer: KinRelation | "self" | null;
  onClose: () => void;
}

export function PersonDetails({ node, relationToViewer, onClose }: PersonDetailsProps) {
  const name = displayNameFor(node);
  const relation =
    relationToViewer === null || relationToViewer === "self" ? "" : RELATION_LABEL[relationToViewer];
  const dates = datesLineFor(node);
  const anon = isAnonymousBridge(node);
  const hasName = node.displayName != null && node.displayName.trim().length > 0;
  const rootRef = useRef<HTMLElement | null>(null);

  const mentionsHref = `/hub/about/${node.personId}`;

  // Dismiss on Escape / outside-click (× is the explicit control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDocPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDocPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocPointer);
    };
  }, [onClose]);

  return (
    <aside
      ref={rootRef}
      role="dialog"
      aria-label={name}
      data-testid="tree-person-details"
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
        aria-label={hub.tree.detailsClose}
        data-testid="tree-details-close"
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

      <nav style={{ display: "grid", gap: 8, marginTop: 14 }}>
        {/* Stories/Photos contributed — destinations arrive in Slice B; disabled + "coming soon". */}
        <ComingSoonLink label={hub.tree.detailsStories} testId="tree-details-stories" />
        <ComingSoonLink label={hub.tree.detailsPhotos} testId="tree-details-photos" />
        {/* Mentions — the one live destination in Slice A. */}
        <Link href={mentionsHref} style={{ textDecoration: "none" }} data-testid="tree-details-mentions">
          <KindredButton variant="secondary" size="small" fullWidth type="button">
            {hub.tree.detailsMentions}
          </KindredButton>
        </Link>
      </nav>
    </aside>
  );
}

/** A disabled nav link with a "coming soon" affordance (a real destination lands in Slice B). */
function ComingSoonLink({ label, testId }: { label: string; testId: string }) {
  return (
    <span
      data-testid={testId}
      title={hub.tree.comingSoon}
      style={{ display: "block", position: "relative" }}
    >
      <KindredButton variant="secondary" size="small" fullWidth type="button" disabled>
        {label}
      </KindredButton>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          right: 12,
          transform: "translateY(-50%)",
          fontFamily: "var(--font-ui)",
          fontSize: "0.62rem",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-meta)",
          pointerEvents: "none",
        }}
      >
        {hub.tree.comingSoon}
      </span>
    </span>
  );
}
