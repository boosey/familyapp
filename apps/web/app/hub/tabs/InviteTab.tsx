/**
 * Invite tab — invite a family member via a /join/[token] link that creates an Account-backed
 * membership through core.createInvitation. The raw token is shown ONCE via a flash cookie and
 * never put in a URL query/redirect that could land in logs.
 *
 * Server component. When a flash cookie is present it renders that link once then a client effect
 * clears it; otherwise it renders the member-invite form.
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createInvitation, listActiveFamiliesForPerson, AlreadyFamilyMemberError, ThrottleError } from "@chronicle/core";
import { normalizePhone } from "@chronicle/notifications";
import { getRuntime } from "@/lib/runtime";
import { resolveInviteFamilyId } from "@/lib/invite-scope";
import { seedDesignatorFamily } from "@/lib/family-designator";
import { parseInviteIntent, planInviteChannels } from "@/lib/invite-delivery-channels";
import { parseInviteRelationship } from "@/lib/invite-relationship";
import { resolveInviteOrigin } from "@/lib/invite-origin";
import type { FamilyFilter } from "@/lib/family-filter";
import {
  MEMBER_INVITE_FLASH_COOKIE,
  MEMBER_INVITE_FLASH_PATH,
  MEMBER_INVITE_TARGETS_FLASH_COOKIE,
  MEMBER_INVITE_TARGETS_FLASH_PATH,
} from "@/lib/invite-flash";
import { hub } from "@/app/_copy";
import { MemberInviteForm } from "./MemberInviteForm";
import { CopyButton } from "./CopyButton";
import { ClearInviteFlash } from "./ClearInviteFlash";

async function createMemberInvite(formData: FormData): Promise<void> {
  "use server";
  const rt = await getRuntime();
  const { db, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
  const inviteeName = String(formData.get("inviteeName") ?? "").trim();
  const inviteeEmail = String(formData.get("inviteeEmail") ?? "").trim();
  const inviteePhoneRaw = String(formData.get("inviteePhone") ?? "").trim();
  // #164 (ADR-0023): the STRUCTURED relationship picker drives tree placement. Validate against the
  // fixed vocabulary server-side (a crafted POST can send anything); an unknown value falls back to
  // "other" — the safe no-auto-placement outcome, never a guessed edge.
  const relationship = parseInviteRelationship(String(formData.get("relationship") ?? ""));
  // Derive the free-text display label the welcome screen shows from the pick (display only, editable
  // there). "other" carries no derived label — the invitee can type their own.
  const relationshipLabel =
    relationship === "other" ? "" : hub.invite.relationshipDisplayLabels[relationship];
  const intent = parseInviteIntent(String(formData.get("intent") ?? ""));
  if (!inviteeName) throw new Error("name required");
  // A typed-but-invalid phone must never silently become "no phone" — reject BEFORE creating the
  // invite so the inviter can fix it (no orphaned invitation left behind for a typo'd number).
  const normalizedPhone = inviteePhoneRaw ? normalizePhone(inviteePhoneRaw) : null;
  if (inviteePhoneRaw && normalizedPhone === null) {
    throw new Error(hub.invite.phoneInvalid);
  }
  // #118: at least one identifier is required for EVERY action (even "Get link") — identifiers
  // power dedup (#117) and the surface-and-confirm reconciliation (#120).
  if (!inviteeEmail && !normalizedPhone) {
    throw new Error(hub.invite.identifierRequired);
  }
  // The clicked action must match the contacts entered (Send-to-email needs an email, etc.).
  const plan = planInviteChannels(intent, {
    email: inviteeEmail || null,
    normalizedPhone,
  });
  if (!plan.ok) {
    throw new Error(
      plan.reason === "email_required"
        ? hub.invite.emailRequired
        : hub.invite.phoneRequired,
    );
  }
  const channels = plan.channels;
  // Server-side family-target guard (Finding 2): resolve the single-family target against the inviter's
  // OWN active families so a crafted POST can't silently invite into an arbitrary first family.
  const activeFamilyIds = (await listActiveFamiliesForPerson(db, ctx.personId)).map((f) => f.familyId);
  const familyId = resolveInviteFamilyId(String(formData.get("familyId") ?? ""), activeFamilyIds);

  // createInvitation enforces the "inviter must be an active member" gate transactionally; no
  // redundant pre-check here. It also enforces the generous invite-send throttle (#105): a
  // ThrottleError means the inviter (or this destination) hit the accident ceiling, so we reject
  // BEFORE any delivery is enqueued and surface a plain-language message — nothing is written.
  // The #119 duplicate-member guard surfaces as a "they're already in" message the same way.
  let invitationId: string;
  let token: string;
  try {
    ({ invitationId, token } = await createInvitation(db, {
      familyId,
      inviterPersonId: ctx.personId,
      inviteeName,
      inviteeEmail: inviteeEmail || undefined,
      inviteePhone: normalizedPhone ?? undefined,
      deliveryChannels: channels.length ? channels : undefined,
      relationshipLabel: relationshipLabel || undefined,
      relationship,
    }));
  } catch (err) {
    if (err instanceof ThrottleError) {
      throw new Error(hub.invite.throttled);
    }
    if (err instanceof AlreadyFamilyMemberError) {
      throw new Error(hub.invite.alreadyMember);
    }
    throw err;
  }

  if (channels.length) {
    try {
      // Only the invitation id + channels cross this seam — the raw token never transits the
      // Inngest event payload; both delivery paths recover it server-side (#115 review).
      await rt.dispatchInviteDelivery({
        invitationId,
        channels,
      });
    } catch (err) {
      // Delivery dispatch must NEVER block invite creation or the copy-link fallback — the
      // show-once link below is always available regardless of whether email/SMS went out.
      // eslint-disable-next-line no-console
      console.error("[chronicle] invite delivery dispatch failed", err);
    }
  }

  const jar = await cookies();
  jar.set(MEMBER_INVITE_FLASH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: MEMBER_INVITE_FLASH_PATH,
    maxAge: 60,
  });

  if (channels.length) {
    // Human-readable destinations only (never the token) — a short-lived flash so the result view
    // can render an honest "sending" line without a DB round-trip. Absent entirely for a pure
    // copy-link invite (no contact given / no consent), so that path never falsely implies delivery.
    const targets = [
      channels.includes("email") && inviteeEmail ? inviteeEmail : null,
      channels.includes("sms") && normalizedPhone ? normalizedPhone : null,
    ].filter((t): t is string => Boolean(t));
    jar.set(MEMBER_INVITE_TARGETS_FLASH_COOKIE, targets.join(", "), {
      httpOnly: true,
      sameSite: "lax",
      path: MEMBER_INVITE_TARGETS_FLASH_PATH,
      maxAge: 60,
    });
  }

  redirect("/hub?tab=invite");
}

/** Shared show-once result card. */
function LinkResult({
  title,
  blurb,
  link,
  note,
  sendingTo,
}: {
  title: string;
  blurb: string;
  link: string;
  note: string;
  /** Task 9 — optional "Sending your invitation to …" status line, sourced purely from a flash
   * cookie (no DB read). Rendered above the copy-link card, which remains the guaranteed fallback. */
  sendingTo?: string;
}) {
  return (
    <div style={{ maxWidth: 600 }}>
      <ClearInviteFlash />
      {sendingTo ? (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: "0 0 16px",
          }}
        >
          {hub.invite.sendingTo(sendingTo)}
        </p>
      ) : null}
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: "0 0 8px",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-meta)",
          margin: "0 0 24px",
        }}
      >
        {blurb}
      </p>

      <div
        style={{
          background: "var(--surface-card)",
          border: "var(--border-width) solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-card)",
          padding: "24px 26px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            letterSpacing: "var(--tracking-mono)",
            textTransform: "uppercase",
            color: "var(--support)",
          }}
        >
          {hub.invite.personalLinkOnce}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
          <code
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-body)",
              background: "var(--surface-sunken)",
              border: "var(--border-width) solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "14px 16px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {link}
          </code>
          <CopyButton value={link} />
        </div>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            lineHeight: "var(--leading-body)",
            color: "var(--text-muted)",
            margin: "18px 0 0",
          }}
        >
          {note}
        </p>
      </div>
    </div>
  );
}

export async function InviteTab({
  families: designatorFamilies,
  filter,
  inviteeName,
}: {
  /** ALL the viewer's active families — the designator's option set (ADR-0021, #49). */
  families: { id: string; name: string; shortName?: string | null }[];
  /** The current browse filter the designator SEEDS from (never written back). */
  filter: FamilyFilter;
  inviteeName?: string;
}) {
  const jar = await cookies();
  const memberToken = jar.get(MEMBER_INVITE_FLASH_COOKIE)?.value;

  /* ── Member result (show-once) ───────────────────────────────────────────── */
  if (memberToken) {
    const link = `${await resolveInviteOrigin()}/join/${memberToken}`;
    const sendingTo = jar.get(MEMBER_INVITE_TARGETS_FLASH_COOKIE)?.value;
    return (
      <LinkResult
        title={hub.invite.memberReadyTitle}
        blurb={hub.invite.memberReadyBlurb}
        link={link}
        note={hub.invite.fingerprintNote}
        sendingTo={sendingTo || undefined}
      />
    );
  }

  /* ── Form view ────────────────────────────────────────────────────────────── */
  const { auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind !== "account") {
    return (
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-muted)",
        }}
      >
        {hub.invite.signedOut}
      </p>
    );
  }

  // The DESIGNATOR's option set is the passed `families` prop (the viewer's active families, the
  // authoritative list) so the designator and the pending-empty guard never drift from page.tsx.
  const familyIds = designatorFamilies.map((f) => f.id);
  const seededFamily = seedDesignatorFamily(filter, familyIds);

  // Pending-only viewer guard (Finding 1). Invite is a member-only affordance — you invite people INTO
  // a family you belong to. A viewer who belongs to no family has nothing to invite into; rendering the
  // form would produce a broken zero-option family designator. Reaching /hub?tab=invite directly must
  // instead show the shared pending-only empty copy, mirroring StoriesTab/AsksTab. page.tsx also hides
  // the tab and gates this dispatch, so this is a robust second line, not the only one.
  if (designatorFamilies.length === 0) {
    return (
      <div
        style={{
          background: "var(--surface-card)",
          border: "var(--border-width) solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 30,
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story)",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          {hub.shell.pendingEmpty}
        </p>
      </div>
    );
  }

  const sectionTitle: React.CSSProperties = {
    fontFamily: "var(--font-story)",
    fontSize: "var(--text-story-lg)",
    fontWeight: 500,
    color: "var(--text-body)",
    margin: "0 0 8px",
  };
  const sectionBlurb: React.CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    color: "var(--text-meta)",
    margin: "0 0 22px",
    lineHeight: "var(--leading-body)",
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <section>
        <h2 style={sectionTitle}>{hub.invite.memberHeading}</h2>
        <p style={sectionBlurb}>
          {hub.invite.memberBody}
        </p>
        <MemberInviteForm
          action={createMemberInvite}
          families={designatorFamilies}
          seededFamily={seededFamily}
          defaultName={inviteeName?.trim() || undefined}
        />
      </section>
    </div>
  );
}
