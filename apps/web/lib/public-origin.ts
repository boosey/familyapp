/**
 * Resolve the app's public origin (scheme + host, no trailing slash) for building absolute,
 * shareable URLs — invite links, magic links, anything a user copies out of the app.
 *
 * Why this exists: invite links were built from the request `Host` header with a hardcoded
 * `localhost:3000` fallback and a default `http` scheme. In production the Host header is normally
 * present, but if it were ever absent (or the proto header missing) the app could mint a DEAD
 * `http://localhost:3000/...` invite URL and hand it to a user — a silent, embarrassing failure.
 *
 * Resolution order:
 *   1. `APP_BASE_URL` (server env) — the canonical public origin. Set this in prod (e.g. the Vercel
 *      deployment URL or custom domain). Wins over headers so links are stable regardless of which
 *      internal host served the request.
 *   2. The request `Host` + `x-forwarded-proto` headers — normal dev/prod path. Scheme defaults to
 *      `https` in production, `http` in dev.
 *   3. Dev-only fallback `http://localhost:3000` when there is no configured URL AND no Host header.
 *      In PRODUCTION this case THROWS instead of emitting a localhost link — fail loud, never ship a
 *      dead URL to a user.
 *
 * This is a PURE function (no `next/headers`, no `process.env` reads) so the branching is unit
 * testable; the caller reads headers/env and passes them in.
 */
export function resolvePublicOrigin(input: {
  /** `process.env.APP_BASE_URL` (or undefined). */
  configuredBaseUrl?: string | undefined;
  /** The request `Host` header value (or null/undefined if absent). */
  host?: string | null;
  /** The `x-forwarded-proto` header value (or null/undefined if absent). */
  forwardedProto?: string | null;
  /** `process.env.NODE_ENV === "production"`. */
  isProduction: boolean;
}): string {
  const configured = input.configuredBaseUrl?.trim();
  if (configured) {
    // A schemeless value (e.g. "app.example.com") would yield a path-relative link like
    // "app.example.com/s/<token>" — dead in every browser and email client. Fail loud: the same
    // silent-dead-link failure this function exists to prevent, just via a misconfigured env var.
    if (!/^https?:\/\//i.test(configured)) {
      throw new Error(
        `APP_BASE_URL must include the scheme (e.g. https://app.example.com), got: "${configured}".`,
      );
    }
    return configured.replace(/\/+$/, "");
  }

  const host = input.host?.trim();
  if (!host) {
    if (input.isProduction) {
      throw new Error(
        "Cannot build a public URL: no Host header and APP_BASE_URL is unset in production. " +
          "Set APP_BASE_URL to the public origin (e.g. https://app.example.com).",
      );
    }
    return "http://localhost:3000";
  }

  const proto = input.forwardedProto?.trim() || (input.isProduction ? "https" : "http");
  return `${proto}://${host}`;
}
