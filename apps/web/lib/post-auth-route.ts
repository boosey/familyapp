/**
 * Central post-authentication router. After any sign-in / sign-up / onboarding-completion the web
 * layer asks this one helper where to send the Person, so the onboarding gate + family gate live in
 * exactly one place:
 *
 *   1. not onboarded (persons.onboarded_at IS NULL) → /welcome (the required DOB step lives there)
 *   2. onboarded but in no family → the find screen when a join request is already pending (its
 *      "Your requests" section shows where that request stands), else the create-or-join chooser
 *      (/families/start)
 *   3. onboarded and in ≥1 family → /hub
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
  if (!p || p.onboardedAt == null) return "/welcome";

  const active = await listActiveMembershipsForPerson(db, personId);
  if (active.length === 0) {
    const requests = await listJoinRequestsByRequester(db, personId);
    if (requests.some((r) => r.status === "pending")) {
      // The finder lists the requester's own pending/decided requests under "Your requests", so
      // this lands them where they can see the request's status (and search for more families).
      return "/families/find";
    }
    return "/families/start";
  }
  return "/hub";
}
