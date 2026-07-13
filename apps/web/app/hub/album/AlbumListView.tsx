"use client";

/**
 * AlbumListView (album enhancements 2026-07-13 · item 7, List) — the album's tabular layout. One
 * semantic <table> with five columns: Photo, Caption, Added by, Families, Tags. Each row activates the
 * viewer (the Photo thumbnail is the trigger button, matching the grid's tile-as-trigger pattern).
 *
 * The Photo thumbnail is sized by the shared `thumbPx` slider (item 8). A manageable row also carries a
 * compact `PhotoActionBar` in its actions cell (item 2's actions, adapted to the row).
 *
 * NOTE (Phase B): the AlbumGridPhoto type does not yet carry uploader / families / tags, so those three
 * cells render an em-dash placeholder for now.
 */
import { hub } from "@/app/_copy";
import type { AlbumGridPhoto } from "./AlbumGrid";
import { PhotoActionBar } from "./PhotoActionBar";

const EM_DASH = "—";

export function AlbumListView({
  photos,
  thumbPx,
  onOpen,
  onDelete,
}: {
  photos: AlbumGridPhoto[];
  thumbPx: number;
  /** Open the viewer for a photo (row / thumbnail activate). */
  onOpen: (id: string) => void;
  /** Confirmed delete for a photo (PhotoActionBar owns the two-tap). */
  onDelete: (photo: AlbumGridPhoto) => void;
}) {
  // A modest thumbnail in a table cell — scale off the slider but clamp so rows stay readable.
  const cellThumb = Math.max(48, Math.round(thumbPx * 0.5));

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "8px 12px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    color: "var(--text-meta)",
    borderBottom: "var(--border-width) solid var(--border)",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "8px 12px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    color: "var(--text-body)",
    borderBottom: "var(--border-width) solid var(--border)",
    verticalAlign: "middle",
  };

  return (
    <div style={{ overflowX: "auto", margin: "0 0 24px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th} scope="col">
              {hub.album.listColPhoto}
            </th>
            <th style={th} scope="col">
              {hub.album.listColCaption}
            </th>
            <th style={th} scope="col">
              {hub.album.listColUploader}
            </th>
            <th style={th} scope="col">
              {hub.album.listColFamilies}
            </th>
            <th style={th} scope="col">
              {hub.album.listColTags}
            </th>
            {/* Actions column has no visible header (its controls are self-labeled). */}
            <th style={th} scope="col" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {photos.map((photo) => (
            <tr key={photo.id}>
              <td style={td}>
                <button
                  type="button"
                  onClick={() => onOpen(photo.id)}
                  aria-label={hub.album.viewPhoto(photo.caption)}
                  style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    display: "block",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- audited auth route, not a static asset. */}
                  <img
                    src={`/api/album-photo/${photo.id}`}
                    alt={hub.album.photoAlt(photo.caption)}
                    style={{
                      width: cellThumb,
                      height: cellThumb,
                      objectFit: "cover",
                      borderRadius: "var(--radius-sm)",
                      display: "block",
                      background: "var(--surface-sunken)",
                    }}
                  />
                </button>
              </td>
              <td style={td}>{photo.caption ? photo.caption : EM_DASH}</td>
              {/* TODO Phase B: populate uploader/families/tags (AlbumGridPhoto doesn't carry them yet). */}
              <td style={{ ...td, color: "var(--text-meta)" }}>{EM_DASH}</td>
              <td style={{ ...td, color: "var(--text-meta)" }}>{EM_DASH}</td>
              <td style={{ ...td, color: "var(--text-meta)" }}>{EM_DASH}</td>
              <td style={{ ...td, textAlign: "right" }}>
                <div style={{ display: "inline-flex", justifyContent: "flex-end" }}>
                  <PhotoActionBar
                    photo={photo}
                    variant="compact"
                    onEdit={() => onOpen(photo.id)}
                    onDelete={() => onDelete(photo)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
