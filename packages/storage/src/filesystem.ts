import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  ObjectAlreadyExistsError,
  type MediaStorage,
  type PutObjectInput,
} from "./index";

/**
 * Filesystem-backed store for local dev. Keys map to paths under `baseDir`. Write-once: refuses
 * to overwrite an existing object, matching the immutability contract.
 */
export class FilesystemMediaStorage implements MediaStorage {
  private readonly baseDir: string;
  private readonly publicBaseUrl: string;

  constructor(opts: { baseDir: string; publicBaseUrl?: string }) {
    this.baseDir = resolve(opts.baseDir);
    this.publicBaseUrl = opts.publicBaseUrl ?? "file://";
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

  /** Idempotent hard-delete. `force: true` makes a missing path a no-op (not an error). */
  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
