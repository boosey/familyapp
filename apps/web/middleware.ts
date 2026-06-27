/**
 * Next.js middleware — conditionally activates Clerk's session middleware on `/hub/**` when
 * Clerk is configured. When Clerk env keys are unset / placeholder (local dev / CI) this is a
 * no-op pass-through, so the DevCookie auth path keeps working without Clerk envs.
 *
 * We deliberately scope Clerk's middleware to the hub: the elder token surface at `/s/[token]`
 * authenticates via session token in the URL (per @chronicle/capture) and must NOT be touched
 * by Clerk's redirect/auth flow.
 *
 * Static (top-level) import of `clerkMiddleware` is intentional: Next.js middleware runs in the
 * Edge runtime, where dynamic `import()` is a bundler foot-gun. `@clerk/nextjs` is a regular
 * production dep and is inert when its env keys are absent, so importing the symbol unconditionally
 * is safe — we just never *invoke* the factory unless `isClerkConfigured()` is true.
 */
import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { isClerkConfigured } from "./lib/clerk-config";

const handler: (req: NextRequest) => Response | Promise<Response> =
  isClerkConfigured()
    ? (clerkMiddleware() as unknown as (
        req: NextRequest,
      ) => Response | Promise<Response>)
    : () => NextResponse.next();

export default handler;

export const config = {
  // Match the hub surface only. The elder token surface (/s/[token]) and Next internals are
  // intentionally excluded.
  matcher: ["/hub/:path*"],
};
