/**
 * Ask submission — a younger family member's question for an elder. The Ask is `queued`
 * immediately and never interrupts the elder; the interviewer pulls it on the next gentle
 * session, frames it warmly with the asker named, and on approval flips it to `answered`.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createAsk } from "@chronicle/core";
import { memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { KindredButton, KindredPromptCard } from "@/app/_kindred";

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
    return <SignInPrompt />;
  }

  const viewerFams = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(and(eq(memberships.personId, ctx.personId), eq(memberships.status, "active")));
  const familyIds = viewerFams.map((r) => r.familyId);
  const rawCandidates = familyIds.length
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
  const candidates = rawCandidates.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));

  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
        <Link href="/hub" className="kin-back-link">‹ Back to hub</Link>
        <h1 style={{ fontSize: "var(--kin-text-title)", margin: "16px 0 8px" }}>Ask a question</h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--kin-text-h3)", margin: 0 }}>
          Your question goes into the queue. It will be asked next time they sit down to talk —
          never as an interruption.
        </p>

        <div style={{ marginTop: 32 }}>
          <KindredPromptCard
            eyebrow="What would you love to hear?"
            question="A good ask is small and human — a name, a smell, a feeling, a Sunday."
          />
        </div>

        <form action={submitAsk} style={{ display: "grid", gap: 20, marginTop: 28 }}>
          <label className="kin-form-label">
            For
            <select name="targetPersonId" className="kin-field" required>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </label>
          <label className="kin-form-label">
            Your question
            <textarea name="questionText" className="kin-field" rows={5} required placeholder="e.g. What was your mother singing on Sunday mornings?" />
          </label>
          <KindredButton type="submit" label="Send to the queue" />
        </form>
      </div>
      <BackStyle />
    </main>
  );
}

function SignInPrompt() {
  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
        <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>Sign in to ask</h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--kin-text-h3)" }}>
          You need to sign in first.
        </p>
        <Link href="/dev/sign-in" style={{ textDecoration: "none", display: "inline-block", maxWidth: 240 }}>
          <KindredButton label="Dev sign-in" />
        </Link>
      </div>
    </main>
  );
}

function BackStyle() {
  return (
    <style>{`
      .kin-back-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 15px;
        font-weight: 600;
        color: var(--kin-ink-2);
        text-decoration: none;
      }
      .kin-back-link:hover { color: var(--kin-accent); text-decoration: none; }
    `}</style>
  );
}
