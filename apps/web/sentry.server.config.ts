/**
 * Server-runtime (Node.js) Sentry init. Imported by instrumentation.ts's register() hook only when
 * NEXT_RUNTIME === "nodejs". No-op unless a DSN is configured (see lib/sentry-config.ts).
 */
import * as Sentry from "@sentry/nextjs";

import {
  isSentryEnabled,
  resolveEnvironment,
  resolveServerDsn,
  resolveTracesSampleRate,
} from "@/lib/sentry-config";

const dsn = resolveServerDsn();

if (isSentryEnabled(dsn)) {
  Sentry.init({
    dsn,
    environment: resolveEnvironment(),
    tracesSampleRate: resolveTracesSampleRate(),
    // Off by default; flip only when actively debugging the SDK.
    debug: false,
  });
}
