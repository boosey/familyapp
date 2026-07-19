/**
 * Server-side thumbnail generation (issue #139): key derivation, real sharp downscale, and the
 * best-effort `warmThumbnail` store (idempotent + degrades on non-image bytes).
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { InMemoryMediaStorage } from "@chronicle/storage";
import {
  THUMBNAIL_CONTENT_TYPE,
  THUMBNAIL_MAX_EDGE_PX,
  generateThumbnailBytes,
  thumbnailStorageKey,
  warmThumbnail,
} from "@/lib/thumbnail";

/** A real, large-ish JPEG so the downscale actually has something to shrink. */
async function bigJpeg(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buf);
}

describe("thumbnailStorageKey", () => {
  it("derives a sibling key in the same keyspace", () => {
    expect(thumbnailStorageKey("family-photos/abc-123")).toBe("family-photos/abc-123.thumb");
  });
});

describe("generateThumbnailBytes", () => {
  it("clamps the longest edge to THUMBNAIL_MAX_EDGE_PX and re-encodes as JPEG, preserving aspect", async () => {
    const original = await bigJpeg(2000, 1200);
    const thumb = await generateThumbnailBytes(original);

    const meta = await sharp(Buffer.from(thumb)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(THUMBNAIL_MAX_EDGE_PX);
    // 2000x1200 → longest edge 480 → 480x288 (aspect preserved).
    expect(meta.width).toBe(480);
    expect(meta.height).toBe(288);
    // The whole point: the thumbnail is far smaller than the original.
    expect(thumb.byteLength).toBeLessThan(original.byteLength);
  });

  it("does not upscale an image already smaller than the box", async () => {
    const small = await bigJpeg(100, 80);
    const thumb = await generateThumbnailBytes(small);
    const meta = await sharp(Buffer.from(thumb)).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(80);
  });

  it("throws on bytes it cannot decode as an image", async () => {
    await expect(generateThumbnailBytes(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow();
  });
});

describe("warmThumbnail", () => {
  it("stores a JPEG thumbnail at the derived key and returns its bytes", async () => {
    const storage = new InMemoryMediaStorage();
    const key = "family-photos/one";
    const original = await bigJpeg(1600, 1600);
    await storage.put({ key, bytes: original, contentType: "image/jpeg" });

    const thumb = await warmThumbnail(storage, key, original);
    expect(thumb).not.toBeNull();

    const stored = await storage.getBytes(thumbnailStorageKey(key));
    expect(stored).not.toBeNull();
    expect(Array.from(stored!)).toEqual(Array.from(thumb!));
    const meta = await sharp(Buffer.from(stored!)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(THUMBNAIL_MAX_EDGE_PX);
  });

  it("is idempotent under a write-once store: a second warm still returns bytes, no throw", async () => {
    const storage = new InMemoryMediaStorage();
    const key = "family-photos/two";
    const original = await bigJpeg(1200, 900);
    await storage.put({ key, bytes: original, contentType: "image/jpeg" });

    const first = await warmThumbnail(storage, key, original);
    const second = await warmThumbnail(storage, key, original);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // Exactly one original + one thumbnail — the second warm did not create a duplicate.
    expect(storage.size).toBe(2);
  });

  it("returns null and stores a 0-byte sentinel for non-image bytes (never throws)", async () => {
    const storage = new InMemoryMediaStorage();
    const key = "family-photos/broken";
    const junk = new Uint8Array([9, 9, 9, 9]);
    await storage.put({ key, bytes: junk, contentType: "image/jpeg" });

    const thumb = await warmThumbnail(storage, key, junk);
    expect(thumb).toBeNull();
    // Sentinel (issue #176): the failure is cached so no later request re-runs sharp.
    const sentinel = await storage.getBytes(thumbnailStorageKey(key));
    expect(sentinel).not.toBeNull();
    expect(sentinel!.byteLength).toBe(0);
  });

  it("encodes with the declared thumbnail content type", () => {
    expect(THUMBNAIL_CONTENT_TYPE).toBe("image/jpeg");
  });
});
