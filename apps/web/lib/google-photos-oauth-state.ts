/**
 * Signed OAuth state cookie for Google Photos connect (ADR-0009 Phase 5).
 *
 * HMAC-SHA256 over `personId.nonce.exp` using the token encryption key (or a dedicated
 * `GOOGLE_PHOTOS_OAUTH_STATE_SECRET` when set). Cookie is httpOnly + short TTL; the authorize
 * `state` query param carries the same signed payload so the callback can bind the round-trip
 * to the signed-in Person (CSRF + account mix-up guard).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getGooglePhotosEncryptionKey } from "@/lib/google-photos-config";

export const GOOGLE_PHOTOS_STATE_COOKIE = "chronicle_google_photos_oauth";

/** 10 minutes — enough for Google consent, short enough to limit replay. */
const STATE_TTL_MS = 10 * 60 * 1000;

function stateSigningKey(): Buffer {
  const dedicated = process.env.GOOGLE_PHOTOS_OAUTH_STATE_SECRET?.trim();
  if (dedicated) {
    // Derive a stable 32-byte key from the secret string (HMAC with a fixed label).
    return createHmac("sha256", "chronicle-google-photos-state").update(dedicated).digest();
  }
  return getGooglePhotosEncryptionKey();
}

function signPayload(payload: string): string {
  return createHmac("sha256", stateSigningKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.byteLength !== bb.byteLength) return false;
  return timingSafeEqual(ba, bb);
}

/** Build a signed state string: `personId.nonce.exp.sig` (base64url segments). */
export function createOAuthState(personId: string, now = Date.now()): string {
  const nonce = randomBytes(16).toString("base64url");
  const exp = String(now + STATE_TTL_MS);
  const payload = `${personId}.${nonce}.${exp}`;
  const sig = signPayload(payload);
  return `${payload}.${sig}`;
}

/**
 * Verify a state string. Returns the bound personId on success, null on tamper / expiry / shape.
 */
export function verifyOAuthState(
  state: string,
  now = Date.now(),
): { personId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [personId, nonce, expStr, sig] = parts;
  if (!personId || !nonce || !expStr || !sig) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || now > exp) return null;
  const payload = `${personId}.${nonce}.${expStr}`;
  const expected = signPayload(payload);
  if (!safeEqual(sig, expected)) return null;
  return { personId };
}

/** Set the httpOnly state cookie (same value as the authorize `state` param). */
export async function setOAuthStateCookie(state: string): Promise<void> {
  const jar = await cookies();
  jar.set(GOOGLE_PHOTOS_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
}

/** Read the state cookie (or null). */
export async function readOAuthStateCookie(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(GOOGLE_PHOTOS_STATE_COOKIE)?.value;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Clear the state cookie after callback (success or failure). */
export async function clearOAuthStateCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(GOOGLE_PHOTOS_STATE_COOKIE);
}
