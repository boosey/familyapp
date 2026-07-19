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
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { BuildMiddleware, MetadataBearer } from "@smithy/types";
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
  /**
   * Whether `createUploadTarget` presigns the write-once `IfNoneMatch: "*"` precondition (issue #20).
   * Default TRUE (atomic write-once at the server). This is an ESCAPE HATCH: if a live R2 bucket ever
   * rejects the presigned conditional-write, set this false to fall back to relying on the fresh-UUID
   * key alone — recoverable via env (`R2_PRESIGN_CONDITIONAL_WRITE=0`) with NO redeploy. When false,
   * neither `If-None-Match` nor its signed-header entry are included.
   */
  presignConditionalWrite?: boolean;
  /** For tests: inject a pre-built S3 client. */
  client?: S3Client;
}

const DEFAULT_PRESIGN_EXPIRY_SECONDS = 3600;

/**
 * S3 client options for Cloudflare R2.
 *
 * AWS SDK ≥3.729 defaults to always-on CRC32 checksums that R2 historically rejected with
 * 501 NotImplemented. Cloudflare's documented mitigation is WHEN_REQUIRED.
 * https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/
 */
export function r2ClientConfig(config: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3ClientConfig {
  return {
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
}

/**
 * Belt-and-suspenders: strip flexible-checksum headers some SDK paths still attach even with
 * WHEN_REQUIRED (notably certain delete/get paths). Must run in the build step before signing.
 */
export function attachR2ChecksumHeaderCompat(client: S3Client): void {
  const stripChecksumHeaders: BuildMiddleware<object, MetadataBearer> =
    (next) => async (args) => {
      const request = args.request as { headers?: Record<string, string> };
      if (request.headers) {
        for (const key of Object.keys(request.headers)) {
          const lower = key.toLowerCase();
          if (
            lower.startsWith("x-amz-checksum-") ||
            lower === "x-amz-sdk-checksum-algorithm" ||
            lower === "x-amz-checksum-mode"
          ) {
            delete request.headers[key];
          }
        }
      }
      return next(args);
    };

  client.middlewareStack.add(stripChecksumHeaders, {
    step: "build",
    name: "chronicleR2StripChecksumHeaders",
    priority: "low",
  });
}

export class R2MediaStorage implements MediaStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | undefined;
  private readonly presignExpirySeconds: number;
  private readonly presignConditionalWrite: boolean;

  constructor(config: R2Config) {
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl;
    this.presignExpirySeconds =
      config.presignExpirySeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS;
    this.presignConditionalWrite = config.presignConditionalWrite ?? true;
    if (config.client) {
      this.client = config.client;
    } else {
      this.client = new S3Client(r2ClientConfig(config));
      attachR2ChecksumHeaderCompat(this.client);
    }
  }

  async put({ key, bytes, contentType }: PutObjectInput): Promise<{ key: string }> {
    // Buffer + explicit ContentLength: Uint8Array bodies have hit flaky length/checksum paths
    // in newer AWS SDK releases against S3-compatible stores.
    const body = Buffer.from(bytes);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.byteLength,
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
   * Mint a presigned PUT the browser uploads DIRECTLY to R2 (issue #20). The presign binds:
   *   - the exact `Key` (the server-minted, fresh key — the client cannot upload elsewhere),
   *   - `ContentType` (so the stored object's type matches what was validated + presigned), and
   *   - `IfNoneMatch: "*"` — an ATOMIC write-once precondition (R2 supports it), so a client cannot
   *     overwrite an existing object even at this key. These become signed request headers, so the
   *     PUT is rejected (403 SignatureDoesNotMatch) if the client changes any of them.
   * Short expiry (UPLOAD_TARGET_EXPIRY_SECONDS) limits replay of a leaked URL.
   */
  async createUploadTarget({
    key,
    contentType,
    expirySeconds,
  }: CreateUploadTargetInput): Promise<UploadTarget> {
    const expiresIn = expirySeconds ?? UPLOAD_TARGET_EXPIRY_SECONDS;
    const conditional = this.presignConditionalWrite;
    const signableHeaders = new Set(
      conditional ? ["content-type", "if-none-match"] : ["content-type"],
    );
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        // Escape hatch: omit the write-once precondition entirely when conditional-write is off.
        ...(conditional ? { IfNoneMatch: "*" } : {}),
      }),
      { expiresIn, signableHeaders },
    );
    // The client MUST replay these exact headers — they were folded into the signature above.
    return {
      method: "PUT",
      url,
      headers: {
        "Content-Type": contentType,
        ...(conditional ? { "If-None-Match": "*" } : {}),
      },
    };
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

  /**
   * Enumerate every object under `prefix` (issue #90) via ListObjectsV2, following the
   * continuation token until the keyspace is exhausted (1000 objects/page). An entry with no
   * `LastModified` is stamped as just-written — an object R2 can't date must NEVER look stale
   * to the reaper's age window.
   */
  async list({ prefix }: ListObjectsInput): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        out.push({ key: obj.Key, lastModified: obj.LastModified ?? new Date() });
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
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
