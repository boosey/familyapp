"use client";
/**
 * ColdInviteModal — in-place Invite modal opened from the Family-surface Invite button.
 *
 * Same chrome as `PersonInviteModal` (ModalShell + MemberInviteForm + in-place sent/error states),
 * but for a cold invite: all fields editable, no person prefill, families/seed come from the current
 * hub scope rather than a person-bound targets fetch.
 */
import { useActionState, useEffect } from "react";
import { hub } from "@/app/_copy";
import { ModalShell } from "@/app/_kindred/ModalShell";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { MemberInviteForm } from "./MemberInviteForm";
import { CopyButton } from "./CopyButton";
import {
  createColdMemberInviteAction,
  type ColdInviteFormState,
} from "./cold-invite-actions";

const COLD_INVITE_IDLE_STATE: ColdInviteFormState = { status: "idle" };

export interface ColdInviteModalProps {
  families: { id: string; name: string; shortName?: string | null }[];
  seededFamily: string | null;
  onClose: () => void;
  /** Injected for tests; default to the real server action. */
  submitInvite?: (
    prevState: ColdInviteFormState,
    formData: FormData,
  ) => Promise<ColdInviteFormState>;
}

export function ColdInviteModal({
  families,
  seededFamily,
  onClose,
  submitInvite = createColdMemberInviteAction,
}: ColdInviteModalProps) {
  const [state, formAction] = useActionState(submitInvite, COLD_INVITE_IDLE_STATE);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = hub.invite.memberHeading;

  return (
    <ModalShell
      onOverlayClick={onClose}
      maxWidth={480}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="cold-invite-modal"
    >
      <div style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              fontWeight: 500,
              color: "var(--text-body)",
              margin: 0,
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={hub.personInvite.close}
            data-testid="cold-invite-close"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "1.4rem",
              lineHeight: 1,
              padding: 4,
            }}
          >
            <span aria-hidden="true">{"×"}</span>
          </button>
        </div>

        {state.status === "sent" ? (
          <div data-testid="cold-invite-sent" style={{ display: "grid", gap: 16 }}>
            {state.sendingTo ? (
              <p style={mutedTextStyle}>{hub.invite.sendingTo(state.sendingTo)}</p>
            ) : null}
            <p style={mutedTextStyle}>{hub.personInvite.sentBlurb}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <code data-testid="cold-invite-link" style={lockedFieldStyle}>
                {state.link}
              </code>
              <CopyButton value={state.link} />
            </div>
            <div>
              <ActionButton
                variant="secondary"
                type="button"
                data-testid="cold-invite-done"
                onClick={onClose}
              >
                {hub.personInvite.done}
              </ActionButton>
            </div>
          </div>
        ) : families.length === 0 ? (
          <p style={mutedTextStyle} data-testid="cold-invite-no-families">
            {hub.shell.pendingEmpty}
          </p>
        ) : (
          <>
            <MemberInviteForm
              action={formAction}
              families={families}
              seededFamily={seededFamily}
            />
            {state.status === "error" ? (
              <p role="alert" data-testid="cold-invite-error" style={errorTextStyle}>
                {state.message}
              </p>
            ) : null}
          </>
        )}
      </div>
    </ModalShell>
  );
}

const mutedTextStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: 0,
};

const errorTextStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-danger)",
  margin: "12px 0 0",
};

const lockedFieldStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-body)",
  background: "var(--surface-sunken)",
  border: "var(--border-width) solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "10px 12px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
