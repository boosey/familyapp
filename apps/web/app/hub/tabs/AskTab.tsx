/**
 * Ask tab — compose a question for a narrator.
 * Server component; fetches family members and renders the ask form + its server action.
 */
import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createAsk } from "@chronicle/core";
import { memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { KindredButton, KindredPromptCard } from "@/app/_kindred";

async function submitAsk(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");
  const targetPersonId = String(formData.get("targetPersonId") ?? "");
  const questionText = String(formData.get("questionText") ?? "");
  await createAsk(db, ctx, { targetPersonId, questionText });
  redirect("/hub?tab=asks");
}

export async function AskTab() {
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
        Sign in to ask a question.
      </p>
    );
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
  const candidates = rawCandidates.filter((p) =>
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
        Ask a question
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          lineHeight: "var(--leading-body)",
          color: "var(--text-muted)",
          margin: "12px 0 28px",
        }}
      >
        Your question goes into the queue. It will be asked next time they sit down to talk —
        never as an interruption.
      </p>

      <div style={{ marginBottom: 24 }}>
        <KindredPromptCard
          eyebrow="What would you love to hear?"
          question="A good ask is small and human — a name, a smell, a feeling, a Sunday."
        />
      </div>

      <form action={submitAsk} style={{ display: "grid", gap: 20 }}>
        <label className="kin-form-label">
          For
          <select name="targetPersonId" className="kin-field" required>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="kin-form-label">
          Your question
          <textarea
            name="questionText"
            className="kin-field"
            rows={5}
            required
            placeholder="e.g. What was your mother singing on Sunday mornings?"
          />
        </label>
        <KindredButton type="submit" label="Send to the queue" />
      </form>
    </div>
  );
}
