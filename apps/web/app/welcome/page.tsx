/**
 * /welcome — account onboarding host (handoff screens 1–4: welcome → dob → doors →
 * interview). The server component resolves identity + the post-onboarding destination once and
 * hands them to the client state machine; all persistence happens via the server actions in
 * ./actions.ts. The destination is precomputed here because memberships don't change mid-onboarding:
 * a Person already in a family lands on /hub, a manual signup with no family on /families/start.
 */
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import { listActiveMembershipsForPerson } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { WelcomeFlow } from "./WelcomeFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const { from } = await searchParams;

  const [row] = await db
    .select({
      displayName: persons.displayName,
      spokenName: persons.spokenName,
      onboardedAt: persons.onboardedAt,
    })
    .from(persons)
    .where(eq(persons.id, ctx.personId))
    .limit(1);

  // Already onboarded? Don't re-render the DOB step — re-submitting saveDob would silently
  // overwrite the user's own birth_date/birth_year/onboarded_at. Send them where they belong.
  if (row?.onboardedAt != null) {
    redirect(await resolvePostAuthRoute(db, ctx.personId));
  }

  const active = await listActiveMembershipsForPerson(db, ctx.personId);
  const hubDestination = active.length > 0 ? "/hub" : "/families/start";

  const fullName = row?.displayName ?? "there";
  const firstName = row?.spokenName ?? fullName.split(" ")[0] ?? "there";

  return (
    <WelcomeFlow
      fullName={fullName}
      firstName={firstName}
      invited={from === "invite"}
      hubDestination={hubDestination}
    />
  );
}
