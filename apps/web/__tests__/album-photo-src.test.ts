/**
 * Album-photo byte-route URL builder (issue #139). Pure, client-safe: no sharp, no runtime.
 */
import { describe, expect, it } from "vitest";
import {
  ALBUM_PHOTO_THUMB_VARIANT,
  ALBUM_PHOTO_VARIANT_PARAM,
  albumPhotoSrc,
} from "@/app/hub/album/photo-src";

describe("albumPhotoSrc", () => {
  it("returns the full-resolution route by default (unchanged historical shape)", () => {
    expect(albumPhotoSrc("ph1")).toBe("/api/album-photo/ph1");
    expect(albumPhotoSrc("ph1", {})).toBe("/api/album-photo/ph1");
    expect(albumPhotoSrc("ph1", { thumb: false })).toBe("/api/album-photo/ph1");
  });

  it("appends the thumb variant query when requested", () => {
    expect(albumPhotoSrc("ph1", { thumb: true })).toBe(
      `/api/album-photo/ph1?${ALBUM_PHOTO_VARIANT_PARAM}=${ALBUM_PHOTO_THUMB_VARIANT}`,
    );
    expect(albumPhotoSrc("ph1", { thumb: true })).toBe("/api/album-photo/ph1?variant=thumb");
  });
});
