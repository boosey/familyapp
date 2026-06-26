/**
 * Invite-link generator. Creates a session token (the elder's identity for the session) and shows
 * the link to send via SMS / email. The token is shown ONCE — only its hash is persisted, so the
 * link cannot be regenerated from the DB.
 *
 * Phase 1 simplification: the inviter picks an existing Person + Family by dropdown. A full UX
 * (create-the-elder-by-name flow) is a hub iteration; nothing in the data model would change.
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createElderSession } from "@chronicle/capture";
import { families, memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";

/** Short-lived httpOnly cookie used to hand off the freshly-minted token to the result page
 *  WITHOUT putting it in the URL (where it would leak via server logs, browser history, and the
 *  Referer header on any outbound click). The result page reads it once and clears it. */
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

  // Defense in depth: the inviter must hold an ACTIVE membership in the chosen family. Without
  // this, a stranger — or a paused/ended ex-member (spec Part II: divorce ends a membership,
  // estrangement pauses one; status is an input to EVERY permission check) — could mint links
  // for elders they no longer have a relationship to.
  const inviterFams = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, ctx.personId),
        eq(memberships.status, "active"),
      ),
    );
  if (!inviterFams.some((r) => r.familyId === familyId)) {
    throw new Error("you are not an active member of that family");
  }

  // The chosen elder MUST hold an active membership in the chosen family. Without this check, a
  // signed-in account could mint a session token binding an arbitrary Person to a Family the
  // elder is not actually in — exactly the kind of cross-family identity confusion the
  // Person/Membership split exists to prevent (spec Part II).
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
  // Hand the raw token to the result page via a short-lived httpOnly cookie — NEVER via a URL
  // query string (which would leak the secret into server logs, browser history, and the
  // Referer header on outbound clicks). DB stores only the sha-256 hash.
  const jar = await cookies();
  jar.set(FLASH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/hub/invite/result",
    maxAge: 60, // one minute: the inviter views the link and copies it; then it is gone.
  });
  redirect("/hub/invite/result");
}

export default async function InvitePage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return (
      <main className="screen">
        <p>You need to <Link href="/dev/sign-in">sign in</Link>.</p>
      </main>
    );
  }
  const inviterFams = await db
    .select({ id: families.id, name: families.name })
    .from(memberships)
    .innerJoin(families, eq(families.id, memberships.familyId))
    .where(
      and(
        eq(memberships.personId, ctx.personId),
        eq(memberships.status, "active"),
      ),
    );
  // Candidate elders: only other active members of the inviter's active families. The server
  // action re-enforces this; the UI just stays honest. (Strangers were never offered.)
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
  const allPeople = candidateRows.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return (
    <main className="screen">
      <h1>Invite an elder</h1>
      <p className="subtle">
        Creates a personal link that opens the elder's recording page. No login,
        no account — the link IS the identity.
      </p>
      <form action={createInvite} style={{ display: "grid", gap: "1rem" }}>
        <label>
          Elder
          <select name="elderId" required>
            {allPeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Family
          <select name="familyId" required>
            {inviterFams.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Create link</button>
      </form>
      <p style={{ marginTop: "1rem" }}>
        <Link href="/hub">Back to hub</Link>
      </p>
    </main>
  );
}
