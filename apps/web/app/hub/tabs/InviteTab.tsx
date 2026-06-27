/**
 * Invite tab — generate an elder invite link.
 * Server component. When the flash cookie is present (set by createInvite), shows the link ONCE
 * then clears the cookie. When absent, shows the form. This preserves the show-once guarantee
 * within the tab without a separate result page.
 */
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createElderSession } from "@chronicle/capture";
import { families, memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { KindredButton, KindredPromptCard } from "@/app/_kindred";

const FLASH_COOKIE = "chronicle_flash_invite_token";

async function createInvite(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");
  const elderId = String(formData.get("elderId") ?? "");
  const familyId = String(formData.get("familyId") ?? "");
  if (!elderId || !familyId) throw new Error("elder and family required");

  const inviterFams = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(and(eq(memberships.personId, ctx.personId), eq(memberships.status, "active")));
  if (!inviterFams.some((r) => r.familyId === familyId)) {
    throw new Error("you are not an active member of that family");
  }

  const [elderHere] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, elderId),
        eq(memberships.familyId, familyId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  if (!elderHere) throw new Error("that person is not an active member of that family");

  const { token } = await createElderSession(db, {
    personId: elderId,
    familyId,
    invitedByPersonId: ctx.personId,
  });
  const jar = await cookies();
  jar.set(FLASH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/hub",
    maxAge: 60,
  });
  redirect("/hub?tab=invite");
}

export async function InviteTab() {
  const jar = await cookies();
  const token = jar.get(FLASH_COOKIE)?.value;
  if (token) jar.delete(FLASH_COOKIE);

  /* ── Result view (show-once) ─────────────────────────────────────────────── */
  if (token) {
    const h = await headers();
    const host = h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    const link = `${proto}://${host}/s/${token}`;

    return (
      <div style={{ maxWidth: 600 }}>
        <h2
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story-lg)",
            fontWeight: 500,
            color: "var(--text-body)",
            margin: "0 0 8px",
          }}
        >
          Link is ready
        </h2>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-meta)",
            margin: "0 0 24px",
          }}
        >
          Send this to your elder however you usually talk — text or email. Tapping it opens their
          recording page directly. There is no password.
        </p>

        <div style={{ marginBottom: 18 }}>
          <KindredPromptCard
            eyebrow="The link (shown once)"
            question={
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-ui)",
                  wordBreak: "break-all",
                  color: "var(--text-body)",
                }}
              >
                {link}
              </code>
            }
          />
        </div>

        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          This page shows the link only once. Save it now if you need to send it later — switching
          tabs or refreshing will clear it.
        </p>
      </div>
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
        Sign in to invite an elder.
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

  return (
    <div style={{ maxWidth: 600 }}>
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: "0 0 8px",
        }}
      >
        Invite an elder
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-meta)",
          margin: "0 0 28px",
        }}
      >
        Creates a personal link that opens the elder&apos;s recording page. No login, no account — the
        link is the identity.
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
            {inviterFams.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <KindredButton type="submit" label="Create link" />
      </form>
    </div>
  );
}
