/**
 * Invite tab — two modes that share the show-once flash-cookie pattern:
 *   1. "Invite a narrator to record" — a personal /s/[token] link that opens the narrator recording page
 *      (the link IS the identity; no login).
 *   2. "Invite a family member" — a /join/[token] link that creates an Account-backed membership via
 *      core.createInvitation. The raw token is shown ONCE via a separate flash cookie and never put
 *      in a URL query/redirect that could land in logs.
 *
 * Server component. When a flash cookie is present it renders that link once then a client effect
 * clears it; otherwise it renders the two forms.
 */
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createInvitation, listActiveFamiliesForPerson } from "@chronicle/core";
import { memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { designateAndCreateNarratorLink } from "@/lib/narrator-onboarding";
import { resolveInviteFamilyId } from "@/lib/invite-scope";
import { seedDesignatorFamily } from "@/lib/family-designator";
import type { FamilyFilter } from "@/lib/family-filter";
import { resolvePublicOrigin } from "@/lib/public-origin";
import {
  INVITE_FLASH_COOKIE,
  INVITE_FLASH_PATH,
  MEMBER_INVITE_FLASH_COOKIE,
  MEMBER_INVITE_FLASH_PATH,
} from "@/lib/invite-flash";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { FamilyDesignatorChips } from "../FamilyDesignatorChips";
import { CopyButton } from "./CopyButton";
import { ClearInviteFlash } from "./ClearInviteFlash";

async function origin(): Promise<string> {
  const h = await headers();
  // Prefer the configured public origin (APP_BASE_URL); fall back to request headers. In prod this
  // never emits a localhost link — resolvePublicOrigin throws if it can't determine a real origin.
  return resolvePublicOrigin({
    configuredBaseUrl: process.env.APP_BASE_URL,
    host: h.get("host"),
    forwardedProto: h.get("x-forwarded-proto"),
    isProduction: process.env.NODE_ENV === "production",
  });
}

async function createInvite(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
  const narratorId = String(formData.get("narratorId") ?? "");
  if (!narratorId) throw new Error("narrator required");
  // Server-side family-target guard (Finding 2): a crafted POST can omit familyId, which the browser
  // would otherwise have auto-filled with an arbitrary first family. Resolve it against the inviter's
  // OWN active families — refusing the ambiguous empty-with-several case — before touching the domain.
  const activeFamilyIds = (await listActiveFamiliesForPerson(db, ctx.personId)).map((f) => f.familyId);
  const familyId = resolveInviteFamilyId(String(formData.get("familyId") ?? ""), activeFamilyIds);

  // Designate the chosen member as this family's narrator AND mint the login-free capture link, in one
  // atomic step (issue #79). The membership gate (inviter AND narrator must be active members of this
  // family) is enforced transactionally inside the helper — the domain owns it. We don't re-check here.
  const { token } = await designateAndCreateNarratorLink(db, {
    inviterPersonId: ctx.personId,
    narratorPersonId: narratorId,
    familyId,
  });
  const jar = await cookies();
  jar.set(INVITE_FLASH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: INVITE_FLASH_PATH,
    maxAge: 60,
  });
  redirect("/hub?tab=invite");
}

async function createMemberInvite(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
  const inviteeName = String(formData.get("inviteeName") ?? "").trim();
  const inviteeEmail = String(formData.get("inviteeEmail") ?? "").trim();
  const relationshipLabel = String(formData.get("relationshipLabel") ?? "").trim();
  if (!inviteeName) throw new Error("name required");
  // Server-side family-target guard (Finding 2): resolve the single-family target against the inviter's
  // OWN active families so a crafted POST can't silently invite into an arbitrary first family.
  const activeFamilyIds = (await listActiveFamiliesForPerson(db, ctx.personId)).map((f) => f.familyId);
  const familyId = resolveInviteFamilyId(String(formData.get("familyId") ?? ""), activeFamilyIds);

  // createInvitation enforces the "inviter must be an active member" gate transactionally; no
  // redundant pre-check here.
  const { token } = await createInvitation(db, {
    familyId,
    inviterPersonId: ctx.personId,
    inviteeName,
    inviteeEmail: inviteeEmail || undefined,
    relationshipLabel: relationshipLabel || undefined,
  });
  const jar = await cookies();
  jar.set(MEMBER_INVITE_FLASH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: MEMBER_INVITE_FLASH_PATH,
    maxAge: 60,
  });
  redirect("/hub?tab=invite");
}

/** Shared show-once result card. */
function LinkResult({
  title,
  blurb,
  link,
  note,
}: {
  title: string;
  blurb: string;
  link: string;
  note: string;
}) {
  return (
    <div style={{ maxWidth: 600 }}>
      <ClearInviteFlash />
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
  const narratorToken = jar.get(INVITE_FLASH_COOKIE)?.value;
  const memberToken = jar.get(MEMBER_INVITE_FLASH_COOKIE)?.value;

  /* ── Narrator result (show-once) ────────────────────────────────────────────── */
  if (narratorToken) {
    const link = `${await origin()}/s/${narratorToken}`;
    return (
      <LinkResult
        title={hub.invite.narratorReadyTitle}
        blurb={hub.invite.narratorReadyBlurb}
        link={link}
        note={hub.invite.fingerprintNote}
      />
    );
  }

  /* ── Member result (show-once) ───────────────────────────────────────────── */
  if (memberToken) {
    const link = `${await origin()}/join/${memberToken}`;
    return (
      <LinkResult
        title={hub.invite.memberReadyTitle}
        blurb={hub.invite.memberReadyBlurb}
        link={link}
        note={hub.invite.fingerprintNote}
      />
    );
  }

  /* ── Form view ────────────────────────────────────────────────────────────── */
  const { db, auth } = await getRuntime();
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
  // authoritative list); the candidate-PEOPLE query below still reads the DB, but the family set is
  // driven by the prop so the designator and the pending-empty guard never drift from page.tsx.
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

  const candidateRows = familyIds.length
    ? await db
        .select({ id: persons.id, displayName: persons.displayName })
        .from(memberships)
        .innerJoin(persons, eq(persons.id, memberships.personId))
        .where(
          and(
            inArray(memberships.familyId, familyIds),
            eq(memberships.status, "active"),
            ne(persons.id, ctx.personId),
          ),
        )
    : [];
  const seen = new Set<string>();
  const allPeople = candidateRows.filter((p) =>
    seen.has(p.id) ? false : (seen.add(p.id), true),
  );

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
    <div style={{ maxWidth: 600, display: "grid", gap: 44 }}>
      {/* Member invite */}
      <section>
        <h2 style={sectionTitle}>{hub.invite.memberHeading}</h2>
        <p style={sectionBlurb}>
          {hub.invite.memberBody}
        </p>
        <form action={createMemberInvite} style={{ display: "grid", gap: 20 }}>
          <label className="kin-form-label">
            {hub.invite.nameLabel}
            <input
              name="inviteeName"
              type="text"
              required
              className="kin-field"
              placeholder={hub.invite.namePlaceholder}
              // Slice D (#6): pre-filled when the tree's Invite affordance deep-links here with a
              // person's name (`?inviteeName=`). Still editable; the form posts to createInvitation.
              defaultValue={inviteeName?.trim() || undefined}
            />
          </label>
          <label className="kin-form-label">
            {hub.invite.emailLabel} <span style={{ fontWeight: 400 }}>{hub.invite.emailLabelOptional}</span>
            <input
              name="inviteeEmail"
              type="email"
              className="kin-field"
              placeholder={hub.invite.emailPlaceholder}
            />
          </label>
          <label className="kin-form-label">
            {hub.invite.relationshipLabel} <span style={{ fontWeight: 400 }}>{hub.invite.relationshipLabelOptional}</span>
            <input
              name="relationshipLabel"
              type="text"
              className="kin-field"
              placeholder={hub.invite.relationshipPlaceholder}
            />
          </label>
          <FamilyDesignatorChips
            families={designatorFamilies}
            seeded={seededFamily}
            name="familyId"
            label={hub.invite.familyLabel}
            requiredMessage={hub.invite.familyRequired}
          />
          <KindredButton type="submit" label={hub.invite.createInviteLink} />
        </form>
      </section>

      <hr className="kin-divider" />

      {/* Narrator invite */}
      <section>
        <h2 style={sectionTitle}>{hub.invite.narratorHeading}</h2>
        <p style={sectionBlurb}>
          {hub.invite.narratorBody}
        </p>
        <form action={createInvite} style={{ display: "grid", gap: 20 }}>
          <label className="kin-form-label">
            {hub.invite.narratorLabel}
            <select name="narratorId" className="kin-field" required>
              {allPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          <FamilyDesignatorChips
            families={designatorFamilies}
            seeded={seededFamily}
            name="familyId"
            label={hub.invite.familyLabel}
            requiredMessage={hub.invite.familyRequired}
          />
          <KindredButton type="submit" label={hub.invite.createLink} />
        </form>
      </section>
    </div>
  );
}
