/**
 * Google Photos Picker API (fetch-only).
 *
 * Hosts locked by Phase 5 contract:
 * - sessions:   https://photospicker.googleapis.com/v1/sessions
 * - mediaItems: https://photospicker.googleapis.com/v1/mediaItems?sessionId=
 *
 * Download note (Picker baseUrl): Google requires appending `=d` to
 * `mediaFile.baseUrl` to fetch image bytes with EXIF (minus location). A bare
 * baseUrl is not a valid download URL. Requests still need
 * `Authorization: Bearer <accessToken>`. See:
 * https://developers.google.com/photos/picker/guides/media-items
 */

const SESSIONS_URL = "https://photospicker.googleapis.com/v1/sessions";
const MEDIA_ITEMS_URL = "https://photospicker.googleapis.com/v1/mediaItems";

export interface PickerSession {
  id: string;
  pickerUri: string;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}

export interface PickedPhoto {
  id: string;
  mimeType: string;
  filename: string | null;
  baseUrl: string;
}

/** Parse Google protobuf duration strings (e.g. `"5s"`, `"300.5s"`) → milliseconds. */
export function parsePickerDurationMs(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match?.[1]) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

/**
 * Web apps should open pickerUri with `/autoclose` so the Google Photos tab closes
 * after the user finishes selecting (and `mediaItemsSet` flips true).
 *
 * Only Google Photos picker hosts are accepted — callers must not open arbitrary URLs
 * returned from a compromised or malformed session response. The API lives on
 * `photospicker.googleapis.com`, but the user-facing `pickerUri` is typically
 * `https://photos.google.com/picker?...` (not the API host).
 */
const TRUSTED_PICKER_HOSTS = new Set([
  "photos.google.com",
  "www.photos.google.com",
  "photospicker.googleapis.com",
]);

export function pickerUriForWeb(pickerUri: string): string {
  let url: URL;
  try {
    url = new URL(pickerUri);
  } catch {
    throw new GooglePhotosPickerError(
      "pickerUri is not a valid URL",
      0,
      pickerUri,
    );
  }
  if (url.protocol !== "https:" || !TRUSTED_PICKER_HOSTS.has(url.hostname)) {
    throw new GooglePhotosPickerError(
      `pickerUri host is not a trusted Google Photos picker host (got ${url.hostname})`,
      0,
      pickerUri,
    );
  }
  // Append /autoclose on the path (preserve query string — session ids often live there).
  const path = url.pathname.replace(/\/+$/, "") || "/";
  url.pathname = path.endsWith("/autoclose") ? path : `${path}/autoclose`;
  url.hash = "";
  return url.toString();
}

export class GooglePhotosPickerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = "GooglePhotosPickerError";
  }
}

/** True when Google says the session is not ready for mediaItems.list yet. */
export function isPickerSessionNotReadyError(err: unknown): boolean {
  if (!(err instanceof GooglePhotosPickerError)) return false;
  if (err.status === 412) return true;
  return (
    err.responseBody.includes("FAILED_PRECONDITION") ||
    err.responseBody.includes("Failed precondition")
  );
}

const LIST_NOT_READY_MAX_ATTEMPTS = 8;
const LIST_NOT_READY_BASE_DELAY_MS = 750;

/**
 * List picked photos, retrying briefly when Google returns FAILED_PRECONDITION
 * (mediaItemsSet can flip true slightly before list is ready).
 */
export async function listPickedPhotosWhenReady(
  accessToken: string,
  sessionId: string,
  opts?: { fetch?: FetchLike },
): Promise<{ photos: PickedPhoto[]; skipped: number; rejected: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < LIST_NOT_READY_MAX_ATTEMPTS; attempt++) {
    try {
      return await listPickedPhotos(accessToken, sessionId, opts);
    } catch (err) {
      lastErr = err;
      if (
        !isPickerSessionNotReadyError(err) ||
        attempt === LIST_NOT_READY_MAX_ATTEMPTS - 1
      ) {
        throw err;
      }
      await sleep(LIST_NOT_READY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  throw lastErr;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type FetchLike = typeof fetch;

function resolveFetch(opts?: { fetch?: FetchLike }): FetchLike {
  return opts?.fetch ?? fetch;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function readJson(
  res: Response,
): Promise<{ text: string; json: unknown | null }> {
  const text = await safeReadBody(res);
  let json: unknown | null = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { text, json };
}

interface SessionApiResponse {
  id?: string;
  pickerUri?: string;
  mediaItemsSet?: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}

function mapSession(json: SessionApiResponse): PickerSession {
  if (!json.id || !json.pickerUri) {
    throw new GooglePhotosPickerError(
      "Picker session response missing id or pickerUri",
      200,
      JSON.stringify(json),
    );
  }
  const session: PickerSession = {
    id: json.id,
    pickerUri: json.pickerUri,
  };
  if (json.pollingConfig) {
    session.pollingConfig = json.pollingConfig;
  }
  return session;
}

/** Create a Picker session → `{ id, pickerUri }`. */
export async function createPickerSession(
  accessToken: string,
  opts?: { fetch?: FetchLike },
): Promise<PickerSession> {
  const fetchImpl = resolveFetch(opts);
  const res = await fetchImpl(SESSIONS_URL, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "content-type": "application/json",
    },
    body: "{}",
  });
  const { text, json } = await readJson(res);
  if (!res.ok || !json || typeof json !== "object") {
    throw new GooglePhotosPickerError(
      `createPickerSession failed: HTTP ${res.status}`,
      res.status,
      text,
    );
  }
  return mapSession(json as SessionApiResponse);
}

/** Poll a session until the client checks `mediaItemsSet`. */
export async function getPickerSession(
  accessToken: string,
  sessionId: string,
  opts?: { fetch?: FetchLike },
): Promise<PickerSession & { mediaItemsSet: boolean }> {
  const fetchImpl = resolveFetch(opts);
  const url = `${SESSIONS_URL}/${encodeURIComponent(sessionId)}`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  const { text, json } = await readJson(res);
  if (!res.ok || !json || typeof json !== "object") {
    throw new GooglePhotosPickerError(
      `getPickerSession failed: HTTP ${res.status}`,
      res.status,
      text,
    );
  }
  const body = json as SessionApiResponse;
  return {
    ...mapSession(body),
    mediaItemsSet: body.mediaItemsSet === true,
  };
}

interface MediaItemApi {
  id?: string;
  type?: string;
  mediaFile?: {
    baseUrl?: string;
    mimeType?: string;
    filename?: string;
  };
}

interface MediaItemsListResponse {
  mediaItems?: MediaItemApi[];
  nextPageToken?: string;
}

function isPhotoItem(item: MediaItemApi): boolean {
  if (item.type === "PHOTO") return true;
  if (item.type === "VIDEO") return false;
  const mime = item.mediaFile?.mimeType?.toLowerCase() ?? "";
  return mime.startsWith("image/");
}

function inferMimeFromFilename(filename: string | undefined | null): string | null {
  if (!filename) return null;
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
    case "heif":
      return "image/heic";
    default:
      return null;
  }
}

function resolvePhotoMimeType(item: MediaItemApi): string | null {
  const raw = item.mediaFile?.mimeType?.trim();
  if (raw) return raw;
  return inferMimeFromFilename(item.mediaFile?.filename ?? null);
}

/**
 * List PHOTO items only (skip video). Paginates until exhausted.
 * `skipped` counts VIDEO (or non-image) items the album import will not take.
 * `rejected` counts PHOTO-shaped items missing required fields (id/baseUrl).
 */
export async function listPickedPhotos(
  accessToken: string,
  sessionId: string,
  opts?: { fetch?: FetchLike },
): Promise<{ photos: PickedPhoto[]; skipped: number; rejected: number }> {
  const fetchImpl = resolveFetch(opts);
  const out: PickedPhoto[] = [];
  let skipped = 0;
  let rejected = 0;
  let pageToken: string | undefined;

  do {
    const url = new URL(MEDIA_ITEMS_URL);
    url.searchParams.set("sessionId", sessionId);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: authHeaders(accessToken),
    });
    const { text, json } = await readJson(res);
    if (!res.ok || !json || typeof json !== "object") {
      throw new GooglePhotosPickerError(
        `listPickedPhotos failed: HTTP ${res.status}`,
        res.status,
        text,
      );
    }
    const body = json as MediaItemsListResponse;
    for (const item of body.mediaItems ?? []) {
      if (!isPhotoItem(item)) {
        skipped += 1;
        continue;
      }
      const baseUrl = item.mediaFile?.baseUrl;
      const mimeType = resolvePhotoMimeType(item) ?? "image/jpeg";
      if (!item.id || !baseUrl) {
        rejected += 1;
        continue;
      }
      out.push({
        id: item.id,
        mimeType,
        filename: item.mediaFile?.filename ?? null,
        baseUrl,
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return { photos: out, skipped, rejected };
}

/**
 * Download bytes from a picked item's baseUrl.
 *
 * Appends `=d` per Picker docs so the response is a downloadable image with
 * EXIF (location stripped). Authorization: Bearer is still required.
 */
export async function downloadPickedPhoto(
  accessToken: string,
  item: PickedPhoto,
  opts?: { fetch?: FetchLike },
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const fetchImpl = resolveFetch(opts);
  // Picker baseUrl is not usable alone — must append `=d` (download) parameter.
  const downloadUrl = item.baseUrl.endsWith("=d")
    ? item.baseUrl
    : `${item.baseUrl}=d`;
  const res = await fetchImpl(downloadUrl, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    const text = await safeReadBody(res);
    throw new GooglePhotosPickerError(
      `downloadPickedPhoto failed: HTTP ${res.status}`,
      res.status,
      text,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const contentType =
    res.headers.get("content-type") ?? item.mimeType ?? "application/octet-stream";
  return { bytes: buf, contentType };
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}
