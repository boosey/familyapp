import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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

/**
 * Filesystem-backed store for local dev. Keys map to paths under `baseDir`. Write-once: refuses
 * to overwrite an existing object, matching the immutability contract.
 */
export class FilesystemMediaStorage implements MediaStorage {
  private readonly baseDir: string;
  private readonly publicBaseUrl: string;
  private readonly uploadBaseUrl: string | undefined;

  constructor(opts: { baseDir: string; publicBaseUrl?: string; uploadBaseUrl?: string }) {
    this.baseDir = resolve(opts.baseDir);
    this.publicBaseUrl = opts.publicBaseUrl ?? "file://";
    this.uploadBaseUrl = opts.uploadBaseUrl;
  }

  private pathFor(key: string): string {
    // Prevent path traversal out of baseDir.
    const full = resolve(join(this.baseDir, key));
    if (!full.startsWith(this.baseDir)) {
      throw new Error(`invalid storage key (path traversal): ${key}`);
    }
    return full;
  }

  async put({ key, bytes }: PutObjectInput): Promise<{ key: string }> {
    const path = this.pathFor(key);
    if (existsSync(path)) throw new ObjectAlreadyExistsError(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
    return { key };
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    const path = this.pathFor(key);
    if (!existsSync(path)) return null;
    return new Uint8Array(await readFile(path));
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.pathFor(key));
  }

  async getUrl(key: string): Promise<string> {
    return `${this.publicBaseUrl}/${key}`;
  }

  /**
   * Dev-only direct upload (issue #20). The filesystem store can't presign, so the target points at
   * the app's dev receiver route (`uploadBaseUrl`), which re-enforces auth + write-once server-side.
   * This exists purely so `next dev` exercises the exact prod request→PUT→record shape.
   */
  async createUploadTarget({
    key,
    contentType,
    expirySeconds,
  }: CreateUploadTargetInput): Promise<UploadTarget> {
    return devUploadTarget({
      uploadBaseUrl: this.uploadBaseUrl,
      key,
      contentType,
      expirySeconds: expirySeconds ?? UPLOAD_TARGET_EXPIRY_SECONDS,
    });
  }

  /** Idempotent hard-delete. `force: true` makes a missing path a no-op (not an error). */
  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /**
   * Walk `baseDir` and return every object under `prefix` (issue #90), stamped with the file's
   * mtime — for this store the mtime IS the write time (`put` is the only writer and write-once
   * means nothing ever modifies an existing object). A missing baseDir lists as empty.
   */
  async list({ prefix }: ListObjectsInput): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // directory doesn't exist (yet) ⇒ no objects under it
      }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          await walk(join(dir, e.name), childRel);
        } else if (childRel.startsWith(prefix)) {
          try {
            const s = await stat(join(dir, e.name));
            out.push({ key: childRel, lastModified: s.mtime });
          } catch {
            // Vanished between readdir and stat (concurrent sweep / manual cleanup) — skip it
            // rather than rejecting the whole listing and aborting the reaper's run.
          }
        }
      }
    };
    await walk(this.baseDir, "");
    return out;
  }
}
