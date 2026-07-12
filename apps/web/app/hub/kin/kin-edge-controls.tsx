"use client";

/**
 * Governance + hide controls for one kinship edge (issues #33/#34) — client component wrapping the
 * edge server actions. Renders ONLY the controls the viewer is entitled to (per the capability flags
 * the audited read composition computed): steward → Endorse / Remove; a self-endpoint subject → Hide.
 * The server actions re-check every gate, so these flags are affordances, not the authorization.
 *
 * Minimal, matching the Kindred conventions used by the rest of /hub/kin (`<KindredButton>`, inline
 * error copy). Each control is its own tiny form carrying the edge identity in hidden fields.
 */
import { useState, useTransition } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import type { GovernableKinEdge } from "@chronicle/core";
import { affirmEdgeAction, denyEdgeAction, type ActionResult } from "./actions";

/** The hidden edge-identity fields every edge action reads server-side. */
function EdgeFields({ familyId, edge }: { familyId: string; edge: GovernableKinEdge }) {
  return (
    <>
      <input type="hidden" name="familyId" value={familyId} />
      <input type="hidden" name="edgeType" value={edge.edgeType} />
      <input type="hidden" name="personAId" value={edge.personAId} />
      <input type="hidden" name="personBId" value={edge.personBId} />
    </>
  );
}

function ActionButton({
  familyId,
  edge,
  action,
  label,
  pendingLabel,
  onError,
}: {
  familyId: string;
  edge: GovernableKinEdge;
  action: (formData: FormData) => Promise<ActionResult>;
  label: string;
  pendingLabel: string;
  onError: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  function onSubmit(formData: FormData) {
    onError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (result?.error) onError(result.error);
    });
  }
  return (
    <form action={onSubmit} style={{ display: "inline" }}>
      <EdgeFields familyId={familyId} edge={edge} />
      <KindredButton type="submit" label={pending ? pendingLabel : label} disabled={pending} />
    </form>
  );
}

export function KinEdgeControls({
  familyId,
  edge,
}: {
  familyId: string;
  edge: GovernableKinEdge;
}) {
  const [error, setError] = useState<string | null>(null);

  if (!edge.viewerIsSteward) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}>
      {edge.viewerIsSteward && edge.state !== "affirmed" ? (
        <ActionButton
          familyId={familyId}
          edge={edge}
          action={affirmEdgeAction}
          label={hub.kin.affirm}
          pendingLabel={hub.kin.affirming}
          onError={setError}
        />
      ) : null}
      {edge.viewerIsSteward ? (
        <ActionButton
          familyId={familyId}
          edge={edge}
          action={denyEdgeAction}
          label={hub.kin.deny}
          pendingLabel={hub.kin.denying}
          onError={setError}
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          style={{
            width: "100%",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-danger, #b00)",
            margin: "4px 0 0",
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
