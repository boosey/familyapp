/**
 * /auth/callback — the single post-Clerk landing for every entry point:
 * plain sign-up, invitation accept (cookie-carried), and (later) sign-in-token redemption.
 *
 * Flow (ADR-0005 — JIT provisioning):
 *   1. auth() → userId. No userId → redirect /sign-in (unauthenticated call or Clerk mis-config).
 *   2. JIT provision: `provisionOrResolveClerkUser` is idempotent + race-safe — two concurrent
 *      landings for the same brand-new user resolve to the same Person (the loser re-resolves the
 *      winner's row via the in-transaction uniqueness guard in `createAccountWithPerson`).
 *   3. Read + clear the pending-invite cookie (written by /join/[token] for anonymous visitors).
 *      If present, attempt `acceptInvitation` via `resolveCallbackDestination`; errors are ignored
 *      so a stale/used invite token never blocks the user from landing. Cookie is cleared regardless.
 *   4. Redirect to the resolved destination (resolvePostAuthRoute: /welcome, /families/start, /hub).
 *      If an invite was applied, `?from=invite` (or `&from=invite`) is appended.
 *
 * MUST be a GET Route Handler (not a Server Component page): only Route Handlers and Server Actions
 * may read+delete cookies in Next.js 15. NextResponse.redirect constructs the Location header
 * with a full URL, so we pass `new URL(dest, req.url)` to make relative paths absolute.
 *
 * All errors are caught and redirect to /sign-in?error=callback so the user is never stranded
 * on a blank screen. Errors are logged for observability.
 */
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";
import { provisionOrResolveClerkUser } from "@/lib/clerk-server";
import { readPendingInvite, clearPendingInvite } from "@/lib/pending-invite";
import { resolveCallbackDestination } from "@/lib/auth-callback";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    // 1. Require an active Clerk session.
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    // 2. JIT provision → our domain Person id (idempotent + race-safe).
    const { db } = await getRuntime();
    const personId = await provisionOrResolveClerkUser(db, userId);

    // 3. Read the pending invite (set by /join/[token] for anonymous visitors), then clear it
    //    IMMEDIATELY — before processing — so the one-shot cookie never survives this landing even
    //    if routing below throws. We already hold the value in `invite`.
    const invite = await readPendingInvite();
    await clearPendingInvite();
    const dest = await resolveCallbackDestination(db, personId, invite);

    // 4. Redirect to the resolved destination.
    return NextResponse.redirect(new URL(dest, req.url));
  } catch (err) {
    console.error("[auth/callback] unexpected error — redirecting to /sign-in?error=callback:", err);
    return NextResponse.redirect(new URL("/sign-in?error=callback", req.url));
  }
}
