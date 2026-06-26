import type { MediaStorage, PutObjectInput } from "./index";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public/base URL for playback (a custom domain or signed-URL endpoint). */
  publicBaseUrl: string;
}

/**
 * Cloudflare R2 adapter (production). STUB — intentionally not implemented in Phase 0/1.
 *
 * Wiring R2 requires an account, bucket, and credentials (real-world action that incurs cost),
 * which the kickoff mandate says to stub rather than provision. The shape is fixed so swapping it
 * in later is a drop-in: R2 speaks the S3 API, so the implementation is an @aws-sdk/client-s3
 * (or aws4fetch) call against the R2 endpoint — added here, behind this same interface, with zero
 * changes to the capture/pipeline code. See docs/OPEN-QUESTIONS.md.
 */
export class R2MediaStorage implements MediaStorage {
  constructor(private readonly config: R2Config) {}

  private notWired(): never {
    throw new Error(
      "R2MediaStorage is a Phase-0/1 stub: provision an R2 bucket + credentials and implement " +
        "the S3-compatible calls. Use InMemoryMediaStorage / FilesystemMediaStorage for dev/test.",
    );
  }

  async put(_input: PutObjectInput): Promise<{ key: string }> {
    return this.notWired();
  }
  async getBytes(_key: string): Promise<Uint8Array | null> {
    return this.notWired();
  }
  async exists(_key: string): Promise<boolean> {
    return this.notWired();
  }
  async getUrl(key: string): Promise<string> {
    // Safe to compute without network; everything else needs credentials.
    return `${this.config.publicBaseUrl}/${key}`;
  }
}
