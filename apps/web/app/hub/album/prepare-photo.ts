/**
 * Client-side photo prep before album upload.
 *
 * issue #20: bytes now go DIRECTLY to object storage, so Vercel's ~4.5 MB serverless body cap no
 * longer applies and there is no hard per-file SIZE limit. We still downscale/re-encode LARGE images
 * to JPEG in the browser — purely a bandwidth/UX courtesy (a full-res phone photo is many MB) — but a
 * photo that stays large after downscale is NO LONGER rejected; it just uploads as-is.
 * HEIC/HEIF usually cannot be decoded by canvas — those still fail with a clear message.
 */

/** Above this, downscale for bandwidth (NOT a hard limit — issue #20 removed the transport cap). */
export const DOWNSCALE_THRESHOLD_BYTES = Math.floor(3.5 * 1024 * 1024);

const MAX_EDGE_PX = 2048;
const JPEG_QUALITY = 0.85;

export type PreparePhotoResult =
  | { ok: true; file: File }
  | { ok: false; error: "heic_unsupported" | "encode_failed" };

function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

/**
 * Return a File ready for direct upload, or a typed failure. Already-small non-HEIC images (and any
 * non-image, which the server rejects by content type) are returned unchanged; a LARGE image is
 * downscaled/re-encoded to JPEG for bandwidth. Post-downscale size is no longer a rejection reason
 * (issue #20 removed the transport cap) — if canvas can't decode it (e.g. HEIC), that's the only
 * failure.
 */
export async function prepareAlbumPhoto(file: File): Promise<PreparePhotoResult> {
  if (isHeic(file)) {
    return { ok: false, error: "heic_unsupported" };
  }
  if (!file.type.startsWith("image/")) {
    // Let the server reject non-images (it validates content type before minting a target).
    return { ok: true, file };
  }
  if (file.size <= DOWNSCALE_THRESHOLD_BYTES) {
    return { ok: true, file };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { ok: false, error: "encode_failed" };
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) return { ok: false, error: "encode_failed" };

    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return {
      ok: true,
      file: new File([blob], `${base}.jpg`, { type: "image/jpeg" }),
    };
  } catch {
    return { ok: false, error: "encode_failed" };
  }
}
