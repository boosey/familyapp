/**
 * AES-256-GCM envelope for the invite token crossing the `invite.send` job-payload boundary
 * (issue #103).
 *
 * WHY THIS EXISTS: Inngest persists event payloads durably (dashboard/logs, retention window),
 * so putting the raw invite token in the payload would leave a working invite credential in a
 * third-party store — weakening the standing "raw token is never persisted, only its SHA-256
 * hash" invariant (docs/DECISIONS.md). The dispatch seals the token with a server-held key
 * (`INVITE_TOKEN_ENC_KEY`) before enqueue; the worker opens it in memory to build the join
 * link. A leak of Inngest's store then yields only ciphertext — "leak ≠ working invite."
 *
 * Wire format (base64 of concatenated bytes): `iv (12) || authTag (16) || ciphertext` — the
 * SAME format `@chronicle/photos-google`'s token-crypto.ts uses for Google refresh tokens, so
 * the repo has one AES-256-GCM idiom. Never log plaintext or ciphertext — callers own that
 * discipline. The IV is random per seal: two seals of the same token differ (deliberate —
 * deterministic encryption would leak token equality across payloads).
 *
 * Key format: `INVITE_TOKEN_ENC_KEY` is a base64-encoded 32-byte key (e.g.
 * `openssl rand -base64 32`), exactly like GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export const INVITE_TOKEN_ENC_KEY_ENV = "INVITE_TOKEN_ENC_KEY";

function assertKey(keyBytes: Uint8Array): Buffer {
  if (keyBytes.byteLength !== KEY_LEN) {
    throw new Error(
      `sealInviteToken/openInviteToken: key must be ${KEY_LEN} bytes (got ${keyBytes.byteLength})`,
    );
  }
  return Buffer.from(keyBytes);
}

/** Seal plaintext token → base64(iv || tag || ciphertext). */
export function sealInviteToken(token: string, keyBytes: Uint8Array): string {
  const key = assertKey(keyBytes);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Open a blob produced by `sealInviteToken`. Throws on tamper / wrong key. */
export function openInviteToken(blob: string, keyBytes: Uint8Array): string {
  const key = assertKey(keyBytes);
  const raw = Buffer.from(blob, "base64");
  if (raw.byteLength < IV_LEN + TAG_LEN + 1) {
    throw new Error("openInviteToken: ciphertext too short");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Decode `INVITE_TOKEN_ENC_KEY` (base64) → 32-byte Buffer. Throws if missing or wrong length —
 * mirrors `getGooglePhotosEncryptionKey`. Required ONLY on the durable Inngest path: the inline
 * (Inngest-unconfigured) path never seals, so dev/CI needs no key. The boot-time enforcement
 * lives in `assertInngestServeable` (lib/inngest-config.ts).
 */
export function getInviteTokenEncKey(): Buffer {
  const raw = (process.env[INVITE_TOKEN_ENC_KEY_ENV] ?? "").trim();
  if (!raw) {
    throw new Error(
      `${INVITE_TOKEN_ENC_KEY_ENV} is missing. Set a base64-encoded 32-byte key ` +
        "(e.g. `openssl rand -base64 32`).",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.byteLength !== KEY_LEN) {
    throw new Error(
      `${INVITE_TOKEN_ENC_KEY_ENV} must decode to ${KEY_LEN} bytes (got ${key.byteLength}).`,
    );
  }
  return key;
}
