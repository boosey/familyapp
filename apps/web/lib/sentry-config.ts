/**
 * Single source of truth: is Sentry actually wired up for this process, and with what options?
 *
 * Mirrors the `isClerkConfigured()` runtime-switch philosophy (see lib/clerk-config.ts). Sentry is
 * a NO-OP unless a DSN is present:
 *   - The browser/client reads `NEXT_PUBLIC_SENTRY_DSN` (inlined at build time by Next).
 *   - Server + edge read `SENTRY_DSN`, falling back to the public DSN so a single var can drive all
 *     three runtimes.
 *
 * When no DSN is set (local dev, CI, `pnpm test`, prod builds without secrets) every `init*` helper
 * skips `Sentry.init` entirely — no events, no network, no init errors. The Sentry SDK itself also
 * no-ops on an empty DSN, but we gate explicitly so the inert path is obvious and testable.
 *
 * No `server-only`, no DB/fs imports: importable from instrumentation files in every runtime.
 *
 * NOTE: in the client (browser) bundle, `NEXT_PUBLIC_*` vars are statically inlined by Next at
 * build time; dynamic `process.env[name]` lookups would NOT be replaced. The instrumentation-client
 * file therefore reads `process.env.NEXT_PUBLIC_SENTRY_DSN` directly and passes it in. These helpers
 * accept an explicit `env` record (defaulting to `process.env`) so they stay pure and unit-testable.
 */

export type SentryEnv = Record<string, string | undefined>;

/** Trim + non-empty check. A whitespace-only or empty DSN disables Sentry. */
export function isSentryEnabled(dsn: string | undefined | null): boolean {
  return typeof dsn === "string" && dsn.trim().length > 0;
}

/** Client/browser DSN: public var only (the secret server DSN must never reach the browser). */
export function resolveClientDsn(env: SentryEnv = process.env): string {
  return (env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();
}

/** Server + edge DSN: prefer the server-only var, fall back to the public one. */
export function resolveServerDsn(env: SentryEnv = process.env): string {
  return (env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();
}

/**
 * Traces sample rate, overridable via `SENTRY_TRACES_SAMPLE_RATE`. Defaults to a modest 0.1.
 * Ignores values that don't parse to a finite number in [0, 1].
 */
export function resolveTracesSampleRate(env: SentryEnv = process.env): number {
  const raw = env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw.trim() === "") return 0.1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.1;
  return n;
}

/** Sentry `environment` tag — driven by NODE_ENV, defaulting to "development". */
export function resolveEnvironment(env: SentryEnv = process.env): string {
  return env.NODE_ENV ?? "development";
}
