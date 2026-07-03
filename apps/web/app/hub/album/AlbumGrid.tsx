"use client";

/**
 * Album grid (ADR-0009 caption · ADR-0008 delete · #18). Renders the family album's tiles and, for
 * photos the viewer may MANAGE (they are the contributor or a steward of the family on screen), a
 * per-tile caption editor and a two-tap delete. Every tile's bytes come from the audited auth route
 * (`/api/album-photo/[photoId]`), which re-checks read authorization on every request; the manage
 * controls call the `editAlbumCaptionAction` / `deleteAlbumPhotoAction` server actions, which
 * re-resolve auth and re-run the contributor/steward check server-side — the `canManage` flag only
 * decides whether to SHOW a control, never grants anything.
 *
 * Elder-friendly: generous touch targets, no native confirm()/alert() (a lightweight in-tile
 * "Delete → Tap again to remove" confirm instead), inline errors surfaced with role="alert".
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editAlbumCaptionAction, deleteAlbumPhotoAction } from "./actions";
import { hub } from "@/app/_copy";

export interface AlbumGridPhoto {
  id: string;
  caption: string | null;
  canManage: boolean;
}

export function AlbumGrid({ photos }: { photos: AlbumGridPhoto[] }) {
  return (
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
        <AlbumTile key={photo.id} photo={photo} />
      ))}
    </ul>
  );
}

function AlbumTile({ photo }: { photo: AlbumGridPhoto }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(photo.caption ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function saveCaption() {
    const formData = new FormData();
    formData.append("photoId", photo.id);
    formData.append("caption", draft);
    startTransition(async () => {
      const result = await editAlbumCaptionAction(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setEditing(false);
      router.refresh();
    });
  }

  function onDeleteTap() {
    // Two-tap confirm: the first tap arms; only the second actually deletes.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    const formData = new FormData();
    formData.append("photoId", photo.id);
    startTransition(async () => {
      const result = await deleteAlbumPhotoAction(formData);
      if ("error" in result) {
        setError(result.error);
        setConfirmingDelete(false);
        return;
      }
      // On success the tile disappears when the server component re-renders.
      router.refresh();
    });
  }

  return (
    <li style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- bytes are served by our audited auth
          route, not a static asset; next/image would proxy/optimize it. */}
      <img
        src={`/api/album-photo/${photo.id}`}
        alt={hub.album.photoAlt(photo.caption)}
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          objectFit: "cover",
          borderRadius: 8,
          display: "block",
          background: "var(--surface-sunken, #eee)",
        }}
      />

      {photo.canManage ? (
        <div
          aria-label={hub.album.managePhotoAria(photo.caption)}
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                type="text"
                aria-label={hub.album.captionLabel}
                placeholder={hub.album.captionPlaceholder}
                value={draft}
                disabled={pending}
                maxLength={500}
                onChange={(e) => setDraft(e.currentTarget.value)}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle, #ddd)",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={saveCaption}
                  disabled={pending}
                  style={manageButtonStyle(true, pending)}
                >
                  {hub.album.save}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(photo.caption ?? "");
                    setError(null);
                  }}
                  disabled={pending}
                  style={manageButtonStyle(false, pending)}
                >
                  {hub.album.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                textAlign: "left",
                padding: "6px 4px",
                border: "none",
                background: "transparent",
                color: photo.caption ? "var(--text-strong)" : "var(--text-meta)",
                cursor: pending ? "default" : "pointer",
              }}
            >
              {photo.caption ?? hub.album.addCaption}
            </button>
          )}

          <button
            type="button"
            onClick={onDeleteTap}
            disabled={pending}
            aria-pressed={confirmingDelete}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              alignSelf: "flex-start",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border-subtle, #ddd)",
              background: confirmingDelete
                ? "var(--surface-danger, #fbeaea)"
                : "var(--surface-raised, transparent)",
              color: "var(--text-danger, #b00)",
              cursor: pending ? "default" : "pointer",
            }}
          >
            {confirmingDelete ? hub.album.confirmDelete : hub.album.deletePhoto}
          </button>

          {error ? (
            <p
              role="alert"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                color: "var(--text-danger, #b00)",
                margin: 0,
              }}
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : photo.caption ? (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-strong)",
            margin: 0,
            padding: "6px 4px",
          }}
        >
          {photo.caption}
        </p>
      ) : null}
    </li>
  );
}

function manageButtonStyle(
  primary: boolean,
  pending: boolean,
): React.CSSProperties {
  return {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    padding: "8px 14px",
    borderRadius: 6,
    border: primary ? "none" : "1px solid var(--border-subtle, #ddd)",
    background: primary ? "var(--accent, #333)" : "transparent",
    color: primary ? "var(--on-accent, #fff)" : "var(--text-meta)",
    cursor: pending ? "default" : "pointer",
    opacity: pending ? 0.6 : 1,
  };
}
