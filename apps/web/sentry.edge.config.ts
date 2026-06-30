/**
 * Edge-runtime Sentry init (middleware, edge routes). Imported by instrumentation.ts's register()
 * hook only when NEXT_RUNTIME === "edge". No-op unless a DSN is configured.
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
    debug: false,
  });
}
