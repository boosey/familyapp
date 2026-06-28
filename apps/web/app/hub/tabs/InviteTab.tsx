/**
 * Invite tab — two modes that share the show-once flash-cookie pattern:
 *   1. "Invite an elder to record" — a personal /s/[token] link that opens the elder recording page
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
import { createElderSession } from "@chronicle/capture";
import { createInvitation } from "@chronicle/core";
import { families, memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import {
  INVITE_FLASH_COOKIE,
  INVITE_FLASH_PATH,
  MEMBER_INVITE_FLASH_COOKIE,
  MEMBER_INVITE_FLASH_PATH,
} from "@/lib/invite-flash";
import { KindredButton } from "@/app/_kindred";
import { CopyButton } from "./CopyButton";
import { ClearInviteFlash } from "./ClearInviteFlash";

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

async function createInvite(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
  const elderId = String(formData.get("elderId") ?? "");
  const familyId = String(formData.get("familyId") ?? "");
  if (!elderId || !familyId) throw new Error("elder and family required");

  // The membership gate (inviter AND elder must be active members of this family) is enforced
  // inside createElderSession — the domain owns it, transactionally. We don't re-check here.
  const { token } = await createElderSession(db, {
    personId: elderId,
    familyId,
    invitedByPersonId: ctx.personId,
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
  const familyId = String(formData.get("familyId") ?? "");
  if (!inviteeName || !familyId) throw new Error("name and family required");

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
          Personal link — shown once
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

export async function InviteTab() {
  const jar = await cookies();
  const elderToken = jar.get(INVITE_FLASH_COOKIE)?.value;
  const memberToken = jar.get(MEMBER_INVITE_FLASH_COOKIE)?.value;

  /* ── Elder result (show-once) ────────────────────────────────────────────── */
  if (elderToken) {
    const link = `${await origin()}/s/${elderToken}`;
    return (
      <LinkResult
        title="Link is ready"
        blurb="Send this to your elder however you usually talk — text or email. Tapping it opens their recording page directly. There is no password."
        link={link}
        note="For safety we keep only a fingerprint — you won't see this link again. Save it now if you need to send it later; switching tabs or refreshing will clear it."
      />
    );
  }

  /* ── Member result (show-once) ───────────────────────────────────────────── */
  if (memberToken) {
    const link = `${await origin()}/join/${memberToken}`;
    return (
      <LinkResult
        title="Invitation link is ready"
        blurb="Send this to your relative. Opening it lets them create a login and join your family — you don't have to set anything up for them."
        link={link}
        note="For safety we keep only a fingerprint — you won't see this link again. Save it now if you need to send it later; switching tabs or refreshing will clear it."
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
        Sign in to invite someone.
      </p>
    );
  }

  const inviterFams = await db
    .select({ id: families.id, name: families.name })
    .from(memberships)
    .innerJoin(families, eq(families.id, memberships.familyId))
    .where(and(eq(memberships.personId, ctx.personId), eq(memberships.status, "active")));
  const familyIds = inviterFams.map((f) => f.id);
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

  const familyOptions = inviterFams.map((f) => (
    <option key={f.id} value={f.id}>
      {f.name}
    </option>
  ));

  return (
    <div style={{ maxWidth: 600, display: "grid", gap: 44 }}>
      {/* Member invite */}
      <section>
        <h2 style={sectionTitle}>Invite a family member</h2>
        <p style={sectionBlurb}>
          Send a relative a link to create their own login and join the family. They&apos;ll confirm
          who they are, then go through a short welcome.
        </p>
        <form action={createMemberInvite} style={{ display: "grid", gap: 20 }}>
          <label className="kin-form-label">
            Their name
            <input
              name="inviteeName"
              type="text"
              required
              className="kin-field"
              placeholder="e.g. Rosa Esposito"
            />
          </label>
          <label className="kin-form-label">
            Their email <span style={{ fontWeight: 400 }}>(optional)</span>
            <input
              name="inviteeEmail"
              type="email"
              className="kin-field"
              placeholder="rosa@example.com"
            />
          </label>
          <label className="kin-form-label">
            Relationship <span style={{ fontWeight: 400 }}>(optional)</span>
            <input
              name="relationshipLabel"
              type="text"
              className="kin-field"
              placeholder="e.g. your cousin"
            />
          </label>
          <label className="kin-form-label">
            Family
            <select name="familyId" className="kin-field" required>
              {familyOptions}
            </select>
          </label>
          <KindredButton type="submit" label="Create invite link" />
        </form>
      </section>

      <hr className="kin-divider" />

      {/* Elder invite */}
      <section>
        <h2 style={sectionTitle}>Invite an elder to record</h2>
        <p style={sectionBlurb}>
          Creates a personal link that opens the elder&apos;s recording page. No login, no account —
          the link is the identity.
        </p>
        <form action={createInvite} style={{ display: "grid", gap: 20 }}>
          <label className="kin-form-label">
            Elder
            <select name="elderId" className="kin-field" required>
              {allPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="kin-form-label">
            Family
            <select name="familyId" className="kin-field" required>
              {familyOptions}
            </select>
          </label>
          <KindredButton type="submit" label="Create link" />
        </form>
      </section>
    </div>
  );
}
