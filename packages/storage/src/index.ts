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

export interface MediaStorage {
  /** Write bytes at `key`. MUST reject if the key already exists (write-once / immutable). */
  put(input: PutObjectInput): Promise<{ key: string }>;
  getBytes(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  /** A URL the browser can fetch for playback (a signed, expiring URL in production). */
  getUrl(key: string): Promise<string>;
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
