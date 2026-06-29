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
import { createCoreAnchorSource, nextIntakeQuestion } from "@chronicle/interviewer";
import { getRuntime } from "@/lib/runtime";
import { AboutYouFlow } from "./AboutYouFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AboutYouPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const anchors = await createCoreAnchorSource(db).loadForNarrator(ctx.personId);
  // No person row / unreadable profile → nothing to ask. Bounce to the hub.
  if (!anchors) redirect("/hub");

  const first = nextIntakeQuestion(anchors.profile, new Set());
  // Profile already complete → nothing to ask. Bounce to the hub.
  if (!first) redirect("/hub");

  return (
    <AboutYouFlow
      initialQuestion={{ key: first.key, text: first.text }}
      hubHref="/hub"
    />
  );
}
