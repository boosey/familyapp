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
export function isInngestConfigured(): boolean {
  return (process.env.INNGEST_EVENT_KEY ?? "").length > 0;
}

/**
 * Fail-fast guard against the half-configured signing-key trap.
 *
 * This app both ENQUEUES events and SERVES function execution in one process. If a prod deploy sets
 * `INNGEST_EVENT_KEY` (so `isInngestConfigured()` is true → dispatch enqueues, Inngest cloud
 * registers the app) but omits `INNGEST_SIGNING_KEY`, then Inngest's inbound execution POSTs to
 * `/api/inngest` cannot be signature-verified — every stage fails and stories sit in `draft`
 * FOREVER, silently. In OUR design dev never sets `INNGEST_EVENT_KEY` (it stays in-process), so an
 * event key present always means prod-durable mode where the signing key is MANDATORY.
 *
 * So we crash at boot naming the missing var, exactly as `selectMediaStorage` throws on a partial
 * R2 config — a loud boot failure beats silent forever-draft. Called from `build()` BEFORE any
 * Inngest client/pipeline is constructed.
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
}
