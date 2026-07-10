/**
 * GET /api/google-photos/callback — finish Google Photos OAuth (ADR-0009 Phase 5).
 *
 * Validates the signed state cookie against the `state` query param, exchanges the code,
 * upserts the encrypted refresh token, clears the cookie, redirects to `/hub?tab=album`.
 */
import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";
import {
  getGooglePhotosDeps,
  getGooglePhotosOAuthConfig,
  isGooglePhotosConfigured,
} from "@/lib/google-photos-config";
import {
  decryptConnectionRefreshToken,
  getActiveGooglePhotosConnection,
  upsertGooglePhotosConnection,
} from "@/lib/google-photos-connection";
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  verifyOAuthState,
} from "@/lib/google-photos-oauth-state";

export const runtime = "nodejs";

function albumRedirect(req: Request, error?: string): NextResponse {
  const dest = new URL("/hub", req.url);
  dest.searchParams.set("tab", "album");
  if (error) dest.searchParams.set("googlePhotosError", error);
  else dest.searchParams.set("googlePhotos", "connected");
  return NextResponse.redirect(dest);
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    if (!isGooglePhotosConfigured()) {
      return albumRedirect(req, "not_configured");
    }

    const { auth, db } = await getRuntime();
    const ctx = await auth.getCurrentAuthContext();
    if (ctx.kind !== "account") {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      await clearOAuthStateCookie();
      return albumRedirect(req, "denied");
    }

    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const cookieState = await readOAuthStateCookie();
    await clearOAuthStateCookie();

    if (!code || !stateParam || !cookieState || stateParam !== cookieState) {
      return albumRedirect(req, "invalid_state");
    }

    const verified = verifyOAuthState(stateParam);
    if (!verified || verified.personId !== ctx.personId) {
      return albumRedirect(req, "invalid_state");
    }

    const cfg = getGooglePhotosOAuthConfig({
      host: req.headers.get("host"),
      forwardedProto: req.headers.get("x-forwarded-proto"),
    });
    const deps = getGooglePhotosDeps();
    const exchanged = await deps.exchangeAuthorizationCode(cfg, code);

    // Reconnect: revoke the prior refresh token before overwriting the vault
    // (mirrors disconnectGooglePhotosAction — best-effort, never block upsert).
    const existing = await getActiveGooglePhotosConnection(db, ctx.personId);
    if (existing) {
      try {
        const oldPlain = decryptConnectionRefreshToken(existing);
        try {
          await deps.revokeToken(oldPlain);
        } catch {
          /* ignore revoke failures */
        }
      } catch {
        /* corrupt vault blob — still upsert the new token */
      }
    }

    await upsertGooglePhotosConnection(db, {
      personId: ctx.personId,
      refreshTokenPlain: exchanged.refreshToken,
      email: exchanged.email,
    });

    return albumRedirect(req);
  } catch (err) {
    console.error(
      "[google-photos/callback] unexpected error:",
      err instanceof Error ? err.message : "exchange_failed",
    );
    try {
      await clearOAuthStateCookie();
    } catch {
      /* ignore */
    }
    return albumRedirect(req, "exchange_failed");
  }
}
