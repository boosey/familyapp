/**
 * Next.js middleware — conditionally activates Clerk's session middleware when Clerk is
 * configured. When Clerk env keys are unset / placeholder (local dev / CI) this is a no-op
 * pass-through, so the DevCookie auth path keeps working without Clerk envs.
 *
 * The token-bearer PAGE surfaces must NEVER be intercepted by Clerk — they authenticate by URL token,
 * not by a Clerk session, and a Clerk redirect would break them:
 *   /s/[token]  — narrator recording PAGE; authenticates by URL session token
 *   /a/[token]  — magic-link / account PAGE; authenticates by URL token
 * Both are carved out of the matcher below.
 *
 * The API data plane is deliberately NOT carved out, and the distinction is load-bearing:
 *   - /api/capture is token-authed (the body token IS the identity; no getCurrentAuthContext) and
 *     clerkMiddleware here is NON-BLOCKING (we never call auth.protect()), so matching it is harmless.
 *   - /api/media MUST stay matched: it calls getCurrentAuthContext(), and in Clerk mode Clerk's
 *     auth() only resolves on requests clerkMiddleware has processed — the authenticated hub plays
 *     media through it, so excluding it would break hub playback. (It still serves the token surfaces
 *     too; getMediaForViewer is the single front-door auth check either way.)
 * If global auth.protect() is ever added, the token PAGE carve-outs above must be revisited for the
 * API surface — flagged here so that change is deliberate.
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
  // Matcher design: negative-lookahead (Clerk's canonical v6 pattern, sourced from
  // https://clerk.com/docs/references/nextjs/clerk-middleware) extended with our token-bearer
  // carve-outs.
  //
  // Why negative-lookahead over an explicit allow-list:
  //   1. Clerk's own docs recommend it — automatically covers all routes except Next internals
  //      and static files without requiring an enumerated list.
  //   2. New authenticated pages (e.g. /settings, /profile) are covered without a list update.
  //   3. Our critical invariant is EXCLUSIONS (/s/ and /a/), not an enumerated include-list.
  //
  // Additions to Clerk's canonical lookahead exclusions:
  //   s/  → skips /s/[token] (narrator token PAGE surface)
  //   a/  → skips /a/[token] (magic-link token PAGE surface)
  // (Only the leading "/" path segment is examined, so /settings, /api-docs etc. stay matched.)
  //
  // The third entry `/__clerk/(.*)` explicitly covers Clerk's internal handshake routes
  // (session refresh, sign-in redirects) even though the first pattern also matches them —
  // belt-and-suspenders for the session handshake. See docs/DECISIONS.md § Clerk.
  matcher: [
    // Skip Next.js internals, static files, and our token-bearer PAGE surfaces (/s/, /a/).
    "/((?!_next|s/|a/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes (Clerk's auth() in a Route Handler needs the middleware to have run).
    "/(api|trpc)(.*)",
    // Always run for Clerk's internal handshake routes (session refresh, sign-in redirects).
    "/__clerk/(.*)",
  ],
};
