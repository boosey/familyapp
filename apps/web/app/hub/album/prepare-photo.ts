/**
 * Client-side photo prep before album upload.
 *
 * Vercel serverless request bodies are capped around ~4.5 MB. Phone photos are often larger, so
 * we downscale/re-encode oversized images to JPEG in the browser before the Server Action runs.
 * HEIC/HEIF usually cannot be decoded by canvas — those fail with a clear message.
 */

/** Stay under Vercel's ~4.5 MB body limit after FormData overhead. */
export const MAX_UPLOAD_BYTES = Math.floor(3.5 * 1024 * 1024);

const MAX_EDGE_PX = 2048;
const JPEG_QUALITY = 0.85;

export type PreparePhotoResult =
  | { ok: true; file: File }
  | { ok: false; error: "too_large" | "heic_unsupported" | "encode_failed" };

function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

/**
 * Return a File small enough for the album Server Action, or a typed failure.
 * Already-small non-HEIC images are returned unchanged.
 */
export async function prepareAlbumPhoto(file: File): Promise<PreparePhotoResult> {
  if (isHeic(file)) {
    return { ok: false, error: "heic_unsupported" };
  }
  if (!file.type.startsWith("image/")) {
    // Let the server reject non-images; don't invent a new client gate.
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "too_large" };
    return { ok: true, file };
  }
  if (file.size <= MAX_UPLOAD_BYTES) {
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
    if (blob.size > MAX_UPLOAD_BYTES) return { ok: false, error: "too_large" };

    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return {
      ok: true,
      file: new File([blob], `${base}.jpg`, { type: "image/jpeg" }),
    };
  } catch {
    return { ok: false, error: "encode_failed" };
  }
}
