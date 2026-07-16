/**
 * POST /api/webhooks/clerk — sync Clerk user changes back into the domain DB (issue #10).
 *
 * Clerk provisioning is just-in-time on first landing (ADR-0005), which covers creation. This is the
 * missing half: `user.updated` and `user.deleted`, so a rename or account deletion in Clerk does not
 * leave a stale Account/Person row.
 *
 * The ONE vendor touch lives here: `verifyWebhook` (Standard Webhooks / Svix, bundled with
 * @clerk/nextjs) verifies the `svix-*` signature headers against `CLERK_WEBHOOK_SIGNING_SECRET`. A
 * failed/absent signature → 400 (Clerk retries only on genuine failure). Everything after verification
 * is the pure, PGlite-tested `applyClerkWebhookEvent` dispatcher.
 *
 * Idempotency / replay-safety: the underlying reconcilers are declaratively idempotent (set-to-value /
 * deactivate), so a Clerk retry or a replayed event is a harmless no-op — no event-id ledger needed.
 *
 * This route authenticates by SIGNATURE, not a Clerk session. `clerkMiddleware()` matches /api/* but is
 * non-blocking (no `auth.protect()`), so it is inert here — see middleware.ts.
 */
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextResponse, type NextRequest } from "next/server";
import { getRuntime } from "@/lib/runtime";
import {
  applyClerkWebhookEvent,
  type ClerkWebhookEventLite,
} from "@/lib/clerk-webhook";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let evt: ClerkWebhookEventLite;
  try {
    // Verifies the svix signature against CLERK_WEBHOOK_SIGNING_SECRET and returns the parsed event.
    evt = (await verifyWebhook(req)) as unknown as ClerkWebhookEventLite;
  } catch (err) {
    // Bad/absent signature, or the secret is not configured — reject so Clerk surfaces it and retries.
    console.error("[webhooks/clerk] signature verification failed:", err);
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }

  try {
    const { db } = await getRuntime();
    const outcome = await applyClerkWebhookEvent(db, evt);
    console.log("[webhooks/clerk] handled event:", outcome);
    // 2xx marks the event delivered so Clerk stops retrying — for handled AND ignored types alike.
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    // A genuine processing failure (e.g. DB down): return 500 so Clerk retries this delivery later.
    console.error("[webhooks/clerk] failed to process verified event:", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
