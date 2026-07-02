/**
 * /hub/about-you — the single intake surface (the biographical "introduce yourself" walk).
 *
 * Reached from /welcome door 2 and the hub reminder banner. Account-authed only (beside /hub/answer
 * and /hub/ask). The server resolves the next question from the narrator's current profile and hands
 * only PLAIN DATA to the client — AboutYouFlow must NOT import @chronicle/interviewer (its index
 * transitively pulls core-adapters → db, which cannot live in a client bundle).
 *
 * The persons table is open schema (identity, not story content), so loading the profile here is a
 * non-content read — no @chronicle/core front-door bypass and no architecture-allowlist entry.
 */
import { redirect } from "next/navigation";
import type { BiographicalProfile } from "@chronicle/db";
import { createCoreAnchorSource, nextIntakeQuestion, INTAKE_QUESTIONS } from "@chronicle/interviewer";
import { listAnsweredQuestionKeys } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { AboutYouFlow } from "./AboutYouFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AboutYouPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const dest = await resolvePostAuthRoute(db, ctx.personId);

  const anchors = await createCoreAnchorSource(db).loadForNarrator(ctx.personId);
  // No person row / unreadable profile → nothing to ask. Bounce to wherever they belong.
  if (!anchors) redirect(dest);

  const answered = new Set<string>(await listAnsweredQuestionKeys(db, ctx.personId));
  const askedSet = new Set<keyof BiographicalProfile>();
  for (const q of INTAKE_QUESTIONS) if (answered.has(q.key)) askedSet.add(q.key);
  const first = nextIntakeQuestion(anchors.profile, askedSet);
  // Profile already complete (or all questions already answered) → nothing to ask. Bounce to wherever they belong.
  if (!first) redirect(dest);

  return (
    <AboutYouFlow
      initialQuestion={{ key: first.key, text: first.text }}
      hubHref={dest}
    />
  );
}
