/**
 * AES-256-GCM token vault for Google Photos refresh tokens.
 *
 * Wire format (base64 of concatenated bytes): `iv (12) || authTag (16) || ciphertext`.
 * Never log plaintext or ciphertext — callers own that discipline.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function assertKey(keyBytes: Uint8Array): Buffer {
  if (keyBytes.byteLength !== KEY_LEN) {
    throw new Error(
      `encryptToken/decryptToken: key must be ${KEY_LEN} bytes (got ${keyBytes.byteLength})`,
    );
  }
  return Buffer.from(keyBytes);
}

/** Encrypt plaintext → base64(iv || tag || ciphertext). */
export function encryptToken(plaintext: string, keyBytes: Uint8Array): string {
  const key = assertKey(keyBytes);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypt a blob produced by `encryptToken`. Throws on tamper / wrong key. */
export function decryptToken(blob: string, keyBytes: Uint8Array): string {
  const key = assertKey(keyBytes);
  const raw = Buffer.from(blob, "base64");
  if (raw.byteLength < IV_LEN + TAG_LEN + 1) {
    throw new Error("decryptToken: ciphertext too short");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}
