/**
 * Client-runtime (browser) Sentry init. Next.js loads this file automatically on the client; it
 * replaces the older `sentry.client.config.ts`.
 *
 * IMPORTANT: `NEXT_PUBLIC_*` env vars are statically inlined into the browser bundle at build time
 * only for *direct, static* `process.env.NEXT_PUBLIC_FOO` references — a dynamic `process.env[name]`
 * lookup would NOT be replaced. So we read the DSN with a static reference here and hand the value
 * to the pure helpers (which otherwise default to process.env, fine on the server but not inlined).
 *
 * No-op unless the public DSN is set (see lib/sentry-config.ts) — keeps dev/CI/tests quiet.
 */
import * as Sentry from "@sentry/nextjs";

import {
  isSentryEnabled,
  resolveEnvironment,
  resolveTracesSampleRate,
} from "@/lib/sentry-config";

const dsn = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();

if (isSentryEnabled(dsn)) {
  Sentry.init({
    dsn,
    environment: resolveEnvironment(),
    tracesSampleRate: resolveTracesSampleRate(),
    // Session Replay intentionally NOT enabled (privacy + bundle weight; off by default).
    debug: false,
  });
}

// Instruments client-side router navigations for tracing (no-op without a DSN). v9.12.0+.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
