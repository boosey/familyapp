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
  });
}

runContract("InMemoryMediaStorage", () => new InMemoryMediaStorage());
runContract(
  "FilesystemMediaStorage",
  () =>
    new FilesystemMediaStorage({
      baseDir: mkdtempSync(join(tmpdir(), "chronicle-store-")),
    }),
);

// R2MediaStorage is exercised with a mocked S3 client in r2.test.ts.
