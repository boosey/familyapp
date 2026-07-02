/**
 * Central post-authentication router. After any sign-in / sign-up / onboarding-completion the web
 * layer asks this one helper where to send the Person, so the family gate + onboarding gate live in
 * exactly one place. Order is family-FIRST:
 *
 *   Gate A. no family AND no pending join request → /families/start (the create-or-find fork)
 *   Gate B. a family intent exists but not onboarded (onboarded_at IS NULL) → /welcome (DOB)
 *   Gate C. onboarded but still awaiting approval on a join request → /families/find
 *   else  → /hub
 *
 * Identity-graph reads only (persons + the audited membership/join-request core funcs) — no content.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import {
  listActiveMembershipsForPerson,
  listJoinRequestsByRequester,
} from "@chronicle/core";
import type { Database } from "@chronicle/db";

export async function resolvePostAuthRoute(
  db: Database,
  personId: string,
): Promise<string> {
  const [p] = await db
    .select({ onboardedAt: persons.onboardedAt })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);

  const active = await listActiveMembershipsForPerson(db, personId);
  const requests = await listJoinRequestsByRequester(db, personId);
  const hasPending = requests.some((r) => r.status === "pending");

  // Gate A — a family intent must exist first (create or find). This is the family-first reorder:
  // a brand-new account with no family and no request goes to the fork, NOT straight to DOB.
  if (active.length === 0 && !hasPending) return "/families/start";

  // Gate B — DOB is the one required onboarding step, asked once a family intent exists.
  if (!p || p.onboardedAt == null) return "/welcome";

  // Gate C — onboarded but still awaiting approval on a join request: the finder's "Your requests"
  // section is where that request's status lives.
  if (active.length === 0 && hasPending) return "/families/find";

  return "/hub";
}
