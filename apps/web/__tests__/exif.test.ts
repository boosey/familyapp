/**
 * Unit tests for the EXIF-at-import helper (#17). The helper is a PURE, NEVER-THROWING reader over
 * the imported image bytes — its whole contract is "give me whatever capture-date + GPS you can read,
 * and if anything is missing, unreadable, or malformed, give me null instead of blowing up the
 * upload". So the cases below pin: EXIF present ⇒ populated; EXIF absent ⇒ null; garbage ⇒ null and
 * (critically) no throw/reject.
 *
 * FIXTURE — `JPEG_WITH_EXIF_B64` is a hand-built minimal JPEG (SOI + a single EXIF APP1 segment +
 * EOI) whose EXIF encodes:
 *   - DateTimeOriginal = "2015:06:15 14:30:00" (timezone-NAIVE — EXIF carries no offset; the helper
 *     interprets it as UTC, so the instant is deterministic regardless of the host TZ).
 *   - GPS = 37°48'30" N, 122°25'09" W  ⇒  lat +37.808333, lng -122.419167.
 * `PARTIAL_GPS_B64` is the same construction but its GPS block carries ONLY GPSLatitudeRef +
 * GPSLatitude (no longitude) — exifr then computes no lat/long pair, exercising the partial-GPS guard
 * (the date still parses). Both were built + verified to round-trip through exifr before being frozen
 * here. Keeping them as base64 constants means no binary in git and deterministic fixtures.
 */
import { describe, expect, it } from "vitest";
import { extractPhotoExif } from "@/app/hub/album/exif";

// SOI + EXIF APP1 (DateTimeOriginal + GPS lat/long) + EOI. See header for the encoded values.
const JPEG_WITH_EXIF_B64 =
  "/9j/4QC6RXhpZgAASUkqAAgAAAACAGmHBAABAAAAJgAAACWIBAABAAAATAAAAAAAAAABAAOQAgAUAAAAOAAAAAAAAAAyMDE1OjA2OjE1IDE0OjMwOjAwAAQAAQACAAIAAABOAAAAAgAFAAMAAACCAAAAAwACAAIAAABXAAAABAAFAAMAAACaAAAAAAAAACUAAAABAAAAMAAAAAEAAAAeAAAAAQAAAHoAAAABAAAAGQAAAAEAAAAJAAAAAQAAAP/Z";

// Same DateTimeOriginal, but a PARTIAL GPS block (GPSLatitudeRef + GPSLatitude only — no longitude).
const PARTIAL_GPS_B64 =
  "/9j/4QCKRXhpZgAASUkqAAgAAAACAGmHBAABAAAAJgAAACWIBAABAAAATAAAAAAAAAABAAOQAgAUAAAAOAAAAAAAAAAyMDE1OjA2OjE1IDE0OjMwOjAwAAIAAQACAAIAAABOAAAAAgAFAAMAAABqAAAAAAAAACUAAAABAAAAMAAAAAEAAAAeAAAAAQAAAP/Z";

const jpegWithExif = (): Uint8Array => new Uint8Array(Buffer.from(JPEG_WITH_EXIF_B64, "base64"));
const jpegPartialGps = (): Uint8Array => new Uint8Array(Buffer.from(PARTIAL_GPS_B64, "base64"));

describe("extractPhotoExif", () => {
  it("populates capturedAt + gps from a file that carries EXIF", async () => {
    const exif = await extractPhotoExif(jpegWithExif());

    // The tz-naive EXIF stamp is read as UTC, so the ABSOLUTE instant is deterministic — the same on
    // a UTC box and a US-Pacific box. (A local-TZ revive would make this assertion host-dependent.)
    expect(exif.capturedAt).toBeInstanceOf(Date);
    expect(exif.capturedAt!.toISOString()).toBe("2015-06-15T14:30:00.000Z");

    expect(exif.gps).not.toBeNull();
    expect(exif.gps!.lat).toBeCloseTo(37.808333, 5);
    expect(exif.gps!.lng).toBeCloseTo(-122.419167, 5);
  });

  it("yields gps:null (never {lat, NaN}) when only one GPS coordinate is present", async () => {
    const exif = await extractPhotoExif(jpegPartialGps());
    // The date still parses — proving the file's EXIF was read — but a half-populated GPS block must
    // not produce a bogus coordinate pair.
    expect(exif.capturedAt!.toISOString()).toBe("2015-06-15T14:30:00.000Z");
    expect(exif.gps).toBeNull();
  });

  it("returns nulls for a file with no EXIF (a bare JPEG: SOI + EOI, no APP1)", async () => {
    const bareJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const exif = await extractPhotoExif(bareJpeg);
    expect(exif).toEqual({ capturedAt: null, gps: null });
  });

  it("returns nulls for a PNG (a different container, no EXIF)", async () => {
    // The 8-byte PNG signature is enough for exifr to recognize the container and find no EXIF.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const exif = await extractPhotoExif(png);
    expect(exif).toEqual({ capturedAt: null, gps: null });
  });

  it("returns nulls WITHOUT throwing for malformed / truncated bytes", async () => {
    // A JPEG SOI followed by garbage — a truncated/corrupt file must never abort the upload.
    const truncated = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03, 0x04]);
    await expect(extractPhotoExif(truncated)).resolves.toEqual({
      capturedAt: null,
      gps: null,
    });
  });

  it("returns nulls WITHOUT throwing for empty bytes", async () => {
    await expect(extractPhotoExif(new Uint8Array([]))).resolves.toEqual({
      capturedAt: null,
      gps: null,
    });
  });
});
