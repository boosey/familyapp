import {
  ObjectAlreadyExistsError,
  UPLOAD_TARGET_EXPIRY_SECONDS,
  type CreateUploadTargetInput,
  type ListObjectsInput,
  type ListedObject,
  type MediaStorage,
  type PutObjectInput,
  type UploadTarget,
} from "./index";
import { devUploadTarget } from "./dev-upload-target";

/** In-memory store for tests. Enforces write-once semantics like the real store. */
export class InMemoryMediaStorage implements MediaStorage {
  private readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string; putAt: Date }
  >();
  private readonly uploadBaseUrl: string | undefined;
  private readonly now: () => Date;

  constructor(opts: { uploadBaseUrl?: string; now?: () => Date } = {}) {
    this.uploadBaseUrl = opts.uploadBaseUrl;
    // Injectable clock so tests can age objects through the reaper's (#90) safety window.
    this.now = opts.now ?? (() => new Date());
  }

  async put({ key, bytes, contentType }: PutObjectInput): Promise<{ key: string }> {
    if (this.objects.has(key)) throw new ObjectAlreadyExistsError(key);
    // Copy so external mutation of the caller's buffer can't alter stored bytes.
    this.objects.set(key, { bytes: bytes.slice(), contentType, putAt: this.now() });
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

  /** Enumerate objects under `prefix` (issue #90), stamped with their (clock-derived) put time. */
  async list({ prefix }: ListObjectsInput): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    for (const [key, o] of this.objects) {
      if (key.startsWith(prefix)) out.push({ key, lastModified: o.putAt });
    }
    return out;
  }

  /** Test/inspection helper — number of objects currently stored. */
  get size(): number {
    return this.objects.size;
  }
}
