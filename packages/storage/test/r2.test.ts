/**
 * R2MediaStorage — adapter contract enforced against a mocked S3 client. No live network calls;
 * we cannot exercise a real R2 bucket from CI. The point of these tests is the boundary:
 *   - `put` sends a PutObjectCommand with `IfNoneMatch: "*"` (atomic write-once on the server).
 *   - 412 PreconditionFailed → `ObjectAlreadyExistsError` (mirrors the immutability contract).
 *   - `getBytes` / `exists` normalize 404 → `null` / `false`, not throws.
 *   - `getUrl` returns a presigned URL by default (Phase 1 stories are not publicly readable).
 */
import { Readable } from "node:stream";
import { sdkStreamMixin } from "@smithy/util-stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { ObjectAlreadyExistsError } from "../src/index";
import { R2MediaStorage, r2ClientConfig } from "../src/r2";

const s3Mock = mockClient(S3Client);

function makeStorage(opts?: { publicBaseUrl?: string; presignConditionalWrite?: boolean }) {
  return new R2MediaStorage({
    accountId: "acct",
    accessKeyId: "AKIA_TEST",
    secretAccessKey: "secret",
    bucket: "chronicle-media",
    ...(opts?.publicBaseUrl ? { publicBaseUrl: opts.publicBaseUrl } : {}),
    ...(opts?.presignConditionalWrite === undefined
      ? {}
      : { presignConditionalWrite: opts.presignConditionalWrite }),
    // Real client wired with test creds; aws-sdk-client-mock intercepts at the S3Client level
    // regardless of which instance sends commands.
    client: new S3Client({
      region: "auto",
      endpoint: "https://acct.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "AKIA_TEST", secretAccessKey: "secret" },
    }),
  });
}

function streamingBody(bytes: Uint8Array) {
  const stream = new Readable({
    read() {
      this.push(Buffer.from(bytes));
      this.push(null);
    },
  });
  return sdkStreamMixin(stream);
}

beforeEach(() => {
  s3Mock.reset();
});

describe("R2MediaStorage", () => {
  it("r2ClientConfig disables always-on checksums (R2 rejects CRC32 with 501)", () => {
    const cfg = r2ClientConfig({
      accountId: "acct",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
    });
    expect(cfg.requestChecksumCalculation).toBe("WHEN_REQUIRED");
    expect(cfg.responseChecksumValidation).toBe("WHEN_REQUIRED");
    expect(cfg.endpoint).toBe("https://acct.r2.cloudflarestorage.com");
  });

  it("put sends a PutObjectCommand with bytes, contentType, and IfNoneMatch: '*'", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = makeStorage();
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await storage.put({ key: "rec/abc.webm", bytes, contentType: "audio/webm" });

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls.length).toBe(1);
    const input = calls[0]!.args[0].input;
    expect(input.Bucket).toBe("chronicle-media");
    expect(input.Key).toBe("rec/abc.webm");
    expect(input.ContentType).toBe("audio/webm");
    expect(input.IfNoneMatch).toBe("*");
    expect(input.ContentLength).toBe(4);
    expect(Buffer.isBuffer(input.Body)).toBe(true);
    expect(Buffer.from(input.Body as Buffer)).toEqual(Buffer.from(bytes));
  });

  it("put → PreconditionFailed (by name) surfaces as ObjectAlreadyExistsError (write-once contract)", async () => {
    // Mock the error with `name` only — no `$metadata.httpStatusCode`. This pins the contract
    // that the adapter classifies on the SDK's error name, not on raw 412 status (which would
    // also fire for unrelated future If-Match preconditions).
    s3Mock.on(PutObjectCommand).rejects(
      Object.assign(new Error("precondition failed"), {
        name: "PreconditionFailed",
      }),
    );
    const storage = makeStorage();
    await expect(
      storage.put({
        key: "rec.webm",
        bytes: new Uint8Array([0]),
        contentType: "audio/webm",
      }),
    ).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
  });

  it("getBytes returns Uint8Array on success", async () => {
    const payload = new Uint8Array([9, 8, 7]);
    s3Mock.on(GetObjectCommand).resolves({ Body: streamingBody(payload) as never });
    const storage = makeStorage();
    const out = await storage.getBytes("k");
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([9, 8, 7]);
  });

  it("getBytes returns null on NoSuchKey (404, not a throw)", async () => {
    s3Mock.on(GetObjectCommand).rejects(
      Object.assign(new Error("no such key"), {
        name: "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      }),
    );
    const storage = makeStorage();
    expect(await storage.getBytes("missing")).toBeNull();
  });

  it("getBytes does NOT swallow 403 AccessDenied as null (only 404 maps to null)", async () => {
    // Regression guard: a permission error must surface, not look like "missing object" to
    // callers. The audited media route depends on this distinction — a swallowed 403 would
    // make missing-credential bugs invisible at the seam.
    s3Mock.on(GetObjectCommand).rejects(
      Object.assign(new Error("access denied"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      }),
    );
    const storage = makeStorage();
    await expect(storage.getBytes("forbidden")).rejects.toThrow(/access denied/i);
  });

  it("exists returns true when HeadObject succeeds", async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    const storage = makeStorage();
    expect(await storage.exists("k")).toBe(true);
  });

  it("exists returns false on NotFound (no throw)", async () => {
    s3Mock.on(HeadObjectCommand).rejects(
      Object.assign(new Error("not found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      }),
    );
    const storage = makeStorage();
    expect(await storage.exists("missing")).toBe(false);
  });

  it("getUrl defaults to a presigned URL (Phase 1 stories are not publicly readable)", async () => {
    const storage = makeStorage();
    const url = await storage.getUrl("a/b.webm");
    expect(url).toMatch(/^https:\/\/[a-z-]+\.acct\.r2\.cloudflarestorage\.com\//);
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=3600");
  });

  it("getUrl returns the public URL when publicBaseUrl is explicitly configured", async () => {
    const storage = makeStorage({ publicBaseUrl: "https://media.example" });
    expect(await storage.getUrl("a/b.webm")).toBe("https://media.example/a/b.webm");
  });

  // issue #20 — direct-to-storage upload. The presigned PUT binds the key + content type + write-once
  // precondition, and the returned headers are exactly what the client must replay.
  it("createUploadTarget presigns a PUT bound to the key, content type, and If-None-Match: '*'", async () => {
    const storage = makeStorage();
    const target = await storage.createUploadTarget({
      key: "family-photos/abc-123",
      contentType: "image/jpeg",
    });

    expect(target.method).toBe("PUT");
    // A presigned S3 URL at THIS bucket's R2 endpoint, carrying a signature + short expiry.
    expect(target.url).toMatch(/^https:\/\/[a-z-]+\.acct\.r2\.cloudflarestorage\.com\//);
    // The key is a real path (S3 does not percent-encode the slash in the object key).
    expect(target.url).toContain("/family-photos/abc-123?");
    expect(target.url).toContain("X-Amz-Signature=");
    expect(target.url).toContain("X-Amz-Expires=600");
    // The content-type + write-once precondition are folded into the signature (SignedHeaders).
    expect(target.url.toLowerCase()).toContain("content-type");
    expect(target.url.toLowerCase()).toContain("if-none-match");
    // The client must replay exactly these headers.
    expect(target.headers).toEqual({
      "Content-Type": "image/jpeg",
      "If-None-Match": "*",
    });
  });

  it("createUploadTarget honors an explicit expirySeconds", async () => {
    const storage = makeStorage();
    const target = await storage.createUploadTarget({
      key: "family-photos/x",
      contentType: "image/png",
      expirySeconds: 30,
    });
    expect(target.url).toContain("X-Amz-Expires=30");
  });

  // issue #20 escape hatch: with presignConditionalWrite=false, the write-once precondition is dropped
  // entirely — neither the header nor its signed-header entry appears (recoverable via env, no redeploy).
  it("createUploadTarget OMITS If-None-Match when presignConditionalWrite is false", async () => {
    const storage = makeStorage({ presignConditionalWrite: false });
    const target = await storage.createUploadTarget({
      key: "family-photos/x",
      contentType: "image/jpeg",
    });
    // Content type is still bound...
    expect(target.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(target.url.toLowerCase()).toContain("content-type");
    // ...but the write-once precondition is gone from both the headers and the signature.
    expect(target.headers["If-None-Match"]).toBeUndefined();
    expect(target.url.toLowerCase()).not.toContain("if-none-match");
  });

  it("createUploadTarget INCLUDES If-None-Match by default (conditional write ON)", async () => {
    const storage = makeStorage(); // default
    const target = await storage.createUploadTarget({
      key: "family-photos/x",
      contentType: "image/jpeg",
    });
    expect(target.headers["If-None-Match"]).toBe("*");
    expect(target.url.toLowerCase()).toContain("if-none-match");
  });
});
