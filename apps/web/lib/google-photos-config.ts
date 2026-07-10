/**
 * Google Photos Picker config gate + injectable deps seam (ADR-0009 Phase 5).
 *
 * Mirrors `clerk-config.ts` / `inngest-config.ts`: a tiny module with no `server-only`, no DB,
 * so it can be unit-tested in isolation and imported from routes/actions. Unconfigured → Google
 * chrome stays hidden (file upload only).
 *
 * `getGooglePhotosDeps()` is the test seam: production returns the real `@chronicle/photos-google`
 * functions; tests override via `vi.mock("@/lib/google-photos-config", …)` or by replacing the
 * module-level `_depsOverride`.
 */
import {
  buildAuthorizeUrl,
  createPickerSession,
  downloadPickedPhoto,
  exchangeAuthorizationCode,
  getPickerSession,
  listPickedPhotosWhenReady,
  refreshAccessToken,
  revokeToken,
  type GooglePhotosOAuthConfig,
  type PickedPhoto,
  type PickerSession,
} from "@chronicle/photos-google";
import { resolvePublicOrigin } from "@/lib/public-origin";

const CLIENT_ID = "GOOGLE_PHOTOS_CLIENT_ID";
const CLIENT_SECRET = "GOOGLE_PHOTOS_CLIENT_SECRET";
const ENCRYPTION_KEY = "GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY";

/** True when all three required env vars are non-empty. */
export function isGooglePhotosConfigured(): boolean {
  return (
    (process.env[CLIENT_ID] ?? "").length > 0 &&
    (process.env[CLIENT_SECRET] ?? "").length > 0 &&
    (process.env[ENCRYPTION_KEY] ?? "").length > 0
  );
}

/**
 * Decode `GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY` (base64) → 32-byte Buffer.
 * Throws if missing or wrong length — callers should gate on `isGooglePhotosConfigured()` first.
 */
export function getGooglePhotosEncryptionKey(): Buffer {
  const raw = process.env[ENCRYPTION_KEY] ?? "";
  if (!raw) {
    throw new Error(
      "GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY is missing. Set a base64-encoded 32-byte key.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.byteLength !== 32) {
    throw new Error(
      `GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.byteLength}).`,
    );
  }
  return key;
}

/**
 * Resolve the OAuth redirect URI and client credentials.
 *
 * Prefer `APP_BASE_URL` / `NEXT_PUBLIC_APP_URL` (absolute origin) so the redirect matches the
 * Google Cloud Console registration regardless of which internal host served the request.
 * Falls back to request Host + x-forwarded-proto via `resolvePublicOrigin`.
 */
export function getGooglePhotosOAuthConfig(opts?: {
  host?: string | null;
  forwardedProto?: string | null;
}): GooglePhotosOAuthConfig {
  if (!isGooglePhotosConfigured()) {
    throw new Error(
      "Google Photos is not configured (need GOOGLE_PHOTOS_CLIENT_ID, " +
        "GOOGLE_PHOTOS_CLIENT_SECRET, GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY).",
    );
  }
  const configuredBase =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    undefined;
  const origin = resolvePublicOrigin({
    configuredBaseUrl: configuredBase,
    host: opts?.host,
    forwardedProto: opts?.forwardedProto,
    isProduction: process.env.NODE_ENV === "production",
  });
  return {
    clientId: process.env[CLIENT_ID]!,
    clientSecret: process.env[CLIENT_SECRET]!,
    redirectUri: `${origin}/api/google-photos/callback`,
  };
}

export type GooglePhotosFetch = typeof fetch;

export interface GooglePhotosDeps {
  buildAuthorizeUrl: typeof buildAuthorizeUrl;
  exchangeAuthorizationCode: (
    cfg: GooglePhotosOAuthConfig,
    code: string,
    opts?: { fetch?: GooglePhotosFetch },
  ) => Promise<{ refreshToken: string; accessToken: string; email: string | null }>;
  refreshAccessToken: (
    cfg: GooglePhotosOAuthConfig,
    refreshToken: string,
    opts?: { fetch?: GooglePhotosFetch },
  ) => Promise<{ accessToken: string; expiresIn?: number }>;
  revokeToken: (token: string, opts?: { fetch?: GooglePhotosFetch }) => Promise<void>;
  createPickerSession: (
    accessToken: string,
    opts?: { fetch?: GooglePhotosFetch },
  ) => Promise<PickerSession>;
  getPickerSession: (
    accessToken: string,
    sessionId: string,
    opts?: { fetch?: GooglePhotosFetch },
  ) => Promise<PickerSession & { mediaItemsSet: boolean }>;
  listPickedPhotos: (
    accessToken: string,
    sessionId: string,
    opts?: { fetch?: GooglePhotosFetch },
  ) => Promise<{ photos: PickedPhoto[]; skipped: number; rejected: number }>;
  downloadPickedPhoto: (
    accessToken: string,
    item: PickedPhoto,
    opts?: { fetch?: GooglePhotosFetch },
  ) => Promise<{ bytes: Uint8Array; contentType: string }>;
}

const realDeps: GooglePhotosDeps = {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
  createPickerSession,
  getPickerSession,
  listPickedPhotos: listPickedPhotosWhenReady,
  downloadPickedPhoto,
};

/** Test-only override; production always uses `realDeps`. */
let _depsOverride: GooglePhotosDeps | null = null;

/** Return the injectable Google Photos function set (real or test override). */
export function getGooglePhotosDeps(): GooglePhotosDeps {
  return _depsOverride ?? realDeps;
}

/** Test helper — swap the deps seam. Pass `null` to restore production. */
export function setGooglePhotosDepsForTests(deps: GooglePhotosDeps | null): void {
  _depsOverride = deps;
}
