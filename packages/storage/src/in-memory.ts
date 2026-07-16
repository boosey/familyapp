import {
  ObjectAlreadyExistsError,
  UPLOAD_TARGET_EXPIRY_SECONDS,
  type CreateUploadTargetInput,
  type MediaStorage,
  type PutObjectInput,
  type UploadTarget,
} from "./index";
import { devUploadTarget } from "./dev-upload-target";

/** In-memory store for tests. Enforces write-once semantics like the real store. */
export class InMemoryMediaStorage implements MediaStorage {
  private readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string }
  >();
  private readonly uploadBaseUrl: string | undefined;

  constructor(opts: { uploadBaseUrl?: string } = {}) {
    this.uploadBaseUrl = opts.uploadBaseUrl;
  }

  async put({ key, bytes, contentType }: PutObjectInput): Promise<{ key: string }> {
    if (this.objects.has(key)) throw new ObjectAlreadyExistsError(key);
    // Copy so external mutation of the caller's buffer can't alter stored bytes.
    this.objects.set(key, { bytes: bytes.slice(), contentType });
    return { key };
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.bytes.slice() ?? null;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async getUrl(key: string): Promise<string> {
    return `memory://${key}`;
  }

  /**
   * Dev/test direct upload (issue #20). Like the filesystem store, the in-memory store can't presign,
   * so the target points at the dev receiver route (`uploadBaseUrl`), which re-enforces auth +
   * write-once. Defaults to a `memory://upload` base when no uploadBaseUrl is injected, so tests that
   * only assert the target SHAPE need no wiring.
   */
  async createUploadTarget({
    key,
    contentType,
    expirySeconds,
  }: CreateUploadTargetInput): Promise<UploadTarget> {
    return devUploadTarget({
      uploadBaseUrl: this.uploadBaseUrl ?? "memory://upload",
      key,
      contentType,
      expirySeconds: expirySeconds ?? UPLOAD_TARGET_EXPIRY_SECONDS,
    });
  }

  /** Idempotent hard-delete (write-once store still permits deleting an unreferenced draft). */
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Test/inspection helper — number of objects currently stored. */
  get size(): number {
    return this.objects.size;
  }
}
