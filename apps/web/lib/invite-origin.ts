/**
 * Shared "public origin for an invite link" resolver — both `InviteTab.tsx` (the cold-path narrator +
 * member invite result view) and the person-bound Invite modal's server action (#334) need to turn a
 * fresh invitation token into an absolute, shareable `/join/[token]` URL. Extracted so both read the
 * SAME `APP_BASE_URL` / request-header resolution (`resolvePublicOrigin`) instead of drifting.
 */
import { headers } from "next/headers";
import { resolvePublicOrigin } from "./public-origin";

export async function resolveInviteOrigin(): Promise<string> {
  const h = await headers();
  // Prefer the configured public origin (APP_BASE_URL); fall back to request headers. In prod this
  // never emits a localhost link — resolvePublicOrigin throws if it can't determine a real origin.
  return resolvePublicOrigin({
    configuredBaseUrl: process.env.APP_BASE_URL,
    host: h.get("host"),
    forwardedProto: h.get("x-forwarded-proto"),
    isProduction: process.env.NODE_ENV === "production",
  });
}
