"use server";

/**
 * Google Photos import server actions (ADR-0009 Phase 5 · Slice B).
 *
 * Connect-once: refresh token lives encrypted in `google_photos_connections`. Each import:
 *   1. startGooglePhotosImportAction → mint access token → createPickerSession → { sessionId, pickerUri }
 *   2. Client opens pickerUri; polls pollGooglePhotosImportAction until mediaItemsSet
 *   3. completeGooglePhotosImportAction → list → download → EXIF → storage.put → createAlbumPhoto
 *      with source "google_picker" (same family-id validation as uploadAlbumPhotoAction).
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
} from "@chronicle/photos-google";
import { getRuntime } from "@/lib/runtime";
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
export type CompleteImportResult =
  | { ok: true; added: number; failed: number; skipped: number }
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

export async function completeGooglePhotosImportAction(
  formData: FormData,
): Promise<CompleteImportResult> {
  if (!isGooglePhotosConfigured()) {
    return { error: hub.album.googlePhotosUnavailable };
  }
  const gate = await requireAccount();
  if (!gate.ok) return { error: gate.error };

  const sessionId = formData.get("sessionId");
  if (typeof sessionId !== "string" || sessionId === "") {
    return { error: hub.actions.invalidInput };
  }

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
    const { photos, skipped } = await deps.listPickedPhotos(
      token.accessToken,
      sessionId,
    );
    console.info(
      `[google-photos/import:complete] listed ${photos.length} photo(s), skipped ${skipped}`,
    );

    const { storage, db } = gate.runtime;
    let added = 0;
    let failed = 0;

    for (const item of photos) {
      try {
        const downloaded = await deps.downloadPickedPhoto(
          token.accessToken,
          item,
        );
        let exif: PhotoExif = { capturedAt: null, gps: null };
        try {
          exif = await extractPhotoExif(downloaded.bytes);
        } catch {
          /* never fail the import on EXIF */
        }
        const storageKey = `family-photos/${randomUUID()}`;
        await storage.put({
          key: storageKey,
          bytes: downloaded.bytes,
          contentType:
            downloaded.contentType || item.mimeType || "application/octet-stream",
        });
        await createAlbumPhoto(db, {
          contributorPersonId: gate.personId,
          familyIds: families.familyIds,
          source: "google_picker",
          storageKey,
          caption: null,
          exifCapturedAt: exif.capturedAt,
          exifGps: exif.gps,
        });
        added += 1;
      } catch (err) {
        failed += 1;
        if (failed === 1) {
          logGooglePhotosImportError("complete", err);
        }
      }
    }

    if (added > 0) {
      revalidatePath("/hub/album");
      revalidatePath("/hub");
    }
    if (added === 0 && photos.length > 0) {
      return { error: hub.actions.photoUploadFailed };
    }
    return { ok: true, added, failed, skipped };
  } catch (err) {
    logGooglePhotosImportError("complete", err);
    return { error: googlePhotosImportErrorFor(err) };
  }
}
