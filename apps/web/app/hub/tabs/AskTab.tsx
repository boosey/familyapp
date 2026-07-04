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
import { hub } from "@/app/_copy";
import { AskPhotoPicker } from "./AskPhotoPicker";

async function submitAsk(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");
  const targetPersonId = String(formData.get("targetPersonId") ?? "");
  const questionText = String(formData.get("questionText") ?? "");
  // ADR-0009 Phase 3: optional subject photos the ask is ABOUT. Identity is re-resolved above; the
  // photo ids are untrusted client input, but `createAsk` re-runs the album-access gate per id inside
  // its write transaction (a photo the asker can't see rejects the whole ask), so passing them
  // straight through is safe — the gate, not this endpoint, is the authority.
  const subjectPhotoIds = formData
    .getAll("subjectPhotoIds")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  await createAsk(db, ctx, {
    targetPersonId,
    questionText,
    ...(subjectPhotoIds.length > 0 ? { subjectPhotoIds } : {}),
  });
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
        {hub.ask.signedOut}
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
        {hub.ask.heading}
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
        {hub.ask.intro}
      </p>

      <div style={{ marginBottom: 24 }}>
        <KindredPromptCard
          eyebrow={hub.ask.promptEyebrow}
          question={hub.ask.promptQuestion}
        />
      </div>

      <form action={submitAsk} style={{ display: "grid", gap: 20 }}>
        <label className="kin-form-label">
          {hub.ask.forLabel}
          <select name="targetPersonId" className="kin-field" required>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="kin-form-label">
          {hub.ask.questionLabel}
          <textarea
            name="questionText"
            className="kin-field"
            rows={5}
            required
            placeholder={hub.ask.questionPlaceholder}
          />
        </label>
        <AskPhotoPicker />
        <KindredButton type="submit" label={hub.ask.submit} />
      </form>
    </div>
  );
}
