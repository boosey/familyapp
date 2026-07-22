/**
 * Ask tab — compose a question for a narrator (redesigned #204).
 * Server component; fetches the ask candidates and renders the ask form + its server action.
 *
 * The panel is deliberately spare: NO heading/intro/prompt card and NO family designator — the ask
 * submits FAMILYLESS (see submitAsk). The form is, top to bottom: the person selector (a type-ahead
 * KindredCombobox sized like the album's Time select), the "Add photos" button (opens the modal
 * album picker, AskPhotoPicker), the question textarea (album-search-field styling, multiline),
 * and the "Send Question" action button.
 */
import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createAsk } from "@chronicle/core";
import { plogError } from "@chronicle/pipeline";
import { invitations, memberships, persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { KindredCombobox } from "@/app/_kindred/KindredCombobox";
import { hub } from "@/app/_copy";
import { AskPhotoPicker } from "./AskPhotoPicker";
import s from "./AskTab.module.css";

async function submitAsk(formData: FormData): Promise<void> {
  "use server";
  const { db, auth, dispatchAskActionableNotify } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");
  const targetPersonId = String(formData.get("targetPersonId") ?? "");
  const questionText = String(formData.get("questionText") ?? "");
  // #204 (user decision): the ask is submitted FAMILYLESS — the family designator was removed from
  // this panel, so `createAsk` is called with no `familyIds` (the same shape as the pre-existing
  // 0-family path). createAsk's own authorization (shared active membership / the ADR-0006
  // invitation floor) still gates the target server-side.
  // ADR-0009 Phase 3: optional subject photos the ask is ABOUT. Identity is re-resolved above; the
  // photo ids are untrusted client input, but `createAsk` re-runs the album-access gate per id inside
  // its write transaction (a photo the asker can't see rejects the whole ask), so passing them
  // straight through is safe — the gate, not this endpoint, is the authority.
  const subjectPhotoIds = formData
    .getAll("subjectPhotoIds")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const ask = await createAsk(db, ctx, {
    targetPersonId,
    questionText,
    ...(subjectPhotoIds.length > 0 ? { subjectPhotoIds } : {}),
  });
  // #276: best-effort email the askee that a question is waiting. Never fails Ask creation.
  try {
    await dispatchAskActionableNotify({ askId: ask.id });
  } catch (err) {
    plogError("ask", "submitAsk: ask.actionable.notify dispatch failed", {
      ask: ask.id,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
  redirect("/hub?tab=asks");
}

export async function AskTab({
  families,
  initialSubjectPhotoIds = [],
}: {
  /** ALL the asker's active families — the candidate-person / invitee reads below filter by these
   *  ids (the ask itself submits familyless, #204; the ids only scope WHO can be asked). */
  families: { id: string; name: string; shortName?: string | null }[];
  initialSubjectPhotoIds?: string[];
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind !== "account") {
    return <p className={s.signedOut}>{hub.ask.signedOut}</p>;
  }

  // The asker's active families come from the passed `families` prop (the authoritative active
  // list); the candidate-person / invitee reads below filter by these ids.
  const familyIds = families.map((f) => f.id);
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
    // displayName is nullable in schema (ADR-0016) but these ask candidates are named members;
    // `?? ""` is a compiler guard.
    candidates.push({ ...p, displayName: p.displayName ?? "" });
  }
  for (const p of rawInvitees) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    candidates.push({ ...p, displayName: p.displayName ?? "", pending: true });
  }

  return (
    <div className={s.panel}>
      <form action={submitAsk} className={s.form}>
        <div className={s.field}>
          <span className={s.label}>{hub.ask.forLabel}</span>
          <KindredCombobox
            name="targetPersonId"
            options={candidates.map((p) => ({
              id: p.id,
              name: p.displayName,
              note: p.pending ? hub.ask.invitedNote : undefined,
            }))}
            ariaLabel={hub.ask.forLabel}
            placeholder={hub.ask.forPlaceholder}
            noMatchesText={hub.ask.noPersonMatches}
            invalidText={hub.ask.forInvalid}
            required
          />
        </div>
        {/* #204: the "Add photos" action sits BETWEEN the person selector and the question box. */}
        <AskPhotoPicker initialSelectedPhotoIds={initialSubjectPhotoIds} />
        <label className={s.field}>
          <span className={s.label}>{hub.ask.questionLabel}</span>
          <textarea
            name="questionText"
            className={s.questionField}
            rows={4}
            required
            placeholder={hub.ask.questionPlaceholder}
          />
        </label>
        <ActionButton type="submit">{hub.ask.submit}</ActionButton>
      </form>
    </div>
  );
}
