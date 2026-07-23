"use client";

/**
 * Member-invite form (issue #118 / #334) — ONE chrome for the cold Invite tab and the person-bound
 * modal (List/Tree). Shared layout: placeholder hints (no field labels), compact `.kin-field` /
 * `.kin-locked`, InfoTooltip for the contact + relationship help copy, family chips, three send
 * actions. The ONLY path difference is which values are editable:
 *
 *   - Cold Invite (no `existingInviteePersonId`): name, email, phone, relationship all editable.
 *   - Person-bound: name is always display-only; if either contact arrived prefilled, BOTH email and
 *     phone are display-only; relationship stays editable.
 *
 * Buttons enable/disable from live field state; the server action re-validates. Submit rides the
 * native form POST (`intent` distinguishes the three buttons).
 */
import { useState } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { FamilyDesignatorChips } from "../FamilyDesignatorChips";
import { InfoTooltip } from "../InfoTooltip";
import styles from "./MemberInviteForm.module.css";

function LockedValue({
  name,
  value,
  testId,
}: {
  name: string;
  value: string;
  testId: string;
}) {
  const empty = value.trim().length === 0;
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <div
        className="kin-locked"
        data-testid={testId}
        data-empty={empty ? "true" : undefined}
      >
        {empty ? "—" : value}
      </div>
    </>
  );
}

export function MemberInviteForm({
  action,
  families,
  seededFamily,
  defaultName,
  defaultEmail,
  defaultPhone,
  existingInviteePersonId,
}: {
  /**
   * The server action. The cold Invite tab (`InviteTab.tsx`) binds its void-returning
   * `createMemberInvite` directly as the native form `action`; the person-bound Invite modal
   * (#334) instead binds the DISPATCH function `useActionState` returns (so the modal can read a
   * result back in place, no redirect) — both shapes satisfy `<form action={…}>`.
   */
  action: (formData: FormData) => void | Promise<void>;
  /** ALL the viewer's active families — the designator's option set. */
  families: { id: string; name: string; shortName?: string | null }[];
  /** The family the designator seeds from the current browse filter (null = user must pick). */
  seededFamily: string | null;
  /** Pre-filled name (cold deep-link or person-bound modal). */
  defaultName?: string;
  /** #334 — best-effort email/phone prefill for the person-bound modal. MODAL-ONLY state: this never
   *  writes back to the Person's own record, it only seeds the form fields for this one send. */
  defaultEmail?: string;
  defaultPhone?: string;
  /**
   * #334/#333 — when set, this invite is PERSON-BOUND: it anchors on this EXISTING Person instead of
   * minting a fresh provisional one. Carried as a hidden field; the cold Invite tab never sets this.
   */
  existingInviteePersonId?: string;
}) {
  const personBound = Boolean(existingInviteePersonId);
  const [name, setName] = useState(defaultName ?? "");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [phone, setPhone] = useState(defaultPhone ?? "");

  const lockName = personBound;
  // Person-bound: if either contact arrived prefilled, lock BOTH (display-only, not inputs).
  const lockContacts =
    personBound && ((defaultEmail ?? "").trim().length > 0 || (defaultPhone ?? "").trim().length > 0);

  const hasEmail = email.trim().length > 0;
  const hasPhone = phone.trim().length > 0;
  const hasIdentifier = hasEmail || hasPhone;

  const relationshipOptions = (
    Object.keys(hub.invite.relationshipOptions) as (keyof typeof hub.invite.relationshipOptions)[]
  ).map((value) => (
    <option key={value} value={value}>
      {hub.invite.relationshipOptions[value]}
    </option>
  ));

  return (
    <form action={action} className={styles.root}>
      {existingInviteePersonId && (
        <input type="hidden" name="existingInviteePersonId" value={existingInviteePersonId} />
      )}

      {lockName ? (
        <LockedValue name="inviteeName" value={name} testId="invite-name-locked" />
      ) : (
        <input
          name="inviteeName"
          type="text"
          required
          className="kin-field"
          placeholder={hub.invite.namePlaceholder}
          aria-label={hub.invite.nameLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="invite-name"
        />
      )}

      {lockContacts ? (
        <>
          <LockedValue name="inviteeEmail" value={email} testId="invite-email-locked" />
          <LockedValue name="inviteePhone" value={phone} testId="invite-phone-locked" />
        </>
      ) : (
        <div className={styles.fieldWithInfo}>
          <div className={styles.contactStack}>
            <input
              name="inviteeEmail"
              type="email"
              className="kin-field"
              placeholder={hub.invite.emailPlaceholder}
              aria-label={hub.invite.emailLabel}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="invite-email"
            />
            <input
              name="inviteePhone"
              type="tel"
              className="kin-field"
              placeholder={hub.invite.phonePlaceholder}
              aria-label={hub.invite.phoneLabel}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-testid="invite-phone"
            />
          </div>
          <InfoTooltip label={hub.invite.identifierInfoAria} text={hub.invite.identifierHint} />
        </div>
      )}

      <div className={styles.fieldWithInfo}>
        <select
          name="relationship"
          className="kin-field"
          defaultValue=""
          required
          aria-label={hub.invite.relationshipQuestion}
          data-testid="invite-relationship"
        >
          <option value="" disabled>
            {hub.invite.relationshipQuestion}
          </option>
          {relationshipOptions}
        </select>
        <InfoTooltip label={hub.invite.relationshipInfoAria} text={hub.invite.relationshipHelp} />
      </div>

      <FamilyDesignatorChips
        families={families}
        seeded={seededFamily}
        name="familyId"
        label={hub.invite.familyLabel}
        requiredMessage={hub.invite.familyRequired}
      />
      <div className={styles.actions}>
        <KindredButton
          type="submit"
          name="intent"
          value="send_email"
          label={hub.invite.sendToEmail}
          disabled={!hasEmail}
          size="small"
        />
        <KindredButton
          type="submit"
          name="intent"
          value="send_phone"
          label={hub.invite.sendToPhone}
          disabled={!hasPhone}
          variant="secondary"
          size="small"
        />
        <KindredButton
          type="submit"
          name="intent"
          value="get_link"
          label={hub.invite.getLink}
          disabled={!hasIdentifier}
          variant="ghost"
          size="small"
        />
      </div>
    </form>
  );
}
