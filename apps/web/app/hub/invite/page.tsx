/**
 * Invite-link generator. Creates a session token (the elder's identity for the session) and shows
 * the link via the result page. The token is shown ONCE — only its hash is persisted, so the link
 * cannot be regenerated from the DB.
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createElderSession } from "@chronicle/capture";
import { families, memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { KindredButton } from "@/app/_kindred";

const FLASH_COOKIE = "chronicle_flash_invite_token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function createInvite(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    throw new Error("must be signed in");
  }
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
  if (!elderHere) {
    throw new Error("that person is not an active member of that family");
  }

  const { token } = await createElderSession(db, {
    personId: elderId,
    familyId,
    invitedByPersonId: ctx.personId,
  });
  const jar = await cookies();
  jar.set(FLASH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/hub/invite/result",
    maxAge: 60,
  });
  redirect("/hub/invite/result");
}

export default async function InvitePage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return (
      <main className="kin-page">
        <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
          <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>Sign in to invite</h1>
          <Link href="/dev/sign-in" style={{ textDecoration: "none", display: "inline-block", maxWidth: 240, marginTop: 24 }}>
            <KindredButton label="Dev sign-in" />
          </Link>
        </div>
      </main>
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
  const allPeople = candidateRows.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));

  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
        <Link href="/hub" style={{ fontSize: 15, fontWeight: 600, color: "var(--kin-ink-2)", textDecoration: "none" }}>
          ‹ Back to hub
        </Link>
        <h1 style={{ fontSize: "var(--kin-text-title)", margin: "16px 0 8px" }}>Invite an elder</h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--kin-text-h3)", margin: 0 }}>
          Creates a personal link that opens the elder's recording page. No login, no account — the
          link is the identity.
        </p>

        <form action={createInvite} style={{ display: "grid", gap: 20, marginTop: 28 }}>
          <label className="kin-form-label">
            Elder
            <select name="elderId" className="kin-field" required>
              {allPeople.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </label>
          <label className="kin-form-label">
            Family
            <select name="familyId" className="kin-field" required>
              {inviterFams.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          <KindredButton type="submit" label="Create link" />
        </form>
      </div>
    </main>
  );
}
