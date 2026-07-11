"use client";

/**
 * Album grid (ADR-0009 caption · ADR-0008 delete · #18). Renders the family album's tiles. Each tile
 * is a BUTTON wrapping the photo: tapping it opens the `AlbumPhotoViewer` — a larger view that HOSTS
 * that photo's options (edit caption, two-tap delete). Per the album fixes contract the management
 * controls no longer live inline in the grid; the grid just owns which photo is open and mounts one
 * viewer for it. A small read-only caption sits under each captioned tile for at-a-glance context.
 *
 * Every tile's bytes come from the audited auth route (`/api/album-photo/[photoId]`), which re-checks
 * read authorization on every request. The viewer's options re-resolve auth and re-run the
 * contributor/steward check server-side — the `canManage` flag only decides whether the viewer SHOWS
 * a control, never grants anything.
 */
import { useState } from "react";
import { hub } from "@/app/_copy";
import { AlbumPhotoViewer } from "./AlbumPhotoViewer";
import type { PendingTile } from "./import-progress";

export interface AlbumGridPhoto {
  id: string;
  caption: string | null;
  canManage: boolean;
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
  // Which photo's viewer is open (by id — so a router.refresh() that drops the photo, e.g. after a
  // delete, cleanly unmounts the viewer when the id no longer resolves to a tile).
  const [openId, setOpenId] = useState<string | null>(null);
  const openPhoto = photos.find((p) => p.id === openId) ?? null;

  return (
    <>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0 0 24px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        {/* ADR-0015 · F2 — pending import placeholders sit at the TOP of the grid, sized like a real
            tile, and fill in (are removed) or fail (become tap-to-retry) independently. */}
        {pendingTiles.map((tile) => (
          <PendingImportTile
            key={`pending-${tile.tempId}`}
            tile={tile}
            onRetry={onRetryTile}
          />
        ))}
        {photos.map((photo) => (
          <AlbumTile key={photo.id} photo={photo} onOpen={() => setOpenId(photo.id)} />
        ))}
      </ul>

      {openPhoto ? (
        // `key` by photo id: opening a DIFFERENT photo while a viewer is mounted (reachable via
        // keyboard/programmatic focus) must REMOUNT a fresh viewer, resetting its local state
        // (armed two-tap delete, caption draft, …) — otherwise that state leaks onto the new photo.
        <AlbumPhotoViewer
          key={openPhoto.id}
          photo={openPhoto}
          onClose={() => setOpenId(null)}
        />
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

function AlbumTile({ photo, onOpen }: { photo: AlbumGridPhoto; onOpen: () => void }) {
  return (
    <li style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
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
            aspectRatio: "1 / 1",
            objectFit: "cover",
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
