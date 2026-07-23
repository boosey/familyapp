"use client";
/**
 * PersonInviteModal — the IN-PLACE, person-bound Invite modal (#334, ADR-0028).
 *
 * Opened from BOTH Tree's details sheet Invite button and its per-card kebab's Invite… item (the SAME
 * handler in `tree-canvas.tsx` opens this for both — #334 AC 5), and from List's PersonDetails
 * (`FamilyTab.tsx`). Replaces the old deep-link to `/hub?tab=invite&…` (#334 retires it): Invite never
 * navigates away from List/Tree (AC 1), and the Person details sheet underneath it stays mounted and
 * open the whole time, including after a successful send (AC 4) — this modal is a sibling overlay, not
 * a replacement for the details sheet.
 *
 * On open it fetches the SERVER-PREPARED invite targets (`listPersonBoundInviteTargetsAction`): the
 * viewer's active families minus any the invitee already belongs to (AC 2), the single-family auto-seed
 * (or none for 0/2+ remaining), and a best-effort name/email/phone prefill. That prefill is MODAL-ONLY
 * state fed into the (shared, cold-path) `MemberInviteForm` — it is never written back to the Person's
 * own record (AC 3).
 *
 * The write path (`createPersonBoundMemberInviteAction`) is bound via `useActionState` rather than a
 * plain `<form action>`, because — unlike the cold Invite tab, which redirects to a result view — this
 * modal has nowhere to redirect TO (it must stay over Tree/List) and needs the result back in place to
 * show the ready-to-share link or an inline error.
 */
import { useActionState, useEffect, useState } from "react";
import { hub } from "@/app/_copy";
import { ModalShell } from "@/app/_kindred/ModalShell";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { MemberInviteForm } from "../tabs/MemberInviteForm";
import { CopyButton } from "../tabs/CopyButton";
import {
  createPersonBoundMemberInviteAction,
  listPersonBoundInviteTargetsAction,
  type PersonInviteFormState,
  type PersonInviteTargets,
  type PersonInviteTargetsResult,
} from "./person-invite-actions";

/** Client-side idle seed for `useActionState` — must NOT live in the `"use server"` actions file. */
const PERSON_INVITE_IDLE_STATE: PersonInviteFormState = { status: "idle" };

export interface PersonInviteModalProps {
  personId: string;
  /** Shown as the heading fallback while targets are still loading. */
  fallbackName?: string | null;
  onClose: () => void;
  /** Injected for tests; default to the real server actions. */
  fetchTargets?: (personId: string) => Promise<PersonInviteTargetsResult>;
  submitInvite?: (
    prevState: PersonInviteFormState,
    formData: FormData,
  ) => Promise<PersonInviteFormState>;
}

export function PersonInviteModal({
  personId,
  fallbackName,
  onClose,
  fetchTargets = listPersonBoundInviteTargetsAction,
  submitInvite = createPersonBoundMemberInviteAction,
}: PersonInviteModalProps) {
  const [targets, setTargets] = useState<PersonInviteTargets | null>(null);
  const [loadError, setLoadError] = useState<"invalid" | "not-eligible" | "unauthorized" | null>(null);
  const [state, formAction] = useActionState(submitInvite, PERSON_INVITE_IDLE_STATE);

  useEffect(() => {
    let alive = true;
    void fetchTargets(personId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setTargets(res.data);
        else setLoadError(res.error);
      })
      .catch(() => {
        if (alive) setLoadError("invalid");
      });
    return () => {
      alive = false;
    };
  }, [fetchTargets, personId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const name = targets?.displayName || fallbackName || "";
  const title = hub.personInvite.heading(name);

  return (
    <ModalShell
      onOverlayClick={onClose}
      maxWidth={480}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="person-invite-modal"
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
            data-testid="person-invite-close"
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
          <div data-testid="person-invite-sent" style={{ display: "grid", gap: 16 }}>
            {state.sendingTo ? (
              <p style={mutedTextStyle}>{hub.invite.sendingTo(state.sendingTo)}</p>
            ) : null}
            <p style={mutedTextStyle}>{hub.personInvite.sentBlurb}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <code data-testid="person-invite-link" style={lockedFieldStyle}>
                {state.link}
              </code>
              <CopyButton value={state.link} />
            </div>
            <div>
              <ActionButton
                variant="secondary"
                type="button"
                data-testid="person-invite-done"
                onClick={onClose}
              >
                {hub.personInvite.done}
              </ActionButton>
            </div>
          </div>
        ) : loadError ? (
          <p style={mutedTextStyle} data-testid="person-invite-load-error">
            {hub.personInvite.loadError}
          </p>
        ) : !targets ? (
          <p style={mutedTextStyle} data-testid="person-invite-loading">
            {hub.personInvite.loading}
          </p>
        ) : targets.families.length === 0 ? (
          <p style={mutedTextStyle} data-testid="person-invite-no-families">
            {hub.personInvite.noEligibleFamilies}
          </p>
        ) : (
          <>
            <MemberInviteForm
              action={formAction}
              families={targets.families}
              seededFamily={targets.seededFamilyId}
              defaultName={name}
              defaultEmail={targets.email}
              defaultPhone={targets.phone}
              existingInviteePersonId={personId}
            />
            {state.status === "error" ? (
              <p role="alert" data-testid="person-invite-error" style={errorTextStyle}>
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
