/**
 * MediaStorage — the swappable interface for the immutable audio object store.
 *
 * The `Media` table stores KEYS, never blobs; the bytes live here. This is a bought commodity
 * (Cloudflare R2 in production) behind a single interface, so no storage vendor SDK ever leaks
 * into the built IP (interviewer, consent, auth). Dev/test use the in-memory or filesystem impl;
 * the R2 adapter is a thin shell wired from env and not exercised until credentials exist.
 *
 * Object immutability is a contract here too: `put` must never overwrite an existing key (the
 * canonical recording is write-once), mirroring the DB-level media-immutability trigger.
 */
export interface PutObjectInput {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

/**
 * A one-shot, server-minted target the BROWSER uses to upload bytes DIRECTLY to object storage
 * (issue #20) — the bytes never transit a Server Action / serverless request body (Vercel caps that
 * at ~4.5 MB). The server mints a fresh, single key and produces this target; the client PUTs the
 * bytes to `url` with exactly `headers`. In production (R2) `url` is a presigned S3 URL scoped to
 * that one key with `If-None-Match: *` (atomic write-once); in dev (filesystem/in-memory) it points
 * at the dev receiver route, which re-enforces the same key/write-once/auth rules server-side.
 */
export interface UploadTarget {
  method: "PUT";
  url: string;
  /** The exact headers the client MUST send on the PUT (e.g. Content-Type, If-None-Match). */
  headers: Record<string, string>;
}

export interface CreateUploadTargetInput {
  /** The server-minted key the bytes will land at (write-once). */
  key: string;
  /** The image content type the client will send; bound into the presign so it can't be swapped. */
  contentType: string;
  /** How long the target stays valid. Adapters clamp to a short window; see UPLOAD_TARGET_EXPIRY_SECONDS. */
  expirySeconds?: number;
}

export interface MediaStorage {
  /** Write bytes at `key`. MUST reject if the key already exists (write-once / immutable). */
  put(input: PutObjectInput): Promise<{ key: string }>;
  getBytes(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  /** A URL the browser can fetch for playback (a signed, expiring URL in production). */
  getUrl(key: string): Promise<string>;
  /**
   * Mint a direct-to-storage upload target for a fresh, server-minted `key` (issue #20). The bytes
   * go browser → storage, never through our request body. Write-once is preserved: R2 presigns with
   * `If-None-Match: "*"`; the dev receiver re-checks `exists`.
   */
  createUploadTarget(input: CreateUploadTargetInput): Promise<UploadTarget>;
  /**
   * Hard-delete the object at `key`. Used ONLY for never-consented draft-audio cleanup
   * (re-record supersession + explicit discard — ADR-0002). The audited core path removes the
   * Media DB row FIRST, inside the transaction, so a delete here can only ever target an object
   * with no live reference. MUST be idempotent: deleting a missing key is a no-op (a leaked or
   * already-gone blob is harmless; a dangling row would not be — but the row is gone first).
   *
   * This does NOT weaken immutability: consented audio (any Media tied to a consent_records row,
   * or whose Story has one) is never routed here — the DB trigger raises on its DELETE regardless.
   */
  delete(key: string): Promise<void>;
}

/**
 * How long a direct-to-storage upload target stays valid (issue #20) — bounds BOTH the presign
 * lifetime and the HMAC ticket TTL. 10 minutes: short enough to limit replay of a leaked presigned
 * URL, long enough that a LARGE single photo on a slow uplink (the whole point of this feature) does
 * not time out mid-transfer. Single source of truth for every adapter + the ticket util.
 */
export const UPLOAD_TARGET_EXPIRY_SECONDS = 600;

/**
 * The image content types the album accepts for a direct upload (issue #20). The server validates
 * the client-declared contentType against this set BEFORE minting a presign, so a presigned target
 * (which binds Content-Type) can only ever be produced for an allowed image type. Single source of
 * truth shared by the request action and any client-side pre-check.
 */
export const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

/** True iff `contentType` is one of the album's accepted image types (issue #20). */
export function isAllowedImageContentType(
  contentType: string,
): contentType is AllowedImageContentType {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType);
}

export class ObjectAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`refusing to overwrite immutable object at key: ${key}`);
    this.name = "ObjectAlreadyExistsError";
  }
}

export { InMemoryMediaStorage } from "./in-memory";
export { FilesystemMediaStorage } from "./filesystem";
export { R2MediaStorage, type R2Config } from "./r2";
