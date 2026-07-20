"use client";

/**
 * #254 — List-view "Relationships in this family" section. Surfaces steward Remove / subject Hide for
 * every actable visible edge (same controls as PersonDetails on the tree). Shown only when the viewer
 * can act on ≥1 edge. After a successful action, refreshes server props so the projection updates.
 */
import { useRouter } from "next/navigation";
import type { GovernableKinEdge } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { KinEdgeControls } from "../kin/kin-edge-controls";
import { actableEdges, edgeSentence, governableEdgeKey } from "../kin/edge-sentence";

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
      style={{ maxWidth: 720, marginTop: 28 }}
      aria-labelledby="family-gov-heading"
    >
      <h2
        id="family-gov-heading"
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: "0 0 6px",
        }}
      >
        {hub.kin.govHeading}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-muted)",
          margin: "0 0 16px",
        }}
      >
        {hub.kin.govIntro}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
        {actable.map((edge) => (
          <li
            key={governableEdgeKey(edge)}
            data-testid="family-gov-edge"
            style={{
              background: "var(--surface-card)",
              border: "var(--border-width) solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "16px 20px",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui)",
                color: "var(--text-body)",
                margin: 0,
              }}
            >
              {edgeSentence(edge)}
            </p>
            <KinEdgeControls
              familyId={familyId}
              edge={edge}
              onSuccess={() => router.refresh()}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
