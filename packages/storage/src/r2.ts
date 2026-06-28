/**
 * Cloudflare R2 adapter — the production `MediaStorage`. R2 speaks the S3 API, so this is an
 * @aws-sdk/client-s3 client pointed at `https://{accountId}.r2.cloudflarestorage.com` with
 * `region: "auto"`. The adapter mirrors the immutability contract enforced by the in-memory
 * and filesystem impls: `put` uses `IfNoneMatch: "*"` so the write-once check is atomic at the
 * server (R2 supports this S3 precondition), not racy client-side.
 *
 * NOTE on the vendor-SDK guard: `packages/pipeline/test/pipeline.test.ts` scans
 * `packages/storage/src` and forbids `@aws-sdk` imports. This file is the documented exception
 * (R2 is the named production default in `docs/DECISIONS.md`, and the storage interface
 * package is the right home per the original stub's design note). The pipeline guard excludes
 * this single filename — see the comment there.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectAlreadyExistsError,
  type MediaStorage,
  type PutObjectInput,
} from "./index";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * Optional public/CDN base URL. When set, `getUrl` returns `${publicBaseUrl}/${key}` instead
   * of a presigned URL. Phase 1 stories must be gated through the audited media route, so this
   * should be left unset in production unless the bucket is fronted by an authenticated worker.
   */
  publicBaseUrl?: string;
  /** Presigned GET URL expiry in seconds. Default: 3600 (1 hour). */
  presignExpirySeconds?: number;
  /** For tests: inject a pre-built S3 client. */
  client?: S3Client;
}

const DEFAULT_PRESIGN_EXPIRY_SECONDS = 3600;

export class R2MediaStorage implements MediaStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | undefined;
  private readonly presignExpirySeconds: number;

  constructor(config: R2Config) {
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl;
    this.presignExpirySeconds =
      config.presignExpirySeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS;
    if (config.client) {
      this.client = config.client;
    } else {
      const cfg: S3ClientConfig = {
        region: "auto",
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      };
      this.client = new S3Client(cfg);
    }
  }

  async put({ key, bytes, contentType }: PutObjectInput): Promise<{ key: string }> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          // Atomic write-once: server rejects with 412 if any object exists at this key.
          IfNoneMatch: "*",
        }),
      );
      return { key };
    } catch (err) {
      if (isPreconditionFailed(err)) throw new ObjectAlreadyExistsError(key);
      throw err;
    }
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) {
        // A 2xx GetObject with no Body is malformed, not "missing". `null` is reserved for the
        // 404/NoSuchKey path below — silently returning it here would mask SDK/server bugs.
        throw new Error(`GetObject for key "${key}" returned no body`);
      }
      // `Body` is typed as `StreamingBlobPayloadOutputTypes` (SDK applies the stream mixin
      // before handing the response back), so `transformToByteArray` is on the typed surface.
      return await res.Body.transformToByteArray();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async getUrl(key: string): Promise<string> {
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${key}`;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.presignExpirySeconds },
    );
  }

  /**
   * Idempotent hard-delete. S3/R2 `DeleteObject` returns success (204) for a missing key, so this
   * is naturally a no-op when the object is already gone. Only ever called for unreferenced draft
   * audio (the audited core path removes the DB row first).
   */
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

/** S3/R2 returns 404 NoSuchKey/NotFound for missing objects. Normalize to a single check. */
function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (e.name === "NoSuchKey" || e.name === "NotFound") return true;
  return e.$metadata?.httpStatusCode === 404;
}

/**
 * `IfNoneMatch: "*"` on an existing key returns 412 with `name === "PreconditionFailed"`.
 * We match on the name only — a raw httpStatusCode === 412 fallback would also swallow future
 * unrelated 412s (e.g. If-Match preconditions on copy/multipart), turning real errors into
 * spurious ObjectAlreadyExistsError. The SDK reliably populates `name` for this error class.
 */
function isPreconditionFailed(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string };
  return e.name === "PreconditionFailed";
}
