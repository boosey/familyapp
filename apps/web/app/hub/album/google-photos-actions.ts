"use server";

/**
 * Google Photos import server actions (ADR-0009 Phase 5 · Slice B).
 *
 * Connect-once: refresh token lives encrypted in `google_photos_connections`. Each import:
 *   1. startGooglePhotosImportAction → mint access token → createPickerSession → { sessionId, pickerUri }
 *   2. Client opens pickerUri; polls pollGooglePhotosImportAction until mediaItemsSet
 *   3. listGooglePhotosImportAction (list-first, ADR-0015 · F2) → exact-N token-gated handles, so the
 *      client can render exactly N placeholder tiles before any download begins → then
 *      importOneGooglePhotoAction ONE PER ITEM (download → EXIF → storage.put → createAlbumPhoto with
 *      source "google_picker", same family-id validation as uploadAlbumPhotoAction) through the client's
 *      bounded concurrency pool (`AlbumBoard`), so each item resolves — or fails with tap-to-retry —
 *      independently.
 *
 * Every action re-resolves auth on the server — identity is NEVER trusted from the client.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAlbumPhoto, listActiveFamiliesForPerson } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import {
  GooglePhotosOAuthError,
  GooglePhotosPickerError,
  parsePickerDurationMs,
  type PickedPhoto,
} from "@chronicle/photos-google";
import { getRuntime } from "@/lib/runtime";
import { warmThumbnail } from "@/lib/thumbnail";
import { extractPhotoExif, type PhotoExif } from "@/app/hub/album/exif";
import { hub } from "@/app/_copy";
import {
  getGooglePhotosDeps,
  getGooglePhotosOAuthConfig,
  isGooglePhotosConfigured,
} from "@/lib/google-photos-config";
import {
  decryptConnectionRefreshToken,
  disconnectGooglePhotosConnection,
  getActiveGooglePhotosConnection,
} from "@/lib/google-photos-connection";
import type {
  ImportOnePhotoResult,
  ListGooglePhotosImportResult,
} from "./import-progress";

export type GooglePhotosActionError = { error: string };
export type DisconnectResult = { ok: true } | GooglePhotosActionError;
export type StartImportResult =
  | {
      ok: true;
      sessionId: string;
      pickerUri: string;
      pollIntervalMs: number;
      pollTimeoutMs: number;
    }
  | GooglePhotosActionError;
export type PollImportResult =
  | { ok: true; mediaItemsSet: boolean }
  | GooglePhotosActionError;

type AppRuntime = Awaited<ReturnType<typeof getRuntime>>;

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60 * 1000;

function logGooglePhotosImportError(
  step: "start" | "poll" | "complete" | "token",
  err: unknown,
): void {
  if (err instanceof GooglePhotosOAuthError) {
    console.error(
      `[google-photos/import:${step}] OAuth error HTTP ${err.status}:`,
      err.responseBody || err.message,
    );
    return;
  }
  if (err instanceof GooglePhotosPickerError) {
    console.error(
      `[google-photos/import:${step}] Picker error HTTP ${err.status}:`,
      err.responseBody || err.message,
    );
    return;
  }
  console.error(
    `[google-photos/import:${step}] unexpected error:`,
    err instanceof Error ? err.message : String(err),
  );
}

function googlePhotosImportErrorFor(err: unknown): string {
  if (err instanceof GooglePhotosOAuthError) {
    return hub.album.googlePhotosReconnect;
  }
  return hub.album.googlePhotosImportFailed;
}

/** Safe, short error token for the UI — never include secrets or full stack traces. */
function sanitizeImportErrorDetail(err: unknown): string {
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: unknown }).name ?? "")
      : "";
  const message = err instanceof Error ? err.message : String(err);
  const raw = (name && name !== "Error" ? name : message.split(/[:\n]/)[0]) ?? "error";
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "").slice(0, 48);
  return safe || "error";
}

type AccountGate =
  | { ok: true; runtime: AppRuntime; personId: string }
  | { ok: false; error: string };

async function requireAccount(): Promise<AccountGate> {
  const runtime = await getRuntime();
  const ctx = await runtime.auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return { ok: false, error: hub.actions.notSignedIn };
  }
  return { ok: true, runtime, personId: ctx.personId };
}

type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string };

async function resolveAccessToken(
  personId: string,
  db: Database,
): Promise<AccessTokenResult> {
  const conn = await getActiveGooglePhotosConnection(db, personId);
  if (!conn) {
    return { ok: false, error: hub.album.googlePhotosNotConnected };
  }
  try {
    const refreshToken = decryptConnectionRefreshToken(conn);
    const cfg = getGooglePhotosOAuthConfig();
    const deps = getGooglePhotosDeps();
    const { accessToken } = await deps.refreshAccessToken(cfg, refreshToken);
    return { ok: true, accessToken };
  } catch (err) {
    logGooglePhotosImportError("token", err);
    return { ok: false, error: hub.album.googlePhotosReconnect };
  }
}

/** Resolve target family ids — identical rules to uploadAlbumPhotoAction. */
async function resolveFamilyIds(
  db: Database,
  personId: string,
  formData: FormData | null,
): Promise<{ familyIds: string[] } | { error: string }> {
  const active = await listActiveFamiliesForPerson(db, personId);
  if (active.length === 0) return { error: hub.actions.noFamily };
  const allowed = new Set(active.map((f) => f.familyId));
  const submitted = formData
    ? formData.getAll("familyIds").filter((v): v is string => typeof v === "string")
    : [];
  const chosen = [...new Set(submitted.filter((id) => allowed.has(id)))];
  if (chosen.length > 0) return { familyIds: chosen };
  if (allowed.size === 1) return { familyIds: [active[0]!.familyId] };
  return { error: hub.actions.noAlbumChosen };
}

export async function disconnectGooglePhotosAction(): Promise<DisconnectResult> {
  if (!isGooglePhotosConfigured()) {
    return { error: hub.album.googlePhotosUnavailable };
  }
  const gate = await requireAccount();
  if (!gate.ok) return { error: gate.error };

  const { db } = gate.runtime;
  const { refreshTokenPlain } = await disconnectGooglePhotosConnection(
    db,
    gate.personId,
  );
  if (refreshTokenPlain) {
    const deps = getGooglePhotosDeps();
    await deps.revokeToken(refreshTokenPlain);
  }
  revalidatePath("/hub");
  revalidatePath("/hub/album");
  return { ok: true };
}

export async function startGooglePhotosImportAction(): Promise<StartImportResult> {
  if (!isGooglePhotosConfigured()) {
    return { error: hub.album.googlePhotosUnavailable };
  }
  const gate = await requireAccount();
  if (!gate.ok) return { error: gate.error };

  try {
    const token = await resolveAccessToken(gate.personId, gate.runtime.db);
    if (!token.ok) return { error: token.error };
    const deps = getGooglePhotosDeps();
    const session = await deps.createPickerSession(token.accessToken);
    const pollIntervalMs =
      parsePickerDurationMs(session.pollingConfig?.pollInterval) ??
      DEFAULT_POLL_INTERVAL_MS;
    const pollTimeoutMs =
      parsePickerDurationMs(session.pollingConfig?.timeoutIn) ??
      DEFAULT_POLL_TIMEOUT_MS;
    return {
      ok: true,
      sessionId: session.id,
      pickerUri: session.pickerUri,
      pollIntervalMs,
      pollTimeoutMs,
    };
  } catch (err) {
    logGooglePhotosImportError("start", err);
    return { error: googlePhotosImportErrorFor(err) };
  }
}

export async function pollGooglePhotosImportAction(
  sessionId: string,
): Promise<PollImportResult> {
  if (!isGooglePhotosConfigured()) {
    return { error: hub.album.googlePhotosUnavailable };
  }
  if (typeof sessionId !== "string" || sessionId === "") {
    return { error: hub.actions.invalidInput };
  }
  const gate = await requireAccount();
  if (!gate.ok) return { error: gate.error };

  try {
    const token = await resolveAccessToken(gate.personId, gate.runtime.db);
    if (!token.ok) return { error: token.error };
    const deps = getGooglePhotosDeps();
    const session = await deps.getPickerSession(token.accessToken, sessionId);
    return { ok: true, mediaItemsSet: session.mediaItemsSet };
  } catch (err) {
    logGooglePhotosImportError("poll", err);
    return { error: googlePhotosImportErrorFor(err) };
  }
}

/**
 * The list-first half of the Google split (ADR-0015 · F2). Lists the picked items and returns exact-N
 * token-gated handles so the client can render exactly N placeholder tiles before any download begins.
 * `baseUrl` is useless without the server-held access token, so returning it is a token-gated handle,
 * not a credential leak. Count 0 is NOT an error — the client decides what to show.
 */
export async function listGooglePhotosImportAction(
  sessionId: string,
): Promise<ListGooglePhotosImportResult> {
  if (!isGooglePhotosConfigured()) {
    return { error: hub.album.googlePhotosUnavailable };
  }
  if (typeof sessionId !== "string" || sessionId === "") {
    return { error: hub.actions.invalidInput };
  }
  const gate = await requireAccount();
  if (!gate.ok) return { error: gate.error };

  try {
    const token = await resolveAccessToken(gate.personId, gate.runtime.db);
    if (!token.ok) return { error: token.error };
    const deps = getGooglePhotosDeps();
    const { photos, skipped, rejected } = await deps.listPickedPhotos(
      token.accessToken,
      sessionId,
    );
    const items = photos.map((p) => ({
      id: p.id,
      mimeType: p.mimeType,
      filename: p.filename,
      baseUrl: p.baseUrl,
    }));
    return { ok: true, count: items.length, items, skipped, rejected };
  } catch (err) {
    logGooglePhotosImportError("complete", err);
    return { error: googlePhotosImportErrorFor(err) };
  }
}

/**
 * The per-item half of the Google split (ADR-0015 · F2). Takes ONE token-gated handle (from
 * `listGooglePhotosImportAction`), re-resolves auth + re-validates family membership server-side
 * (identity and target are NEVER trusted), then downloads → EXIF → storage.put → createAlbumPhoto.
 * The client only ever passes the `baseUrl` handle; the server holds the access token — an access
 * token is never sent or accepted from the client.
 */
export async function importOneGooglePhotoAction(
  formData: FormData,
): Promise<ImportOnePhotoResult> {
  if (!isGooglePhotosConfigured()) {
    return { error: hub.album.googlePhotosUnavailable };
  }
  const gate = await requireAccount();
  if (!gate.ok) return { error: gate.error };

  const id = formData.get("id");
  const baseUrl = formData.get("baseUrl");
  if (
    typeof id !== "string" ||
    id === "" ||
    typeof baseUrl !== "string" ||
    baseUrl === ""
  ) {
    return { error: hub.actions.invalidInput };
  }
  const rawMime = formData.get("mimeType");
  const mimeType =
    typeof rawMime === "string" && rawMime !== "" ? rawMime : "image/jpeg";
  const rawFilename = formData.get("filename");
  const filename =
    typeof rawFilename === "string" && rawFilename !== "" ? rawFilename : null;

  const families = await resolveFamilyIds(
    gate.runtime.db,
    gate.personId,
    formData,
  );
  if ("error" in families) return { error: families.error };

  try {
    const token = await resolveAccessToken(gate.personId, gate.runtime.db);
    if (!token.ok) return { error: token.error };

    const deps = getGooglePhotosDeps();
    const handle: PickedPhoto = { id, mimeType, filename, baseUrl };
    const downloaded = await deps.downloadPickedPhoto(token.accessToken, handle);

    let exif: PhotoExif = { capturedAt: null, gps: null };
    try {
      exif = await extractPhotoExif(downloaded.bytes);
    } catch {
      /* never fail the import on EXIF */
    }
    const storageKey = `family-photos/${randomUUID()}`;
    await gate.runtime.storage.put({
      key: storageKey,
      bytes: downloaded.bytes,
      contentType: downloaded.contentType || mimeType || "application/octet-stream",
    });
    const photo = await createAlbumPhoto(gate.runtime.db, {
      contributorPersonId: gate.personId,
      familyIds: families.familyIds,
      source: "google_picker",
      storageKey,
      caption: null,
      exifCapturedAt: exif.capturedAt,
      exifGps: exif.gps,
    });
    // Warm the grid thumbnail from the bytes already downloaded (issue #139); best-effort.
    await warmThumbnail(gate.runtime.storage, storageKey, downloaded.bytes);

    revalidatePath("/hub/album");
    revalidatePath("/hub");
    // Return the new id so the board renders this tile optimistically (see uploadOneAlbumPhotoAction).
    return { ok: true, photoId: photo.id };
  } catch (err) {
    logGooglePhotosImportError("complete", err);
    // An OAuth failure means "reconnect"; any other per-item failure surfaces a sanitized detail.
    if (err instanceof GooglePhotosOAuthError) {
      return { error: googlePhotosImportErrorFor(err) };
    }
    return {
      error: hub.actions.photoUploadFailedDetail(sanitizeImportErrorDetail(err)),
    };
  }
}
