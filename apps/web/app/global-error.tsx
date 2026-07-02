"use client";

/**
 * App Router global error boundary. Next.js renders this *in place of* the root layout when an
 * error is thrown during rendering of the root layout or a top-level segment, so it must supply
 * its own <html>/<body>.
 *
 * Its reason for existing is Sentry: React render-time crashes at the root don't flow through the
 * server request-error hook, so without this file they never reach Sentry (the build warns about
 * exactly this). `Sentry.captureException` is a no-op unless a DSN is configured — same gating as
 * instrumentation-client.ts — so this stays quiet in dev/CI/tests.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <h1>Something went wrong</h1>
        <p>We hit an unexpected error. Please try again.</p>
      </body>
    </html>
  );
}
