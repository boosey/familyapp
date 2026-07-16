"use client";

/**
 * AlbumListView (album enhancements 2026-07-13 · item 7, List) — the album's tabular layout. One
 * semantic <table> with five columns: Photo, Caption, Added by, Families, Tags. Each row activates the
 * viewer (the Photo thumbnail is the trigger button, matching the grid's tile-as-trigger pattern).
 *
 * The Photo thumbnail is sized by the shared `thumbPx` slider (item 8). A manageable row also carries a
 * compact `PhotoActionBar` in its actions cell (item 2's actions, adapted to the row).
 *
 * Phase C: the enriched `AlbumGridPhoto` now carries the contributor, families, and tags (subjects ∪
 * people ∪ places), so those three cells render real values (em-dash only when a facet is empty). In
 * selection mode a leading checkbox column appears and the Photo cell toggles selection instead of
 * opening the viewer.
 */
import { hub } from "@/app/_copy";
import type { AlbumGridPhoto } from "./AlbumGrid";
import { PhotoActionBar } from "./PhotoActionBar";

const EM_DASH = "—";

/** All tag names on a photo, in a stable order (subjects, then people, then places). */
function tagNames(photo: AlbumGridPhoto): string[] {
  return [
    ...(photo.subjects ?? []).map((s) => s.name),
    ...(photo.people ?? []).map((p) => p.name),
    ...(photo.places ?? []).map((p) => p.name),
  ];
}

export function AlbumListView({
  photos,
  thumbPx,
  onOpen,
  onDelete,
  selecting = false,
  selectedIds,
  onToggleSelected,
}: {
  photos: AlbumGridPhoto[];
  thumbPx: number;
  /** Open the viewer for a photo (row / thumbnail activate). */
  onOpen: (id: string) => void;
  /** Confirmed delete for a photo (PhotoActionBar owns the two-tap). */
  onDelete: (photo: AlbumGridPhoto) => void;
  /** Phase C selection mode: render a leading checkbox column; the Photo cell toggles instead of opens. */
  selecting?: boolean;
  selectedIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
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
            {selecting ? <th style={th} scope="col" aria-hidden="true" /> : null}
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
          {photos.map((photo) => {
            const families = (photo.families ?? []).map((f) => f.shortName || f.name);
            const tags = tagNames(photo);
            const selected = selectedIds?.has(photo.id) ?? false;
            return (
              <tr key={photo.id}>
                {selecting ? (
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleSelected?.(photo.id)}
                      aria-label={hub.album.selectPhotoAria(photo.caption)}
                      style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--accent)" }}
                    />
                  </td>
                ) : null}
                <td style={td}>
                  <button
                    type="button"
                    onClick={() =>
                      selecting ? onToggleSelected?.(photo.id) : onOpen(photo.id)
                    }
                    aria-label={
                      selecting
                        ? hub.album.selectPhotoAria(photo.caption)
                        : hub.album.viewPhoto(photo.caption)
                    }
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
                <td style={photo.contributorName ? td : { ...td, color: "var(--text-meta)" }}>
                  {photo.contributorName ? photo.contributorName : EM_DASH}
                </td>
                <td style={families.length > 0 ? td : { ...td, color: "var(--text-meta)" }}>
                  {families.length > 0 ? families.join(", ") : EM_DASH}
                </td>
                <td style={tags.length > 0 ? td : { ...td, color: "var(--text-meta)" }}>
                  {tags.length > 0 ? tags.join(", ") : EM_DASH}
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  {/* In selection mode the row's live actions are suppressed (mirrors the grid tile),
                      so a tap meant to toggle selection can't fire Delete/Ask/Tell instead. */}
                  {selecting ? null : (
                    <div style={{ display: "inline-flex", justifyContent: "flex-end" }}>
                      <PhotoActionBar
                        photo={photo}
                        variant="compact"
                        onEdit={() => onOpen(photo.id)}
                        onDelete={() => onDelete(photo)}
                      />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
