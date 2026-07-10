// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES, prepareAlbumPhoto } from "@/app/hub/album/prepare-photo";

describe("prepareAlbumPhoto", () => {
  it("passes through small JPEG files unchanged", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "p.jpg", {
      type: "image/jpeg",
    });
    const result = await prepareAlbumPhoto(file);
    expect(result).toEqual({ ok: true, file });
  });

  it("rejects HEIC before attempting canvas encode", async () => {
    const file = new File([new Uint8Array(10)], "p.heic", { type: "image/heic" });
    await expect(prepareAlbumPhoto(file)).resolves.toEqual({
      ok: false,
      error: "heic_unsupported",
    });
  });

  it("rejects oversized non-image blobs", async () => {
    const file = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "x.bin", {
      type: "application/octet-stream",
    });
    await expect(prepareAlbumPhoto(file)).resolves.toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("downscales an oversized image via canvas when createImageBitmap is available", async () => {
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1000)], "big.png", {
      type: "image/png",
    });
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4000, height: 3000, close })),
    );
    // jsdom canvas is limited — stub toBlob to return a small JPEG.
    const toBlob = vi.fn((cb: (b: Blob | null) => void) => {
      cb(new Blob([new Uint8Array(100)], { type: "image/jpeg" }));
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob as never);

    const result = await prepareAlbumPhoto(big);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.type).toBe("image/jpeg");
      expect(result.file.name).toBe("big.jpg");
      expect(result.file.size).toBe(100);
    }
    expect(close).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
