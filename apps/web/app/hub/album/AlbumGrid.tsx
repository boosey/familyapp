"use client";

/**
 * Album grid (ADR-0009 caption · ADR-0008 delete · #18 · album enhancements 2026-07-13). Renders the
 * family album's photos in one of THREE layouts (item 7 — Grid / Masonry / List), sized by a shared
 * thumbnail-size slider (item 8), with a per-thumbnail hover/focus mini-toolbar (item 2). Because both
 * callers funnel through this ONE client component — the flag-off `AlbumSurface` (`<AlbumGrid photos>`)
 * and the flag-on `AlbumBoard` (`<AlbumGrid photos pendingTiles onRetryTile>`) — all three affordances
 * land for free on both paths.
 *
 * Each tile/row is a BUTTON wrapping the photo: tapping it opens the `AlbumPhotoViewer` — a larger view
 * that HOSTS that photo's full options. The grid just owns which photo is open and mounts one viewer for
 * it. The hover toolbar overlays the shared compact `PhotoActionBar` at the top of a thumbnail; its
 * Delete runs `deleteAlbumPhotoAction` + `router.refresh()` here (the action re-checks auth server-side).
 *
 * Every tile's bytes come from the audited auth route (`/api/album-photo/[photoId]`), which re-checks
 * read authorization on every request. `canManage` only decides whether a control SHOWS, never grants.
 *
 * View + size are persisted to localStorage (SSR-guarded: only read/written inside effects on the
 * client), so the choice survives navigation and reload.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hub } from "@/app/_copy";
import { AlbumPhotoViewer } from "./AlbumPhotoViewer";
import { PhotoActionBar } from "./PhotoActionBar";
import { AlbumViewControls, THUMB_MIN, THUMB_MAX, type AlbumView } from "./AlbumViewControls";
import { AlbumListView } from "./AlbumListView";
import { deleteAlbumPhotoAction } from "./actions";
import type { PendingTile } from "./import-progress";

export interface AlbumGridPhoto {
  id: string;
  caption: string | null;
  canManage: boolean;
}

const VIEW_KEY = "album:view";
const THUMB_KEY = "album:thumbPx";
const DEFAULT_THUMB = 140;

function clampThumb(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_THUMB;
  return Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(px)));
}

function isView(v: string | null): v is AlbumView {
  return v === "grid" || v === "masonry" || v === "list";
}

export function AlbumGrid({
  photos,
  pendingTiles = [],
  onRetryTile,
}: {
  photos: AlbumGridPhoto[];
  /** ADR-0015 · F2 — in-flight/failed placeholder tiles rendered BEFORE the real photos. Default []
   *  so flag-off callers (which pass only `photos`) are unaffected. */
  pendingTiles?: PendingTile[];
  /** Called with a failed tile's `tempId` when its retry affordance is tapped. */
  onRetryTile?: (tempId: string) => void;
}) {
  const router = useRouter();

  // Which photo's viewer is open (by id — so a router.refresh() that drops the photo, e.g. after a
  // delete, cleanly unmounts the viewer when the id no longer resolves to a tile).
  const [openId, setOpenId] = useState<string | null>(null);
  const openPhoto = photos.find((p) => p.id === openId) ?? null;

  // Layout + thumbnail-size state. Start at the SSR-safe defaults (Grid / 140px) — never touch
  // localStorage during render — then hydrate the stored choice in a client-only effect below.
  const [view, setView] = useState<AlbumView>("grid");
  const [thumbPx, setThumbPx] = useState<number>(DEFAULT_THUMB);

  // Hydrate persisted choices on mount (client only). Guarded in a try/catch: a locked-down or
  // unavailable localStorage must never break the album.
  useEffect(() => {
    try {
      const storedView = window.localStorage.getItem(VIEW_KEY);
      if (isView(storedView)) setView(storedView);
      const storedThumb = window.localStorage.getItem(THUMB_KEY);
      if (storedThumb !== null) setThumbPx(clampThumb(Number(storedThumb)));
    } catch {
      /* localStorage unavailable — keep defaults. */
    }
  }, []);

  function changeView(v: AlbumView) {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore persistence failure */
    }
  }
  function changeThumb(px: number) {
    const next = clampThumb(px);
    setThumbPx(next);
    try {
      window.localStorage.setItem(THUMB_KEY, String(next));
    } catch {
      /* ignore persistence failure */
    }
  }

  // A transient per-photo delete error (kept minimal so it never blocks the grid). Keyed by photo id.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(photo: AlbumGridPhoto) {
    setDeleteError(null);
    try {
      const fd = new FormData();
      fd.append("photoId", photo.id);
      const result = await deleteAlbumPhotoAction(fd);
      if ("error" in result) {
        setDeleteError(hub.album.photoDeleteError);
        return;
      }
      if (openId === photo.id) setOpenId(null);
      router.refresh();
    } catch {
      setDeleteError(hub.album.photoDeleteError);
    }
  }

  return (
    <>
      <AlbumViewControls
        view={view}
        onView={changeView}
        thumbPx={thumbPx}
        onThumbPx={changeThumb}
      />

      {deleteError ? (
        <p
          role="alert"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--accent-strong)",
            margin: "0 0 12px",
          }}
        >
          {deleteError}
        </p>
      ) : null}

      {view === "list" ? (
        <AlbumListView
          photos={photos}
          thumbPx={thumbPx}
          onOpen={setOpenId}
          onDelete={handleDelete}
        />
      ) : view === "masonry" ? (
        // Masonry — CSS multi-column so images keep their NATURAL aspect ratio (not forced 1:1). Column
        // width tracks the slider; `break-inside: avoid` on each tile keeps a photo whole across columns.
        <ul
          data-view="masonry"
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0 0 24px",
            columnWidth: `${thumbPx}px`,
            columnGap: 12,
          }}
        >
          {pendingTiles.map((tile) => (
            <MasonryPendingTile key={`pending-${tile.tempId}`} tile={tile} onRetry={onRetryTile} />
          ))}
          {photos.map((photo) => (
            <AlbumTile
              key={photo.id}
              photo={photo}
              masonry
              onOpen={() => setOpenId(photo.id)}
              onDelete={() => handleDelete(photo)}
            />
          ))}
        </ul>
      ) : (
        // Grid — the CSS grid, tile min-width driven by the slider.
        <ul
          data-view="grid"
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0 0 24px",
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${thumbPx}px, 1fr))`,
            gap: 12,
          }}
        >
          {/* ADR-0015 · F2 — pending import placeholders sit at the TOP of the grid, sized like a real
              tile, and fill in (are removed) or fail (become tap-to-retry) independently. */}
          {pendingTiles.map((tile) => (
            <PendingImportTile key={`pending-${tile.tempId}`} tile={tile} onRetry={onRetryTile} />
          ))}
          {photos.map((photo) => (
            <AlbumTile
              key={photo.id}
              photo={photo}
              onOpen={() => setOpenId(photo.id)}
              onDelete={() => handleDelete(photo)}
            />
          ))}
        </ul>
      )}

      {openPhoto ? (
        // `key` by photo id: opening a DIFFERENT photo while a viewer is mounted (reachable via
        // keyboard/programmatic focus) must REMOUNT a fresh viewer, resetting its local state
        // (armed two-tap delete, caption draft, …) — otherwise that state leaks onto the new photo.
        <AlbumPhotoViewer key={openPhoto.id} photo={openPhoto} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

/** A same-sized placeholder tile for a photo being imported (ADR-0015 · F2). Quiet shimmer while
 *  `importing`; a tap-to-retry button while `failed`. Both are a 1:1 box matching a real tile. */
function PendingImportTile({
  tile,
  onRetry,
}: {
  tile: PendingTile;
  onRetry?: (tempId: string) => void;
}) {
  const boxStyle: React.CSSProperties = {
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: "var(--radius-sm)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--surface-sunken)",
  };

  // Row created (ADR-0015): show the real bytes in place of the spinner immediately — no blank gap,
  // no waiting on the coalesced server refresh. This transient tile isn't clickable; the next refresh
  // reconciles it into a full `AlbumTile` (the board then drops this placeholder).
  if (tile.status === "loaded" && tile.photoId) {
    return (
      <li style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- audited auth route, not a static asset. */}
        <img
          src={`/api/album-photo/${tile.photoId}`}
          alt={hub.album.photoAlt(null)}
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            objectFit: "cover",
            borderRadius: "var(--radius-sm)",
            display: "block",
            background: "var(--surface-sunken)",
          }}
        />
      </li>
    );
  }

  if (tile.status === "failed") {
    return (
      <li style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          type="button"
          onClick={() => onRetry?.(tile.tempId)}
          aria-label={hub.album.retryImportTile}
          style={{
            ...boxStyle,
            border: "var(--border-width) solid var(--accent)",
            color: "var(--accent-strong)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            cursor: "pointer",
          }}
        >
          {hub.album.retryImportTile}
        </button>
      </li>
    );
  }

  return (
    <li style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        role="img"
        aria-label={hub.album.importingTile}
        style={{
          ...boxStyle,
          border: "var(--border-width) solid var(--border)",
        }}
      >
        {/* A quiet, low-motion pulse — the accessible label carries the meaning for AT. */}
        <span
          aria-hidden="true"
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: "3px solid var(--border)",
            borderTopColor: "var(--accent)",
            animation: "album-import-spin 0.9s linear infinite",
          }}
        />
        <style>{"@keyframes album-import-spin{to{transform:rotate(360deg)}}"}</style>
      </div>
    </li>
  );
}

/** Masonry variant of a pending tile — same states, but `break-inside: avoid` so it stays whole in a
 *  column and a natural (square) box for the placeholder. */
function MasonryPendingTile({
  tile,
  onRetry,
}: {
  tile: PendingTile;
  onRetry?: (tempId: string) => void;
}) {
  return (
    <li style={{ margin: "0 0 12px", breakInside: "avoid", display: "block" }}>
      {tile.status === "loaded" && tile.photoId ? (
        // eslint-disable-next-line @next/next/no-img-element -- audited auth route, not a static asset.
        <img
          src={`/api/album-photo/${tile.photoId}`}
          alt={hub.album.photoAlt(null)}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface-sunken)",
          }}
        />
      ) : tile.status === "failed" ? (
        <button
          type="button"
          onClick={() => onRetry?.(tile.tempId)}
          aria-label={hub.album.retryImportTile}
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-sm)",
            border: "var(--border-width) solid var(--accent)",
            background: "var(--surface-sunken)",
            color: "var(--accent-strong)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            cursor: "pointer",
          }}
        >
          {hub.album.retryImportTile}
        </button>
      ) : (
        <div
          role="img"
          aria-label={hub.album.importingTile}
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-sm)",
            border: "var(--border-width) solid var(--border)",
            background: "var(--surface-sunken)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              border: "3px solid var(--border)",
              borderTopColor: "var(--accent)",
              animation: "album-import-spin 0.9s linear infinite",
            }}
          />
          <style>{"@keyframes album-import-spin{to{transform:rotate(360deg)}}"}</style>
        </div>
      )}
    </li>
  );
}

function AlbumTile({
  photo,
  masonry = false,
  onOpen,
  onDelete,
}: {
  photo: AlbumGridPhoto;
  /** Masonry layout: natural aspect ratio + break-inside guard (Grid forces a 1:1 box). */
  masonry?: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      // `position: relative` anchors the absolutely-positioned hover toolbar; `break-inside: avoid`
      // keeps a masonry tile whole across columns.
      style={{
        margin: masonry ? "0 0 12px" : 0,
        display: masonry ? "block" : "flex",
        flexDirection: "column",
        gap: 6,
        position: "relative",
        ...(masonry ? { breakInside: "avoid" as const } : {}),
      }}
    >
      {/* Hover/focus mini-toolbar (item 2): the shared compact PhotoActionBar overlaid at the TOP of the
          thumbnail, revealed on :hover and :focus-within so keyboard users can Tab into it. Pure CSS
          reveal (opacity + pointer-events) — no JS state to keep it accessible and flicker-free. It
          sits ABOVE the trigger button, so tapping an action never also fires the tile's open handler. */}
      <div className="album-tile-toolbar">
        <PhotoActionBar
          photo={photo}
          variant="compact"
          onEdit={onOpen}
          onDelete={onDelete}
        />
      </div>
      <style>{
        ".album-tile-toolbar{position:absolute;top:6px;left:6px;z-index:2;opacity:0;" +
          "pointer-events:none;transition:opacity 120ms ease}" +
          "li:hover>.album-tile-toolbar,li:focus-within>.album-tile-toolbar{opacity:1;pointer-events:auto}"
      }</style>

      {/* The whole image is the trigger — a button with an accessible label naming what it opens. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={hub.album.viewPhoto(photo.caption)}
        style={{
          padding: 0,
          border: "none",
          background: "transparent",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          display: "block",
          width: "100%",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- bytes are served by our audited auth
            route, not a static asset; next/image would proxy/optimize it. */}
        <img
          src={`/api/album-photo/${photo.id}`}
          alt={hub.album.photoAlt(photo.caption)}
          style={{
            width: "100%",
            // Masonry keeps the photo's natural aspect (catalog look); Grid forces a uniform 1:1 box.
            ...(masonry
              ? { height: "auto" as const }
              : { aspectRatio: "1 / 1" as const, objectFit: "cover" as const }),
            borderRadius: "var(--radius-sm)",
            display: "block",
            background: "var(--surface-sunken)",
          }}
        />
      </button>

      {/* Optional read-only caption for context; managing it happens inside the viewer. */}
      {photo.caption ? (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-body)",
            margin: 0,
            padding: "2px 4px",
          }}
        >
          {photo.caption}
        </p>
      ) : null}
    </li>
  );
}
