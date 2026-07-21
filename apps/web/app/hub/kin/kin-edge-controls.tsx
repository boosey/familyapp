"use client";

/**
 * Governance + hide controls for one kinship edge (issues #33/#34, widened by #256) - client
 * component wrapping the edge server actions. Renders ONLY the controls the viewer is entitled to (per
 * the capability flags the audited read composition computed): steward -> Endorse / Remove / Update nature (parent_of);
 * the ORIGINAL ASSERTER of the edge (steward or not) -> Remove, retracting their own mistake (#256); a
 * self-endpoint subject -> Hide. The server actions re-check every gate, so these flags are
 * affordances, not the authorization.
 *
 * Re-homed onto the Family tree (#254): PersonDetails + the List-view relationships section. Nature
 * correction (#255) uses the existing append-only `correctEdge` path - partner edges have no nature
 * control. On success, `onSuccess` reports which action ran so the mount can prune client tree
 * state only for deny/hide (affirm/correct must keep the edge visible - TreeCanvas merge won't
 * restore a wrongly pruned edge when only `state`/`nature` changed).
 */
import { useState, useTransition } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import type { GovernableKinEdge } from "@chronicle/core";
import type { KinshipNature } from "@chronicle/db";
import {
  affirmEdgeAction,
  correctEdgeAction,
  denyEdgeAction,
  hideEdgeAction,
  type ActionResult,
} from "./actions";

/** Which governance control succeeded — mount points prune the tree only for deny/hide. */
export type KinEdgeGovernAction = "affirm" | "deny" | "hide" | "correct";

const NATURE_OPTIONS = [
  "biological",
  "adoptive",
  "step",
  "foster",
  "unknown",
] as const satisfies readonly KinshipNature[];

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
  kind,
  label,
  pendingLabel,
  onError,
  onSuccess,
}: {
  familyId: string;
  edge: GovernableKinEdge;
  action: (formData: FormData) => Promise<ActionResult>;
  kind: KinEdgeGovernAction;
  label: string;
  pendingLabel: string;
  onError: (msg: string | null) => void;
  onSuccess?: (kind: KinEdgeGovernAction) => void;
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
      onSuccess?.(kind);
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

/** Steward-only parent_of nature picker → `correctEdgeAction` (#255). */
function CorrectNatureForm({
  familyId,
  edge,
  onError,
  onSuccess,
}: {
  familyId: string;
  edge: GovernableKinEdge;
  onError: (msg: string | null) => void;
  onSuccess?: (kind: KinEdgeGovernAction) => void;
}) {
  const [pending, startTransition] = useTransition();
  const defaultNature: KinshipNature =
    edge.nature && NATURE_OPTIONS.includes(edge.nature as (typeof NATURE_OPTIONS)[number])
      ? edge.nature
      : "unknown";

  function onSubmit(formData: FormData) {
    onError(null);
    startTransition(async () => {
      const result = await correctEdgeAction(formData);
      if (result?.error) {
        onError(result.error);
        return;
      }
      onSuccess?.("correct");
    });
  }

  return (
    <form
      action={onSubmit}
      style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}
      data-testid="kin-edge-correct-nature"
    >
      <EdgeFields familyId={familyId} edge={edge} />
      <label className="kin-form-label" style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-meta)" }}>
          {hub.kin.natureFieldLabel}
        </span>
        <select
          name="nature"
          className="kin-field"
          defaultValue={defaultNature}
          disabled={pending}
          aria-label={hub.kin.natureFieldLabel}
          style={{ minHeight: "auto", padding: "4px 8px", width: "auto" }}
        >
          {NATURE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {hub.kin.natureOptions[n]}
            </option>
          ))}
        </select>
      </label>
      <KindredButton
        type="submit"
        size="small"
        label={pending ? hub.kin.correcting : hub.kin.correct}
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
  /** Fired after a successful affirm/deny/hide/correct so the mount can refresh projection + client state. */
  onSuccess?: (kind: KinEdgeGovernAction) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  if (!edge.viewerCanRemove && !edge.viewerCanHide) return null;

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
          kind="affirm"
          label={hub.kin.affirm}
          pendingLabel={hub.kin.affirming}
          onError={setError}
          onSuccess={onSuccess}
        />
      ) : null}
      {/* #256: Remove is available to the steward (any edge) OR the edge's original asserter
          (their own edge only) — `viewerCanRemove` already encodes that gate. */}
      {edge.viewerCanRemove ? (
        <ActionButton
          familyId={familyId}
          edge={edge}
          action={denyEdgeAction}
          kind="deny"
          label={hub.kin.deny}
          pendingLabel={hub.kin.denying}
          onError={setError}
          onSuccess={onSuccess}
        />
      ) : null}
      {edge.viewerIsSteward && edge.edgeType === "parent_of" ? (
        <CorrectNatureForm
          familyId={familyId}
          edge={edge}
          onError={setError}
          onSuccess={onSuccess}
        />
      ) : null}
      {edge.viewerCanHide ? (
        <ActionButton
          familyId={familyId}
          edge={edge}
          action={hideEdgeAction}
          kind="hide"
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
