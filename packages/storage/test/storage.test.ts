import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FilesystemMediaStorage,
  InMemoryMediaStorage,
  ObjectAlreadyExistsError,
  type MediaStorage,
} from "../src/index";

const DEV_UPLOAD_BASE = "http://localhost:3000/api/media-upload";

function runContract(name: string, make: () => MediaStorage) {
  describe(name, () => {
    it("stores and retrieves bytes", async () => {
      const s = make();
      const bytes = new Uint8Array([1, 2, 3, 4]);
      await s.put({ key: "a/b.webm", bytes, contentType: "audio/webm" });
      expect(await s.exists("a/b.webm")).toBe(true);
      expect(Array.from((await s.getBytes("a/b.webm"))!)).toEqual([1, 2, 3, 4]);
    });

    it("returns null for a missing key", async () => {
      const s = make();
      expect(await s.getBytes("missing")).toBeNull();
      expect(await s.exists("missing")).toBe(false);
    });

    it("is write-once: refuses to overwrite the immutable canonical recording", async () => {
      const s = make();
      await s.put({
        key: "rec.webm",
        bytes: new Uint8Array([9]),
        contentType: "audio/webm",
      });
      await expect(
        s.put({
          key: "rec.webm",
          bytes: new Uint8Array([0]),
          contentType: "audio/webm",
        }),
      ).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
      // original bytes intact
      expect(Array.from((await s.getBytes("rec.webm"))!)).toEqual([9]);
    });

    it("produces a playback url", async () => {
      const s = make();
      await s.put({
        key: "x.webm",
        bytes: new Uint8Array([1]),
        contentType: "audio/webm",
      });
      expect(typeof (await s.getUrl("x.webm"))).toBe("string");
    });

    // issue #20 — the dev adapters can't presign, so createUploadTarget points at the injected dev
    // receiver base (`uploadBaseUrl`) with the key encoded as a single path segment + the content type.
    it("createUploadTarget points at the dev receiver base with the encoded key + content type", async () => {
      const s = make();
      const target = await s.createUploadTarget({
        key: "family-photos/abc-123",
        contentType: "image/jpeg",
      });
      expect(target.method).toBe("PUT");
      expect(target.url).toBe(`${DEV_UPLOAD_BASE}/family-photos%2Fabc-123`);
      expect(target.headers).toEqual({ "Content-Type": "image/jpeg" });
    });
  });
}

runContract(
  "InMemoryMediaStorage",
  () => new InMemoryMediaStorage({ uploadBaseUrl: DEV_UPLOAD_BASE }),
);
runContract(
  "FilesystemMediaStorage",
  () =>
    new FilesystemMediaStorage({
      baseDir: mkdtempSync(join(tmpdir(), "chronicle-store-")),
      uploadBaseUrl: DEV_UPLOAD_BASE,
    }),
);

// R2MediaStorage is exercised with a mocked S3 client in r2.test.ts.
