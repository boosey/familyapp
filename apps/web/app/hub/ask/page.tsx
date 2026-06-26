/**
 * Ask submission — a younger family member's question for an elder. The Ask is `queued`
 * immediately and never interrupts the elder; Increment 7's interviewer pulls it on the next
 * gentle session, frames it warmly with the asker named, and on approval flips it to `answered`.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createAsk } from "@chronicle/core";
import { memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function submitAsk(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");
  const targetPersonId = String(formData.get("targetPersonId") ?? "");
  const questionText = String(formData.get("questionText") ?? "");
  await createAsk(db, ctx, { targetPersonId, questionText });
  redirect("/hub?asked=1");
}

export default async function AskPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return (
      <main className="screen">
        <p>You need to <Link href="/dev/sign-in">sign in</Link>.</p>
      </main>
    );
  }
  // Show only Persons the viewer actually shares an active family with — same rule createAsk
  // will enforce at submit time. Keeps the dropdown honest. Two narrow queries (viewer's
  // active families, then other active members of those families) + app-side dedupe.
  const viewerFams = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, ctx.personId),
        eq(memberships.status, "active"),
      ),
    );
  const familyIds = viewerFams.map((r) => r.familyId);
  const rawCandidates = familyIds.length
    ? await db
        .select({
          id: persons.id,
          displayName: persons.displayName,
        })
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
  const candidates = rawCandidates.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  return (
    <main className="screen">
      <h1>Ask a question</h1>
      <p className="subtle">
        Your question goes into the queue. It will be asked next time they sit
        down to talk — never as an interruption.
      </p>
      <form action={submitAsk} style={{ display: "grid", gap: "1rem" }}>
        <label>
          For
          <select name="targetPersonId" required>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Question
          <textarea name="questionText" rows={4} required />
        </label>
        <button type="submit">Send to the queue</button>
      </form>
      <p>
        <Link href="/hub">Back to hub</Link>
      </p>
    </main>
  );
}
