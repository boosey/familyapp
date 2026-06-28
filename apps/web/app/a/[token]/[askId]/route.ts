/**
 * Magic-link Route Handler — ADR-0003: a capture/question link is a passwordless account login
 * for a Person who has an Account.
 *
 * Flow:
 *   1. Resolve the token via resolveLinkSession → person.
 *   2. If the Person has no Account → stay on the login-free /s/[token] surface.
 *   3. If already signed in as this Person → skip re-auth, redirect to the answer page.
 *   4. Otherwise → establishAccountSession (sets the session cookie) → redirect.
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

  // 3. If already signed in as this Person, no need to re-establish the session.
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind === "account" && ctx.personId === personId) {
    redirect(destination);
  }

  // 4. Establish the account session (sets the session cookie), then redirect.
  //    `establishAccountSession` is the only thing in this try; it does NOT call redirect(),
  //    so the catch cannot swallow a NEXT_REDIRECT. The redirect calls below are outside it.
  let established = false;
  try {
    await auth.establishAccountSession(personId);
    established = true;
  } catch (err) {
    // The Clerk adapter deliberately throws "not supported in Phase 1". Degrading to the
    // login-free surface is the correct DEV behavior, but log loudly so a future Clerk
    // wire-up is not silently broken (this branch should disappear once Clerk sign-in lands).
    console.warn(
      `magic-link: establishAccountSession failed for person ${personId} — degrading to /s/[token]. ` +
        `If Clerk is configured this is a real failure that must be fixed.`,
      err,
    );
  }

  if (!established) {
    redirect(`/s/${token}`);
  }

  redirect(destination);
}
