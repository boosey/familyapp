"use client";

/**
 * #254 — "Relationships in this family" section (steward Remove / subject Hide for actable edges).
 * #283 removed this from Family → List (browse-only). Tree governance lives on PersonDetails; this
 * module remains for its skin/contract tests and any future non-List mount.
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
