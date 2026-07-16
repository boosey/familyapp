/**
 * HMAC-signed album upload ticket (issue #20).
 *
 * When the client requests a direct-to-storage upload target, the server also mints a short-lived,
 * stateless ticket binding the exact `{ key, personId, exp }`. The client echoes it back on
 * `recordAlbumPhotoAction` (and to the dev receiver route), and the server verifies the HMAC + expiry
 * + that the caller is the same Person who minted it and the key matches. This is what stops a caller
 * from driving `record`/the dev receiver with a FORGED or FOREIGN key: the key is bound into a
 * signature only the server can produce.
 *
 * Signing mirrors `google-photos-oauth-state.ts`: HMAC-SHA256 over `personId.key.exp`. The secret is
 * a dedicated `ALBUM_UPLOAD_TICKET_SECRET` when set; otherwise a documented DEV fallback so `pnpm dev`
 * / CI work with no secret to provision. Production MUST set the env (a real key surface on the single
 * front door) — the dev fallback is inert there because Vercel always sets the env.
 *
 * The ticket is NOT a capability to write bytes on its own — R2's presign is the write authority; the
 * ticket only re-binds key→minter so metadata (`record`) and the dev receiver can trust the key.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { UPLOAD_TARGET_EXPIRY_SECONDS } from "@chronicle/storage";

/**
 * Dev/CI fallback secret — deliberately fixed and NON-secret. It only signs a key→person binding that
 * is re-validated against real server state (memberships, object existence) on `record`, so a leaked
 * dev ticket grants nothing beyond what the caller already has. Production overrides via env.
 */
const DEV_FALLBACK_SECRET = "chronicle-dev-album-upload-ticket-secret";

function ticketSigningKey(): Buffer {
  const secret = process.env.ALBUM_UPLOAD_TICKET_SECRET?.trim();
  if (!secret && (process.env.DATABASE_URL || process.env.VERCEL)) {
    throw new Error("ALBUM_UPLOAD_TICKET_SECRET must be set in production");
  }
  const activeSecret = secret || DEV_FALLBACK_SECRET;
  // Derive a stable key from the secret string with a fixed label (same shape as the OAuth-state util).
  return createHmac("sha256", "chronicle-album-upload-ticket").update(activeSecret).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", ticketSigningKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.byteLength !== bb.byteLength) return false;
  return timingSafeEqual(ba, bb);
}

/** Mint a signed ticket `personId.key.exp.sig`. `key` is base64url-encoded so it carries no dots. */
export function createUploadTicket(
  input: { key: string; personId: string; ttlSeconds?: number },
  now = Date.now(),
): string {
  const ttl = (input.ttlSeconds ?? UPLOAD_TARGET_EXPIRY_SECONDS) * 1000;
  const exp = String(now + ttl);
  const keyEnc = Buffer.from(input.key).toString("base64url");
  const payload = `${input.personId}.${keyEnc}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a ticket. Returns the bound `{ key, personId }` on success, or null on tamper / expiry /
 * malformed shape. The caller MUST additionally check `personId === caller` and `key === expectedKey`
 * — this only proves the ticket was server-minted and is unexpired.
 */
export function verifyUploadTicket(
  ticket: string,
  now = Date.now(),
): { key: string; personId: string } | null {
  const parts = ticket.split(".");
  if (parts.length !== 4) return null;
  const [personId, keyEnc, expStr, sig] = parts;
  if (!personId || !keyEnc || !expStr || !sig) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || now > exp) return null;
  const payload = `${personId}.${keyEnc}.${expStr}`;
  if (!safeEqual(sig, sign(payload))) return null;
  let key: string;
  try {
    key = Buffer.from(keyEnc, "base64url").toString("utf8");
  } catch {
    return null;
  }
  return { key, personId };
}
