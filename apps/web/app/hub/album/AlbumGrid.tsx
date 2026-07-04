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

export interface AlbumGridPhoto {
  id: string;
  caption: string | null;
  canManage: boolean;
}

export function AlbumGrid({ photos }: { photos: AlbumGridPhoto[] }) {
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
