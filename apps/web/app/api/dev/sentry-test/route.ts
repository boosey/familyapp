/**
 * DEV-ONLY Sentry smoke test. Throws an uncaught error on POST so you can confirm that errors reach
 * your Sentry project once a DSN is configured. Captured via the Next.js error instrumentation
 * (instrumentation.ts `onRequestError`) on the server runtime.
 *
 * Guarded exactly like /api/dev/seed: returns 404 in production so it is never exposed there.
 *
 * POST (not GET), mirroring /api/dev/seed: a browser visit, link prefetch, or healthcheck can't
 * accidentally trip it.
 *
 * Live verification (with SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN set, NODE_ENV !== production):
 *   curl -X POST http://localhost:3000/api/dev/sentry-test
 * then check the Sentry project for a `Sentry dev smoke test ...` issue.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(): NextResponse {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  throw new Error(
    `Sentry dev smoke test ${new Date().toISOString()} — if you see this in Sentry, capture works.`,
  );
}
