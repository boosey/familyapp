"use client";

/**
 * AlbumBoard (ADR-0015 · F2) — the client wrapper that OWNS per-item import progress. It is mounted
 * by `AlbumSurface` ONLY when the `isAlbumImportProgressEnabled()` flag is on, so the whole feature
 * lands dark: the flag-off path never renders this component.
 *
 * The board hands `AlbumUploader` an `onImportFiles` / `onImportGoogle` delegate (board mode). When
 * the contributor chooses files (or finishes the Google picker), the uploader stops self-driving the
 * batched action and calls the board, which:
 *   - creates one client-generated `tempId` + `importing` placeholder tile per photo, and
 *   - enqueues each as a `WorkItem` into a BOUNDED CONCURRENCY POOL (IMPORT_POOL_CONCURRENCY in
 *     flight), calling ONE per-item server action per photo.
 * Each tile resolves (removed + `router.refresh()` so the real photo appears) or fails (kept as a
 * tap-to-retry) independently. A live "X of N" counts successes against the active run's total; a
 * retry re-enqueues WITHOUT inflating N.
 *
 * The per-item actions re-resolve auth + re-validate family membership server-side — the board never
 * substitutes a client-side check, and it only ever passes a Google `baseUrl` handle (token-gated),
 * never an access token.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlbumUploader, type AlbumFamilyOption } from "./AlbumUploader";
import { AlbumGrid, type AlbumGridPhoto } from "./AlbumGrid";
import { uploadOneAlbumPhotoAction } from "./actions";
import {
  importOneGooglePhotoAction,
  listGooglePhotosImportAction,
} from "./google-photos-actions";
import { prepareAlbumPhoto } from "./prepare-photo";
import {
  IMPORT_POOL_CONCURRENCY,
  MAX_IMPORT_BATCH,
  type GooglePhotoImportHandle,
  type PendingTile,
  type PendingTileStatus,
} from "./import-progress";
import { hub } from "@/app/_copy";

/** The board's private retry payload for a tile — never handed to the grid. */
type WorkItem =
  | { kind: "upload"; file: File; familyIds: string[] }
  | { kind: "google"; handle: GooglePhotoImportHandle; familyIds: string[] };

interface Entry {
  tempId: string;
  status: PendingTileStatus;
  work: WorkItem;
  /** The created photo's server id — set when the entry transitions to `loaded`. */
  photoId?: string;
}

let seq = 0;
function nextTempId(): string {
  seq += 1;
  return `imp-${Date.now().toString(36)}-${seq}`;
}

export function AlbumBoard(props: {
  families: AlbumFamilyOption[];
  currentFamilyId: string;
  scope: string | null;
  showFileUpload: boolean;
  googlePhotosConfigured: boolean;
  googlePhotosConnected: boolean;
  googlePhotosEmail: string | null;
  googlePhotosOauthConnected: boolean;
  googlePhotosOauthError: string | null;
  photos: AlbumGridPhoto[];
}) {
  const router = useRouter();

  // Ordered pending entries (tile + private WorkItem), keyed by tempId. This is the single source of
  // truth for both the grid's placeholder tiles and the pool's retry lookup.
  const [entries, setEntries] = useState<Entry[]>([]);
  // A synchronous mirror of `entries` (state is async) — read by the pool retry lookup and by the
  // additive-run check below, both of which run outside React's render.
  const entriesRef = useRef<Entry[]>([]);
  entriesRef.current = entries;
  // Live progress for the ACTIVE run: total distinct items enqueued in the run; completed successes.
  // A retry re-enqueues an already-counted item, so it must not touch total. When no importing tile
  // remains we hide the line (and let the counts reset on the next fresh run).
  const [run, setRun] = useState<{ total: number; completed: number }>({
    total: 0,
    completed: 0,
  });
  // A board-level note (e.g. Google returned 0 items) or error (list step failed).
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The concurrency pool. `queue` holds the work waiting for a slot (the WorkItem travels WITH the
  // tempId so the pool never has to read back the async `entries` state); `active` counts in-flight.
  const queueRef = useRef<Array<{ tempId: string; work: WorkItem }>>([]);
  const activeRef = useRef(0);

  const setStatus = useCallback((tempId: string, status: PendingTileStatus) => {
    setEntries((prev) =>
      prev.map((e) => (e.tempId === tempId ? { ...e, status } : e)),
    );
  }, []);

  // Success: flip the tile to `loaded` carrying the real photo id. The tile does NOT disappear — it
  // renders the real bytes immediately (via `photoId`), so there is never a blank gap between the
  // spinner and the photo, and the tiles don't all pop at once when a coalesced refresh finally lands.
  const markLoaded = useCallback((tempId: string, photoId: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.tempId === tempId ? { ...e, status: "loaded", photoId } : e,
      ),
    );
  }, []);

  const removeEntry = useCallback((tempId: string) => {
    setEntries((prev) => prev.filter((e) => e.tempId !== tempId));
  }, []);

  // The families whose photos actually populate this grid (`props.photos`): the single scoped family,
  // or ALL active families in "all" scope. Only a photo landing in one of these will ever reappear in
  // a refreshed `props.photos` — so only an in-scope import can be reconciled.
  const viewedFamilyIds = useMemo(
    () =>
      props.scope && props.scope !== "all"
        ? new Set([props.scope])
        : new Set(props.families.map((f) => f.familyId)),
    [props.scope, props.families],
  );

  // Settle a successful import. When the target intersects the viewed scope (a solo contributor sends
  // NO family ids — the server defaults to the sole family, which IS the viewed one — so empty counts
  // as in-scope), keep the tile as an optimistic `loaded` photo that the refresh will reconcile. When
  // the target is entirely OUTSIDE the viewed scope, the photo will never appear in this grid, so the
  // placeholder would be stuck forever — drop it (the pre-optimistic behavior) instead.
  const settleSuccess = useCallback(
    (tempId: string, photoId: string, familyIds: string[]): void => {
      const inScope =
        familyIds.length === 0 || familyIds.some((id) => viewedFamilyIds.has(id));
      if (inScope) markLoaded(tempId, photoId);
      else removeEntry(tempId);
      setRun((r) => ({ ...r, completed: r.completed + 1 }));
      router.refresh();
    },
    [markLoaded, removeEntry, router, viewedFamilyIds],
  );

  // Run ONE work item. Never throws — a rejected action becomes a `failed` tile.
  const runOne = useCallback(
    async (tempId: string, work: WorkItem): Promise<void> => {
      try {
        if (work.kind === "upload") {
          const prepared = await prepareAlbumPhoto(work.file);
          if (!prepared.ok) {
            setStatus(tempId, "failed");
            return;
          }
          const fd = new FormData();
          fd.append("photo", prepared.file);
          for (const id of work.familyIds) fd.append("familyIds", id);
          const result = await uploadOneAlbumPhotoAction(fd);
          if ("error" in result) {
            setStatus(tempId, "failed");
            return;
          }
          // Show the real photo in place of the spinner immediately, then reconcile via refresh.
          settleSuccess(tempId, result.photoId, work.familyIds);
          return;
        } else {
          const fd = new FormData();
          fd.append("id", work.handle.id);
          fd.append("mimeType", work.handle.mimeType);
          fd.append("filename", work.handle.filename ?? "");
          fd.append("baseUrl", work.handle.baseUrl);
          for (const id of work.familyIds) fd.append("familyIds", id);
          const result = await importOneGooglePhotoAction(fd);
          if ("error" in result) {
            setStatus(tempId, "failed");
            return;
          }
          settleSuccess(tempId, result.photoId, work.familyIds);
          return;
        }
      } catch {
        // A thrown/rejected action must never crash the pool — mark this tile failed and move on.
        setStatus(tempId, "failed");
      }
    },
    [settleSuccess, setStatus],
  );

  // Drain the queue, keeping at most IMPORT_POOL_CONCURRENCY in flight. Called whenever work is
  // enqueued and after each item settles.
  const pump = useCallback((): void => {
    while (activeRef.current < IMPORT_POOL_CONCURRENCY && queueRef.current.length > 0) {
      const { tempId, work } = queueRef.current.shift()!;
      activeRef.current += 1;
      void runOne(tempId, work).finally(() => {
        activeRef.current -= 1;
        pump();
      });
    }
  }, [runOne]);

  const enqueue = useCallback(
    (tempId: string, work: WorkItem): void => {
      queueRef.current.push({ tempId, work });
      pump();
    },
    [pump],
  );

  // Begin a run of `added` fresh items. If a run is already draining (any tile still importing), the
  // counts ACCUMULATE — otherwise a second pick mid-import would reset `total` and the first run's
  // in-flight successes would push `completed` past the new (smaller) total ("3 of 2"). When idle we
  // start clean at `{ added, 0 }`.
  const startRun = useCallback((added: number): void => {
    const stillImporting = entriesRef.current.some((e) => e.status === "importing");
    setRun((r) =>
      stillImporting
        ? { total: r.total + added, completed: r.completed }
        : { total: added, completed: 0 },
    );
  }, []);

  const handleImportFiles = useCallback(
    (files: File[], familyIds: string[]): void => {
      setError(null);
      setNote(null);
      // Defensive cap (the uploader already guards): trim to MAX_IMPORT_BATCH and note it.
      let batch = files;
      if (batch.length > MAX_IMPORT_BATCH) {
        batch = batch.slice(0, MAX_IMPORT_BATCH);
        setNote(hub.actions.tooManyPhotos(MAX_IMPORT_BATCH));
      }
      if (batch.length === 0) return;

      const created: Entry[] = batch.map((file) => ({
        tempId: nextTempId(),
        status: "importing" as const,
        work: { kind: "upload", file, familyIds },
      }));
      startRun(batch.length);
      setEntries((prev) => [...created, ...prev]);
      for (const e of created) enqueue(e.tempId, e.work);
    },
    [enqueue, startRun],
  );

  const handleImportGoogle = useCallback(
    async (sessionId: string, familyIds: string[]): Promise<void> => {
      setError(null);
      setNote(null);
      const listed = await listGooglePhotosImportAction(sessionId);
      if ("error" in listed) {
        setError(listed.error);
        return;
      }
      if (listed.count === 0) {
        // Nothing came through (e.g. only videos, which the picker skips).
        setNote(hub.album.googlePhotosNothingImported);
        return;
      }
      // Same UX/resource guard as file upload (ADR-0015: the cap is client-side only; the per-item
      // action re-validates auth/membership server-side). Trim a very large picker selection and note it.
      let items = listed.items;
      if (items.length > MAX_IMPORT_BATCH) {
        items = items.slice(0, MAX_IMPORT_BATCH);
        setNote(hub.actions.tooManyPhotos(MAX_IMPORT_BATCH));
      }
      const created: Entry[] = items.map((handle) => ({
        tempId: nextTempId(),
        status: "importing" as const,
        work: { kind: "google", handle, familyIds },
      }));
      startRun(items.length);
      setEntries((prev) => [...created, ...prev]);
      for (const e of created) enqueue(e.tempId, e.work);
    },
    [enqueue, startRun],
  );

  // Retry needs the stored WorkItem for `tempId`; read it from `entriesRef` (entries state is async).
  const retry = useCallback(
    (tempId: string): void => {
      // Re-arm the tile and re-enqueue its stored WorkItem. Does NOT touch `run.total` (N never
      // inflates on a retry); a subsequent success still increments `completed`.
      const entry = entriesRef.current.find((e) => e.tempId === tempId);
      if (!entry) return;
      setStatus(tempId, "importing");
      enqueue(tempId, entry.work);
    },
    [enqueue, setStatus],
  );

  // Once a refresh reconciles a loaded tile — its `photoId` now appears in the server `photos` — the
  // real grid tile takes over, so the optimistic placeholder must drop to avoid a duplicate. Compute
  // the set of server-known ids once, hide already-reconciled loaded tiles from render, and prune them
  // from state so they don't accumulate.
  const serverIds = useMemo(
    () => new Set(props.photos.map((p) => p.id)),
    [props.photos],
  );
  const reconciled = useCallback(
    (e: Entry): boolean =>
      e.status === "loaded" && e.photoId !== undefined && serverIds.has(e.photoId),
    [serverIds],
  );
  useEffect(() => {
    setEntries((prev) => (prev.some(reconciled) ? prev.filter((e) => !reconciled(e)) : prev));
  }, [reconciled]);

  const tiles: PendingTile[] = entries
    .filter((e) => !reconciled(e))
    .map((e) => ({ tempId: e.tempId, status: e.status, photoId: e.photoId }));
  const importing = entries.some((e) => e.status === "importing");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AlbumUploader
        families={props.families}
        currentFamilyId={props.currentFamilyId}
        scope={props.scope}
        showFileUpload={props.showFileUpload}
        googlePhotosConfigured={props.googlePhotosConfigured}
        googlePhotosConnected={props.googlePhotosConnected}
        googlePhotosEmail={props.googlePhotosEmail}
        googlePhotosOauthConnected={props.googlePhotosOauthConnected}
        googlePhotosOauthError={props.googlePhotosOauthError}
        onImportFiles={handleImportFiles}
        onImportGoogle={(sessionId, familyIds) => void handleImportGoogle(sessionId, familyIds)}
      />

      {importing ? (
        <p
          role="status"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          {hub.album.importProgress(run.completed, run.total)}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--accent-strong)",
            background: "var(--accent-soft)",
            border: "var(--border-width) solid var(--accent)",
            borderRadius: "var(--radius-md)",
            padding: "12px 16px",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}

      {!importing && note ? (
        <p
          role="status"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          {note}
        </p>
      ) : null}

      {props.photos.length > 0 || tiles.length > 0 ? (
        <AlbumGrid
          photos={props.photos}
          pendingTiles={tiles}
          onRetryTile={retry}
        />
      ) : (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          {hub.album.empty}
        </p>
      )}
    </div>
  );
}
