/**
 * Seal/open for invite tokens (issue #116) — AES-256-GCM envelope encryption with a server-held
 * key. One durable link per pending invite means the raw token must be RECOVERABLE (re-delivery
 * over a second channel, the Inngest worker rebuilding the link) without ever storing it in
 * plaintext: only the SHA-256 hash and this sealed copy live in the DB, so a database leak yields
 * no working invite as long as the key stays out of the database.
 *
 * Key source: `INVITE_TOKEN_ENC_KEY` env (64 hex chars or 32-byte base64). When unset — the dev /
 * test default in this zero-config repo (see AGENTS.md) — a fixed, clearly-marked DEV-ONLY key is
 * used. Sealed tokens produced under the dev key are NOT protected; production must set the env var
 * (surfaced by apps/web's check-env deploy gate). Callers may inject a key explicitly for tests.
 *
 * Payload format: `v1.<base64url iv>.<base64url ciphertext>.<base64url authTag>` — versioned so a
 * future algorithm rotation can tell old rows apart.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32; // AES-256

/**
 * Fixed DEV/TEST-ONLY key, used when INVITE_TOKEN_ENC_KEY is unset so local dev and CI stay
 * zero-config. NOT SECRET — anything sealed under it is effectively plaintext. Never rely on it
 * outside dev/test.
 */
const DEV_ONLY_KEY = Buffer.from("dev-only-invite-token-key-000000", "utf8"); // exactly 32 bytes

export type SealKey = Buffer;

function decodeKey(raw: string): SealKey {
  const trimmed = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `INVITE_TOKEN_ENC_KEY must decode to ${KEY_BYTES} bytes (64 hex chars or base64), got ${buf.length}`,
    );
  }
  return buf;
}

/** The active seal key: the caller's, else the env var's, else the dev-only fallback. */
export function resolveSealKey(
  injected?: SealKey,
  env: NodeJS.ProcessEnv = process.env,
): SealKey {
  if (injected) return injected;
  const raw = env.INVITE_TOKEN_ENC_KEY;
  if (raw && raw.trim().length > 0) {
    return decodeKey(raw); // a malformed value throws here, at seal/open time — loud, not silent
  }
  return DEV_ONLY_KEY;
}

/** Seal a raw invite token for at-rest storage. */
export function sealToken(rawToken: string, key?: SealKey): string {
  const k = resolveSealKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ciphertext = Buffer.concat([cipher.update(rawToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/**
 * Open a sealed token, or return null when the payload is missing (rows predating #116) or
 * malformed/undecryptable under the active key — callers treat null as "cannot recover; rotate".
 */
export function openToken(sealed: string | null | undefined, key?: SealKey): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, ciphertext, tag] = parts as [string, string, string, string];
    const decipher = createDecipheriv(
      "aes-256-gcm",
      resolveSealKey(key),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null; // wrong key or corrupted payload — never throw on the recovery path
  }
}
