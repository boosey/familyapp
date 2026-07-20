"use client";

/**
 * Governance + hide controls for one kinship edge (issues #33/#34) — client component wrapping the
 * edge server actions. Renders ONLY the controls the viewer is entitled to (per the capability flags
 * the audited read composition computed): steward → Endorse / Remove; a self-endpoint subject → Hide.
 * The server actions re-check every gate, so these flags are affordances, not the authorization.
 *
 * Re-homed onto the Family tree (#254): PersonDetails + the List-view relationships section. On
 * success, `onSuccess` lets the mount point refresh client tree state (TreeCanvas merge is additive
 * and won't drop a denied edge on its own) and call `router.refresh()`.
 */
import { useState, useTransition } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import type { GovernableKinEdge } from "@chronicle/core";
import {
  affirmEdgeAction,
  denyEdgeAction,
  hideEdgeAction,
  type ActionResult,
} from "./actions";

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
  onSuccess,
}: {
  familyId: string;
  edge: GovernableKinEdge;
  action: (formData: FormData) => Promise<ActionResult>;
  label: string;
  pendingLabel: string;
  onError: (msg: string | null) => void;
  onSuccess?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  function onSubmit(formData: FormData) {
    onError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (result?.error) {
        onError(result.error);
        return;
      }
      onSuccess?.();
    });
  }
  return (
    <form action={onSubmit} style={{ display: "inline" }}>
      <EdgeFields familyId={familyId} edge={edge} />
      <KindredButton
        type="submit"
        size="small"
        label={pending ? pendingLabel : label}
        disabled={pending}
      />
    </form>
  );
}

export function KinEdgeControls({
  familyId,
  edge,
  onSuccess,
}: {
  familyId: string;
  edge: GovernableKinEdge;
  /** Fired after a successful affirm/deny/hide so the mount can refresh projection + client state. */
  onSuccess?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  if (!edge.viewerIsSteward && !edge.viewerCanHide) return null;

  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}
      data-testid="kin-edge-controls"
    >
      {edge.viewerIsSteward && edge.state !== "affirmed" ? (
        <ActionButton
          familyId={familyId}
          edge={edge}
          action={affirmEdgeAction}
          label={hub.kin.affirm}
          pendingLabel={hub.kin.affirming}
          onError={setError}
          onSuccess={onSuccess}
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
          onSuccess={onSuccess}
        />
      ) : null}
      {edge.viewerCanHide ? (
        <ActionButton
          familyId={familyId}
          edge={edge}
          action={hideEdgeAction}
          label={hub.kin.hide}
          pendingLabel={hub.kin.hiding}
          onError={setError}
          onSuccess={onSuccess}
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          style={{
            width: "100%",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-danger)",
            margin: "4px 0 0",
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
