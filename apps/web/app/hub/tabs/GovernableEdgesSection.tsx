"use client";

/**
 * #254 — List-view "Relationships in this family" section. Surfaces steward Remove / subject Hide for
 * every actable visible edge (same controls as PersonDetails on the tree). Shown only when the viewer
 * can act on ≥1 edge. After a successful action, refreshes server props so the projection updates.
 *
 * Styling: CSS Modules + data-skin Phase-2 (issue #265). Shared GovernableEdgeList classes with the
 * tree person-details mount — no skin id in component logic.
 */
import { useRouter } from "next/navigation";
import type { GovernableKinEdge } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { KinEdgeControls } from "../kin/kin-edge-controls";
import { actableEdges, edgeSentence, governableEdgeKey } from "../kin/edge-sentence";
import styles from "../kin/GovernableEdgeList.module.css";

export function GovernableEdgesSection({
  familyId,
  edges,
}: {
  familyId: string;
  edges: readonly GovernableKinEdge[];
}) {
  const router = useRouter();
  const actable = actableEdges(edges);
  if (actable.length === 0) return null;

  return (
    <section
      data-testid="family-gov-edges"
      className={styles.section}
      aria-labelledby="family-gov-heading"
    >
      <h2 id="family-gov-heading" className={styles.heading}>
        {hub.kin.govHeading}
      </h2>
      <p className={styles.intro}>{hub.kin.govIntro}</p>
      <ul className={styles.list}>
        {actable.map((edge) => (
          <li key={governableEdgeKey(edge)} data-testid="family-gov-edge" className={styles.edge}>
            <p className={styles.sentence}>{edgeSentence(edge)}</p>
            <KinEdgeControls
              familyId={familyId}
              edge={edge}
              onSuccess={() => {
                router.refresh();
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
