/**
 * EXIF-at-import reader (ADR-0009 · #17). Given the SAME in-memory bytes the upload already read for
 * object storage, pull out the photo's capture-date and GPS so the Phase-4 suggestion ranker can use
 * them later. It reads only; it never touches the DB — the caller hands the returned values to
 * `createAlbumPhoto`, which is the one audited seam allowed near the guarded photo tables.
 *
 * The load-bearing contract is DEFENSIVE: EXIF is attacker-controlled, optional metadata on an
 * arbitrary uploaded file. Missing, unreadable, or malformed EXIF must yield NULL fields and MUST
 * NEVER fail the upload — so every path is wrapped so this function resolves, never rejects, and any
 * throw / undefined / bad value collapses to null for that field.
 *
 * TIMEZONE: EXIF capture timestamps are timezone-NAIVE wall-clock strings ("YYYY:MM:DD HH:MM:SS").
 * We interpret them as UTC, explicitly, so the stored instant is DETERMINISTIC regardless of the
 * server's local TZ. (exifr's default `reviveValues` revives them through the Node process's local
 * TZ, which would make the SAME photo store a different absolute instant on a UTC box vs a US-Pacific
 * box.) The value only feeds date-proximity ranking, where a consistent, environment-independent
 * instant matters more than guessing the photo's original local offset — so `reviveValues:false` +
 * an explicit UTC parse is the right trade. If a future EXIF carried an offset-aware Date, we prefer
 * it as-is (see `parseExifDate`).
 *
 * `exifr` is a pure parsing library (no network, no vendor account — like a date lib), so per the
 * vendor-seam rule it needs no mock seam and is imported directly. (This file lives in `apps/web`,
 * which the SDK-only-in-adapters architecture scan does not cover anyway.)
 */
import exifr from "exifr";

export interface PhotoExif {
  capturedAt: Date | null;
  gps: { lat: number; lng: number } | null;
}

const NONE: PhotoExif = { capturedAt: null, gps: null };

// EXIF wall-clock: "YYYY:MM:DD HH:MM:SS" (no timezone). All six fields are fixed-width and required.
const EXIF_DATETIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parse one EXIF timestamp into a deterministic instant. With `reviveValues:false` exifr hands these
 * back as raw strings, which we read as UTC (see the TIMEZONE note above). An already-Date value
 * (offset-aware) is trusted as-is. Anything unparseable / Invalid ⇒ null.
 */
function parseExifDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") return null;
  const m = EXIF_DATETIME.exec(value.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** GPS is set only when BOTH coordinates parsed to finite numbers (guards NaN / partial GPS). */
function coerceGps(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return { lat, lng };
  }
  return null;
}

/**
 * Read capture-date + GPS from an image's EXIF. Runs on the already-in-memory `bytes` (no second
 * round-trip that could diverge from what was stored). Never rejects: any failure ⇒ null fields.
 */
export async function extractPhotoExif(bytes: Uint8Array): Promise<PhotoExif> {
  try {
    // `reviveValues:false` keeps the date tags as raw wall-clock strings (so we can pin them to UTC
    // ourselves) WITHOUT losing GPS: exifr still computes the signed decimal `latitude`/`longitude`.
    // Returns undefined when the file carries no EXIF at all.
    const parsed = await exifr.parse(bytes, { reviveValues: false });
    if (!parsed) return NONE;

    // Prefer the moment the shutter fired; fall back through the other EXIF timestamps. (0x9004
    // DateTimeDigitized ⇒ exifr's `CreateDate`, 0x0132 DateTime ⇒ `ModifyDate`.)
    const capturedAt =
      parseExifDate(parsed.DateTimeOriginal) ??
      parseExifDate(parsed.CreateDate) ??
      parseExifDate(parsed.ModifyDate);

    return { capturedAt, gps: coerceGps(parsed.latitude, parsed.longitude) };
  } catch {
    // Malformed / truncated / unsupported bytes — swallow and report "no EXIF" rather than fail.
    return NONE;
  }
}
