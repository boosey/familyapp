/**
 * Next.js instrumentation hook (runs once per server/edge runtime at startup). Lazy-imports the
 * matching Sentry config so server SDK code never loads in the edge bundle and vice-versa.
 *
 * Both configs are inert when no DSN is set, so this stays a no-op in dev/CI/tests.
 *
 * `onRequestError` forwards errors thrown in nested React Server Components / route handlers to
 * Sentry (Next.js 15+ / @sentry/nextjs v8.28+). It too no-ops without a configured DSN.
 */
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
