"use client";
/**
 * #337 — Steward Reconciliation flow: complementary picker → confirm →
 * `reconcileMentionAction`. Shared by Family List rows and Tree kebab.
 *
 * Start side may be mention or member; API args are always mention (loser) +
 * account (winner). Confirm shows both display names + a short consequence
 * (not an edge list). On success: toast + focus winner via `onSuccess`.
 */
import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { hub } from "@/app/_copy";
import { ModalShell } from "@/app/_kindred/ModalShell";
import {
  complementaryCandidates,
  reconcileApiIds,
  reconcileSideOf,
  type ReconcilePersonView,
} from "@/lib/reconcile-eligibility";
import {
  reconcileMentionAction,
  type ReconcileActionResult,
} from "../tree/kin-actions";

function displayName(p: ReconcilePersonView): string {
  const n = p.displayName?.trim();
  return n ? n : hub.reconcile.unnamed;
}

export interface ReconcileFlowProps {
  familyId: string;
  /** Person the steward started from (List row or Tree card). */
  start: ReconcilePersonView;
  /** Full family people pool (List index) — complementary candidates come from here. */
  pool: readonly ReconcilePersonView[];
  onClose: () => void;
  /** Called with the winner (account) person id after a successful reconcile. */
  onSuccess: (accountPersonId: string) => void;
  /** Overridable in tests. */
  onReconcile?: typeof reconcileMentionAction;
}

type Step =
  | { kind: "pick" }
  | { kind: "confirm"; picked: ReconcilePersonView };

export function ReconcileFlow({
  familyId,
  start,
  pool,
  onClose,
  onSuccess,
  onReconcile = reconcileMentionAction,
}: ReconcileFlowProps) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const startSide = reconcileSideOf(start);
  const candidates = complementaryCandidates(start, pool);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (picked: ReconcilePersonView) => {
    const ids = reconcileApiIds(start, picked);
    if (!ids) {
      setError(hub.reconcile.failed);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result: ReconcileActionResult = await onReconcile({
        familyId,
        mentionPersonId: ids.mentionPersonId,
        accountPersonId: ids.accountPersonId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess(result.accountPersonId);
    });
  };

  if (step.kind === "confirm") {
    const ids = reconcileApiIds(start, step.picked);
    const mentionName = ids
      ? displayName(ids.mentionPersonId === start.personId ? start : step.picked)
      : displayName(start);
    const memberName = ids
      ? displayName(ids.accountPersonId === start.personId ? start : step.picked)
      : displayName(step.picked);

    return (
      <ModalShell
        onOverlayClick={onClose}
        maxWidth={440}
        role="dialog"
        aria-modal="true"
        aria-label={hub.reconcile.confirmHeading}
        data-testid="reconcile-confirm-modal"
      >
        <div style={{ padding: 24 }}>
          <Header title={hub.reconcile.confirmHeading} onClose={onClose} closeLabel={hub.reconcile.confirmClose} />
          <p style={INTRO_STYLE} data-testid="reconcile-confirm-body">
            {hub.reconcile.confirmBody(mentionName, memberName)}
          </p>
          {error ? (
            <p role="alert" style={ERROR_STYLE} data-testid="reconcile-error">
              {error}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
            <button type="button" onClick={onClose} disabled={pending} style={SECONDARY_BTN} data-testid="reconcile-confirm-cancel">
              {hub.reconcile.confirmCancel}
            </button>
            <button
              type="button"
              onClick={() => submit(step.picked)}
              disabled={pending}
              style={PRIMARY_BTN}
              data-testid="reconcile-confirm-submit"
            >
              {pending ? hub.reconcile.confirming : hub.reconcile.confirmSubmit}
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  const intro =
    startSide === "mention" ? hub.reconcile.pickerIntroMention : hub.reconcile.pickerIntroMember;

  return (
    <ModalShell
      onOverlayClick={onClose}
      maxWidth={440}
      role="dialog"
      aria-modal="true"
      aria-label={hub.reconcile.pickerHeading}
      data-testid="reconcile-picker-modal"
    >
      <div style={{ padding: 24 }}>
        <Header title={hub.reconcile.pickerHeading} onClose={onClose} closeLabel={hub.reconcile.pickerClose} />
        <p style={INTRO_STYLE}>{intro}</p>
        {candidates.length === 0 ? (
          <p style={INTRO_STYLE}>{hub.reconcile.pickerEmpty}</p>
        ) : (
          <ul
            style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 8 }}
            data-testid="reconcile-candidate-list"
          >
            {candidates.map((c) => (
              <li key={c.personId}>
                <button
                  type="button"
                  data-testid={`reconcile-candidate-${c.personId}`}
                  onClick={() => {
                    setError(null);
                    setStep({ kind: "confirm", picked: c });
                  }}
                  style={CANDIDATE_BTN}
                >
                  {displayName(c)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}

function Header({
  title,
  onClose,
  closeLabel,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "1.25rem", color: "var(--text-heading)" }}>
        {title}
      </h2>
      <button type="button" onClick={onClose} aria-label={closeLabel} style={CLOSE_BTN}>
        ×
      </button>
    </div>
  );
}

const INTRO_STYLE: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  lineHeight: 1.45,
};

const ERROR_STYLE: CSSProperties = {
  margin: "12px 0 0",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-danger)",
};

const CANDIDATE_BTN: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "12px 14px",
  borderRadius: "var(--radius-md)",
  border: "var(--border-width) solid var(--border)",
  background: "var(--surface-card)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui)",
  color: "var(--text-body)",
  cursor: "pointer",
};

const PRIMARY_BTN: CSSProperties = {
  padding: "10px 16px",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-contrast, #fff)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui)",
  cursor: "pointer",
};

const SECONDARY_BTN: CSSProperties = {
  padding: "10px 16px",
  borderRadius: "var(--radius-md)",
  border: "var(--border-width) solid var(--border)",
  background: "transparent",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui)",
  color: "var(--text-body)",
  cursor: "pointer",
};

const CLOSE_BTN: CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: "1.4rem",
  lineHeight: 1,
  cursor: "pointer",
  color: "var(--text-muted)",
  padding: 4,
};
