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

/**
 * List PHOTO items only (skip video). Paginates until exhausted.
 * `skipped` counts VIDEO (or non-image) items the album import will not take.
 */
export async function listPickedPhotos(
  accessToken: string,
  sessionId: string,
  opts?: { fetch?: FetchLike },
): Promise<{ photos: PickedPhoto[]; skipped: number }> {
  const fetchImpl = resolveFetch(opts);
  const out: PickedPhoto[] = [];
  let skipped = 0;
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
      const mimeType = item.mediaFile?.mimeType;
      if (!item.id || !baseUrl || !mimeType) continue;
      out.push({
        id: item.id,
        mimeType,
        filename: item.mediaFile?.filename ?? null,
        baseUrl,
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return { photos: out, skipped };
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
