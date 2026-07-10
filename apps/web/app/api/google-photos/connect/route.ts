/**
 * GET /api/google-photos/connect — start Google Photos OAuth (ADR-0009 Phase 5).
 *
 * Account-authed; sets a signed httpOnly state cookie binding the round-trip to the Person;
 * redirects to Google's authorize URL. Unconfigured → 503. Anonymous → redirect to sign-in.
 */
import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";
import {
  getGooglePhotosDeps,
  getGooglePhotosOAuthConfig,
  isGooglePhotosConfigured,
} from "@/lib/google-photos-config";
import {
  createOAuthState,
  setOAuthStateCookie,
} from "@/lib/google-photos-oauth-state";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  if (!isGooglePhotosConfigured()) {
    return NextResponse.json(
      { error: "Google Photos is not configured." },
      { status: 503 },
    );
  }

  const { auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const url = new URL(req.url);
  const cfg = getGooglePhotosOAuthConfig({
    host: req.headers.get("host"),
    forwardedProto: req.headers.get("x-forwarded-proto"),
  });
  const state = createOAuthState(ctx.personId);
  await setOAuthStateCookie(state);

  const deps = getGooglePhotosDeps();
  const authorizeUrl = deps.buildAuthorizeUrl(cfg, state);
  // Preserve any query we might want later; for now just redirect.
  void url;
  return NextResponse.redirect(authorizeUrl);
}
