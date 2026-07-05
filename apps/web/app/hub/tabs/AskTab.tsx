/**
 * Ask tab — compose a question for a narrator.
 * Server component; fetches family members and renders the ask form + its server action.
 */
import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createAsk } from "@chronicle/core";
import { invitations, memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { listActiveFamiliesForPerson } from "@chronicle/core";
import { KindredButton, KindredPromptCard } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { AskPhotoPicker } from "./AskPhotoPicker";
import { AskFamilyPicker } from "./AskFamilyPicker";
import {
  familyChoiceRequired,
  resolveComposeFamilies,
  seedComposeFamilies,
} from "@/lib/compose-scope";

async function submitAsk(formData: FormData): Promise<void> {
  "use server";
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");
  const targetPersonId = String(formData.get("targetPersonId") ?? "");
  const questionText = String(formData.get("questionText") ?? "");
  // Family target set (Increment 4B, Task 4.4). The chosen ids arrive from the multi-select (or none,
  // when the asker has a single family and no picker was shown). `resolveComposeFamilies` re-reads the
  // asker's OWN active families server-side, auto-resolves the unambiguous cases, and THROWS when the
  // asker has >1 family and picked none — the server-side guard mirroring the client `required`.
  const chosenFamilyIds = formData
    .getAll("familyIds")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const activeFamilyIds = (await listActiveFamiliesForPerson(db, ctx.personId)).map(
    (f) => f.familyId,
  );
  const familyIds = resolveComposeFamilies(chosenFamilyIds, activeFamilyIds);
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
    ...(familyIds.length > 0 ? { familyIds } : {}),
    ...(subjectPhotoIds.length > 0 ? { subjectPhotoIds } : {}),
  });
  redirect("/hub?tab=asks");
}

export async function AskTab({ scope = "all" }: { scope?: string } = {}) {
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

  // The asker's active families — both the candidate-person filter AND the compose family multi-select
  // (with names) draw from this single read.
  const viewerFams = await listActiveFamiliesForPerson(db, ctx.personId);
  const familyIds = viewerFams.map((r) => r.familyId);
  // Seed the family multi-select from the hub scope; only shown (and only `required`) when the asker
  // is in >1 family — a single-family asker is auto-resolved in `submitAsk`.
  const showFamilyPicker = viewerFams.length > 1;
  const seededFamilyIds = [...seedComposeFamilies(scope, familyIds)];
  const familyChoiceIsRequired = familyChoiceRequired(scope, familyIds);
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
  // ADR-0006: also offer PENDING invitees of the viewer's families as targets — you may ask someone
  // your family has invited before they join. Their provisional Person is the anchor; on acceptance
  // the queued questions merge onto their real Person.
  const rawInvitees = familyIds.length
    ? await db
        .select({ id: persons.id, displayName: persons.displayName })
        .from(invitations)
        .innerJoin(persons, eq(persons.id, invitations.inviteePersonId))
        .where(
          and(
            inArray(invitations.familyId, familyIds),
            eq(invitations.status, "pending"),
          ),
        )
    : [];

  const seen = new Set<string>([ctx.personId]);
  const candidates: { id: string; displayName: string; pending?: boolean }[] = [];
  for (const p of rawCandidates) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    candidates.push(p);
  }
  for (const p of rawInvitees) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    candidates.push({ ...p, pending: true });
  }

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
                {p.pending ? `${p.displayName} (invited)` : p.displayName}
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
        {showFamilyPicker ? (
          <AskFamilyPicker
            families={viewerFams}
            seeded={seededFamilyIds}
            required={familyChoiceIsRequired}
          />
        ) : null}
        <AskPhotoPicker />
        <KindredButton type="submit" label={hub.ask.submit} />
      </form>
    </div>
  );
}
