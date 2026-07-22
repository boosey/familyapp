"use client";

/**
 * #289 — popover opened by clicking a stored generative edge hit-target on the tree canvas.
 * Reuses KinEdgeControls / edgeSentence; PersonDetails remains the fallback surface.
 */
import type { GovernableKinEdge } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { KinEdgeControls, type KinEdgeGovernAction } from "../kin/kin-edge-controls";
import { edgeSentence, governableEdgeKey } from "../kin/edge-sentence";
import govStyles from "../kin/GovernableEdgeList.module.css";
import styles from "./line-governance-menu.module.css";

export function LineGovernanceMenu({
  familyId,
  edges,
  onClose,
  onEdgeGoverned,
}: {
  familyId: string;
  edges: readonly GovernableKinEdge[];
  onClose: () => void;
  onEdgeGoverned?: (edge: GovernableKinEdge, kind: KinEdgeGovernAction) => void;
}) {
  if (edges.length === 0) return null;

  return (
    <div
      className={styles.root}
      role="dialog"
      aria-label={hub.tree.lineGovernMenu}
      data-testid="tree-line-gov-menu"
    >
      <div className={styles.header}>
        <h2 className={styles.heading}>{hub.tree.lineGovernHeading}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={hub.tree.detailsClose}>
          ×
        </button>
      </div>
      <ul className={govStyles.list}>
        {edges.map((edge) => (
          <li key={governableEdgeKey(edge)} data-testid="tree-line-gov-edge" className={govStyles.edge}>
            <p className={govStyles.sentence}>{edgeSentence(edge)}</p>
            <KinEdgeControls
              familyId={familyId}
              edge={edge}
              onSuccess={(kind) => {
                onEdgeGoverned?.(edge, kind);
                onClose();
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
