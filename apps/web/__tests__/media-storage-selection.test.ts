/**
 * Regression tests for the production media-storage runtime switch (issue #1).
 *
 * `selectMediaStorage` is the PURE env→storage decision extracted from runtime.ts's `build()`
 * (which is hard to unit-test — it opens PGlite, etc.). The rules:
 *   - all four required R2 vars present & non-blank → R2MediaStorage
 *   - zero set → FilesystemMediaStorage (the dev/local default)
 *   - SOME (1-3 of 4) set → THROW: a partial prod config silently routed to the ephemeral
 *     filesystem store would lose every upload. Fail loud at boot instead.
 *
 * CRITICAL (single front door): the R2 store must be wired WITHOUT a publicBaseUrl so the only URL
 * it could ever emit is a presigned (signed, expiring) one — never a public CDN URL that would
 * bypass the audited /api/media/[id] byte route. We assert this BEHAVIORALLY: mock the S3Client,
 * call getUrl, and confirm the result carries `X-Amz-Signature=` (i.e. it presigned). No real
 * network calls are made.
 */
import { describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { FilesystemMediaStorage, R2MediaStorage } from "@chronicle/storage";
import { selectMediaStorage } from "../lib/runtime";

const FULL_R2 = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "AKIA_TEST",
  R2_SECRET_ACCESS_KEY: "secret_test",
  R2_BUCKET: "chronicle-media",
} as const;

const R2_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

describe("selectMediaStorage — production R2 vs dev filesystem", () => {
  it("returns an R2MediaStorage when all four R2 vars are present and non-empty", () => {
    expect(selectMediaStorage({ ...FULL_R2 })).toBeInstanceOf(R2MediaStorage);
  });

  it("presigns (no public CDN URL) — getUrl returns a signed URL, proving no publicBaseUrl leak", async () => {
    // Behavioral assertion (NOT a private-field read): had selectMediaStorage wired a
    // publicBaseUrl, getUrl would return `${publicBaseUrl}/${key}` with NO signature, bypassing the
    // audited media route. A presigned URL carries X-Amz-Signature. aws-sdk-client-mock intercepts
    // at the S3Client class level (every instance), so no real network call is made; presigning is
    // a local crypto operation over the request, so it still produces a real signature.
    const s3Mock = mockClient(S3Client);
    try {
      const storage = selectMediaStorage({ ...FULL_R2 });
      expect(storage).toBeInstanceOf(R2MediaStorage);
      const url = await storage.getUrl("rec/abc.webm");
      expect(url).toContain("X-Amz-Signature=");
      expect(url).toContain("X-Amz-Expires=");
      // Points at this account's R2 endpoint, not some publicBaseUrl host.
      expect(url).toContain("acct123.r2.cloudflarestorage.com");
    } finally {
      s3Mock.restore();
    }
  });

  it.each(R2_KEYS)("THROWS (partial config) when %s is missing and the others are set", (missing) => {
    const env: Record<string, string | undefined> = { ...FULL_R2 };
    delete env[missing];
    expect(() => selectMediaStorage(env)).toThrow(/Partial R2 configuration/);
  });

  it.each(R2_KEYS)("THROWS (partial config) when %s is empty and the others are set", (empty) => {
    const env: Record<string, string | undefined> = { ...FULL_R2, [empty]: "" };
    expect(() => selectMediaStorage(env)).toThrow(/Partial R2 configuration/);
  });

  it.each(R2_KEYS)(
    "THROWS (partial config) when %s is whitespace-only and the others are set",
    (blank) => {
      const env: Record<string, string | undefined> = { ...FULL_R2, [blank]: "   " };
      expect(() => selectMediaStorage(env)).toThrow(/Partial R2 configuration/);
    },
  );

  it("partial-config error names the missing vars and the all-or-none rule", () => {
    const env = {
      R2_ACCOUNT_ID: "acct123",
      R2_BUCKET: "chronicle-media",
    } as Record<string, string | undefined>;
    expect(() => selectMediaStorage(env)).toThrow(
      /2 of 4 set.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY.*Set all four or none/s,
    );
  });

  it("falls back to FilesystemMediaStorage when no R2 vars are set (local dev)", () => {
    expect(selectMediaStorage({})).toBeInstanceOf(FilesystemMediaStorage);
  });

  it("THROWS on Vercel when R2 is not configured (no read-only .media mkdir trap)", () => {
    expect(() => selectMediaStorage({ VERCEL: "1" })).toThrow(
      /Object storage required on Vercel\/production/,
    );
  });

  it("THROWS when DATABASE_URL is set but R2 is not (durable prod host)", () => {
    expect(() =>
      selectMediaStorage({ DATABASE_URL: "postgres://example" }),
    ).toThrow(/Object storage required on Vercel\/production/);
  });

  it("treats whitespace-only across ALL four as none → FilesystemMediaStorage (not partial, not R2)", () => {
    const env: Record<string, string | undefined> = {
      R2_ACCOUNT_ID: "  ",
      R2_ACCESS_KEY_ID: "\t",
      R2_SECRET_ACCESS_KEY: " ",
      R2_BUCKET: "   ",
    };
    expect(selectMediaStorage(env)).toBeInstanceOf(FilesystemMediaStorage);
  });
});
