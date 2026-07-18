/**
 * Single source of truth: is the durable Inngest queue wired up for this process?
 *
 * Lives in its own tiny module (no `server-only`, no DB/SDK imports) so it can be imported from
 * `lib/runtime.ts` (which selects the durable-vs-synchronous dispatch path) AND unit-tested in
 * isolation — mirrors `lib/clerk-config.ts`'s `isClerkConfigured()`.
 *
 * Gate key: `INNGEST_EVENT_KEY`. That key is what the adapter's Inngest client uses to SEND events
 * (see `createInngestJobQueue`), so its presence is the honest signal that "events have somewhere
 * to go." Absent (local dev, CI, any environment without secrets) → we stay on the synchronous
 * in-process pipeline and `pnpm dev` keeps working with no Inngest account.
 *
 * NOTE: `isInngestConfigured()` itself gates ONLY on the event key — it answers the narrow
 * question "should dispatch enqueue rather than run in-process?". The durable path ALSO needs
 * `INNGEST_SIGNING_KEY` so the serve route can verify Inngest's inbound execution POSTs; that
 * additional requirement is enforced separately by `assertInngestServeable()` below (a boot-time
 * fail-fast), keeping the boolean gate single-purpose.
 */
import { resolvePublicOrigin } from "./public-origin";

export function isInngestConfigured(): boolean {
  return (process.env.INNGEST_EVENT_KEY ?? "").length > 0;
}

/**
 * Fail-fast guard against the two traps that make the durable Inngest path silently un-completable.
 *
 * This app both ENQUEUES events and SERVES function execution in one process. When a deploy sets
 * `INNGEST_EVENT_KEY` (so `isInngestConfigured()` is true → dispatch enqueues, Inngest cloud
 * registers the app), two OTHER env vars become MANDATORY — absent, the durable workers fail at
 * EXECUTION time (a separate Inngest-driven request), silently, per-job, forever:
 *
 *   1. `INNGEST_SIGNING_KEY` — without it Inngest's inbound execution POSTs to `/api/inngest` can't
 *      be signature-verified, so EVERY stage fails and stories sit in `draft` FOREVER.
 *
 *   2. `APP_BASE_URL` (a resolvable public origin) — the `invite.send` worker runs with NO request
 *      context (`host: null`), so `resolvePublicOrigin` can only get the origin from `APP_BASE_URL`.
 *      Missing/schemeless → the worker THROWS before ever calling Resend/Twilio, so member invites
 *      are enqueued but never delivered (delivery_attempts stays 0), with no user-visible error.
 *      This bit us in prod: `APP_BASE_URL` was Production-scoped only, so a preview deployment that
 *      had hijacked the shared Inngest app registration executed the worker without it. Note the
 *      pipeline stages (transcribe/render_story) do NOT need this — but they're registered on the
 *      same durable queue as `invite.send`, so "Inngest configured" always implies the invite
 *      worker is live and this var is required.
 *
 * We crash at boot naming the missing var, exactly as `selectMediaStorage` throws on a partial R2
 * config — a loud boot failure beats a silent, forever-broken async job. Called from `build()`
 * BEFORE any Inngest client/pipeline is constructed. The origin check reuses `resolvePublicOrigin`
 * with the SAME arguments the worker passes, so it catches exactly what the worker would choke on
 * (missing OR schemeless) — single source of truth, no drift.
 */
export function assertInngestServeable(): void {
  if (!isInngestConfigured()) return;
  if ((process.env.INNGEST_SIGNING_KEY ?? "").length === 0) {
    throw new Error(
      "Inngest is configured (INNGEST_EVENT_KEY set) but INNGEST_SIGNING_KEY is missing. " +
        "This app both enqueues and serves Inngest in one process; without the signing key, " +
        "Inngest cloud cannot execute jobs and stories will stay in draft forever. " +
        "Set INNGEST_SIGNING_KEY or unset INNGEST_EVENT_KEY (dev/in-process mode).",
    );
  }
  // The durable `invite.send` worker has no request Host — it can ONLY build the join link from
  // APP_BASE_URL. Validate the exact call the worker makes so a missing/schemeless value fails loud
  // here, not silently inside every invite job. (See resolvePublicOrigin for the throw conditions.)
  try {
    resolvePublicOrigin({
      configuredBaseUrl: process.env.APP_BASE_URL,
      host: null,
      forwardedProto: null,
      // Deliberately hardcoded `true` to MIRROR the durable invite.send worker in runtime.ts,
      // which also passes `isProduction: true` (a durable job has no request, so the localhost
      // fallback must never apply). Do NOT "fix" this to `NODE_ENV === "production"`: that would
      // let the boot guard and the worker disagree — the guard could pass while the worker throws.
      isProduction: true,
    });
  } catch (cause) {
    throw new Error(
      "Inngest is configured (INNGEST_EVENT_KEY set) but APP_BASE_URL is missing or invalid. " +
        "The durable invite.send worker runs with no request context, so it can only build the " +
        "join link from APP_BASE_URL; without a valid one, member invites are enqueued but never " +
        "delivered. Set APP_BASE_URL to the public origin (e.g. https://app.example.com) in every " +
        "environment where INNGEST_EVENT_KEY is set (including Preview), or unset INNGEST_EVENT_KEY " +
        `(dev/in-process mode). Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
