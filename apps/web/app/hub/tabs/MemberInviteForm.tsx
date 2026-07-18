"use client";

/**
 * Member-invite form (issue #118) — name (required) plus email and/or phone (at least one
 * required), with THREE send actions: "Send to email", "Send to phone", "Get link". Buttons
 * enable/disable contextually from the fields actually filled (Send-to-phone needs a phone,
 * etc.); the server action re-validates everything, so a crafted POST is still safe.
 *
 * Client component: the contextual enable/disable needs live field state. The submit rides the
 * native form POST to the passed server action (`intent` distinguishes the three buttons).
 */
import { useState } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { FamilyDesignatorChips } from "../FamilyDesignatorChips";

export function MemberInviteForm({
  action,
  families,
  seededFamily,
  defaultName,
}: {
  /** The server action (createMemberInvite in InviteTab). */
  action: (formData: FormData) => Promise<void>;
  /** ALL the viewer's active families — the designator's option set. */
  families: { id: string; name: string; shortName?: string | null }[];
  /** The family the designator seeds from the current browse filter (null = user must pick). */
  seededFamily: string | null;
  /** Pre-filled name when deep-linked from the tree's Invite affordance. */
  defaultName?: string;
}) {
  const [name, setName] = useState(defaultName ?? "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const hasEmail = email.trim().length > 0;
  const hasPhone = phone.trim().length > 0;
  const hasIdentifier = hasEmail || hasPhone;

  return (
    <form action={action} style={{ display: "grid", gap: 20 }}>
      <label className="kin-form-label">
        {hub.invite.nameLabel}
        <input
          name="inviteeName"
          type="text"
          required
          className="kin-field"
          placeholder={hub.invite.namePlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="kin-form-label">
        {hub.invite.emailLabel}
        <input
          name="inviteeEmail"
          type="email"
          className="kin-field"
          placeholder={hub.invite.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="kin-form-label">
        {hub.invite.phoneLabel}
        <input
          name="inviteePhone"
          type="tel"
          className="kin-field"
          placeholder={hub.invite.phonePlaceholder}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-label)",
          lineHeight: "var(--leading-body)",
          color: "var(--text-muted)",
          margin: "-8px 0 0",
        }}
      >
        {hub.invite.identifierHint}
      </p>
      <label className="kin-form-label">
        {hub.invite.relationshipQuestion}
        <select name="relationship" className="kin-field" defaultValue="other">
          {(
            Object.keys(hub.invite.relationshipOptions) as (keyof typeof hub.invite.relationshipOptions)[]
          ).map((value) => (
            <option key={value} value={value}>
              {hub.invite.relationshipOptions[value]}
            </option>
          ))}
        </select>
      </label>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-label)",
          lineHeight: "var(--leading-body)",
          color: "var(--text-muted)",
          margin: "-8px 0 0",
        }}
      >
        {hub.invite.relationshipHelp}
      </p>
      <FamilyDesignatorChips
        families={families}
        seeded={seededFamily}
        name="familyId"
        label={hub.invite.familyLabel}
        requiredMessage={hub.invite.familyRequired}
      />
      <div style={{ display: "grid", gap: 12 }}>
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
