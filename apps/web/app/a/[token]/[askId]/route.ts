/**
 * Magic-link Route Handler — ADR-0003: a capture/question link is a passwordless account login
 * for a Person who has an Account.
 *
 * Flow:
 *   1. Resolve the token via resolveLinkSession → person.
 *   2. If the Person has no Account → stay on the login-free /s/[token] surface.
 *   3. If already signed in as this Person → skip re-auth, redirect to the answer page.
 *   4. Otherwise → establishAccountSession, then redirect to the seam result's target:
 *        - mock/dev set a session cookie ("established") and we redirect straight to the destination;
 *        - Clerk mints a one-time sign-in token ("handoff") and we hand off to /auth/redeem so the
 *          browser redeems it (Clerk forbids forging a server-side session from a userId — ADR-0003).
 *
 * MUST be a Route Handler (not a Server Component page): only Route Handlers and Server Actions
 * may set cookies in Next 15. The `redirect()` from next/navigation composes with the cookie set
 * by establishAccountSession — both land in the same response.
 */
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import { resolveLinkSession } from "@chronicle/capture";
import { getRuntime } from "@/lib/runtime";
import { resolveMagicLinkTarget } from "@/lib/magic-link";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; askId: string }> },
) {
  const { token, askId } = await params;
  const { db, auth } = await getRuntime();

  // 1. Resolve the link session token.
  const resolved = await resolveLinkSession(db, token);
  if (!resolved) {
    // Unknown / revoked / expired → warm "link is resting" dead-end.
    redirect(`/s/${token}`);
  }

  const { personId } = resolved;

  // 2. Check whether this Person has an Account (persons.accountId is the pointer; nullable).
  const [personRow] = await db
    .select({ accountId: persons.accountId })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);

  if (!personRow?.accountId) {
    // No Account: login-free link-session capture surface (ADR-0003).
    redirect(`/s/${token}`);
  }

  // Decide where to land after auth.
  const isValidAskId = /^[0-9a-f-]{36}$/i.test(askId);
  const destination = isValidAskId ? `/hub/answer/${askId}` : "/hub?tab=questions";

  // 3. If already signed in as this Person, skip re-establishing the session.
  //    NOTE: this fires only in mock/dev mode, where getCurrentAuthContext reads the session cookie
  //    directly. In Clerk mode it's a harmless no-op: /a/[token] is excluded from the middleware
  //    matcher (URL-token surface), so Clerk's auth() returns no userId here and we fall through to
  //    mint+redeem — which still lands the narrator authenticated.
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind === "account" && ctx.personId === personId) {
    redirect(destination);
  }

  // 4. Establish the account session, then redirect to the seam result's target.
  //    `establishAccountSession` is the only thing in this try; it does NOT call redirect(), so the
  //    catch cannot swallow a NEXT_REDIRECT. Both redirect() calls (the catch's and the final one)
  //    are the LAST statement on their path, so nothing downstream swallows the thrown NEXT_REDIRECT.
  let result;
  try {
    result = await auth.establishAccountSession(personId);
  } catch (err) {
    // A genuine failure (Clerk Backend/DB outage, or a Person with no Account slipping past the
    // guard above) must degrade to the login-free surface, never 500. Logged as a REAL error.
    console.error(
      `magic-link: establishAccountSession failed for person ${personId} — degrading to /s/[token].`,
      err,
    );
    redirect(`/s/${token}`);
  }

  redirect(resolveMagicLinkTarget(result, { destination, token }));
}
