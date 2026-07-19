"use client";

/**
 * Story ACCOMPANIMENT editor (ADR-0009 Phase 2) — the "Photos" section shown in the composer's
 * review phase AND in the story-detail consolidated editor. The draft owner can attach photos, set a
 * cover, remove, and reorder (elder-friendly — no drag). Images are off the consent ledger, so these
 * are plain mutations with no re-approval.
 *
 * Adding photos (spec 2026-07-13 — edit-story photo controls). The old always-on inline album grid is
 * gone; in its place two buttons:
 *   • "Add from album" opens a modal that BOTH lets the owner pick an existing album photo (tap to
 *     attach) AND upload new photos from the device (which land in the album and attach in one step).
 *   • "Add from Google" imports from Google Photos (into the owner's album, exactly as the album page
 *     does) and auto-attaches every imported photo to this story.
 * Both device upload and Google import reuse the album's existing per-item flows: device upload goes
 * through the album's direct-to-storage helper (`uploadPhotoDirect`, issue #20 — bytes go straight to
 * object storage, not through a Server Action), and Google import uses `importOneGooglePhotoAction`.
 * Each yields the new photo id, which we then hand to `attachStoryPhotoAction`. No new album/import
 * code paths are opened here.
 *
 * Self-contained: it fetches its own data via `loadStoryPhotoEditorAction(storyId)` on mount and
 * re-fetches after each mutation. Every mutation re-resolves auth + re-verifies draft ownership
 * SERVER-side; the storyId here only names WHICH story. Errors surface inline (no native dialogs).
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { FamilyChoiceChips } from "./FamilyChoiceChips";
import { prepareAlbumPhoto } from "./album/prepare-photo";
import {
  PHOTO_BATCH_MAX_FILES as MAX_BATCH_FILES,
  PHOTO_PICKER_POLL_INTERVAL_MS as PICKER_POLL_INTERVAL_MS,
  PHOTO_PICKER_POLL_TIMEOUT_MS as PICKER_POLL_TIMEOUT_MS,
} from "@/lib/constants";
import { pickerUriForWeb } from "@chronicle/photos-google/picker";
import { uploadPhotoDirect } from "./album/direct-upload";
import {
  startGooglePhotosImportAction,
  pollGooglePhotosImportAction,
  listGooglePhotosImportAction,
  importOneGooglePhotoAction,
} from "./album/google-photos-actions";
import {
  loadStoryPhotoEditorAction,
  attachStoryPhotoAction,
  detachStoryPhotoAction,
  setStoryCoverAction,
  reorderStoryPhotosAction,
  type EditorStoryImage,
  type EditorAlbumPhoto,
  type EditorPlacementFamily,
} from "./answer/[askId]/photo-actions";

type Nudge = { photoId: string; caption: string | null };

export function StoryPhotosEditor({
  storyId,
  autoAttachPhotoIds = [],
}: {
  storyId: string;
  /**
   * Phase C bulk "tell one story about these N photos": non-cover selected photo ids to attach to the
   * draft ONCE on mount, via the SAME `attachStoryPhotoAction` the manual picker uses. Ids already
   * attached (notably the cover) are skipped. The server re-checks read access per photo.
   */
  autoAttachPhotoIds?: string[];
}) {
  const [attached, setAttached] = useState<EditorStoryImage[]>([]);
  const [album, setAlbum] = useState<EditorAlbumPhoto[]>([]);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [dismissedNudge, setDismissedNudge] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Add-photo state (device + Google). Placement families are the owner's active albums; a device or
  // Google upload must land in at least one before it can be attached.
  const [families, setFamilies] = useState<EditorPlacementFamily[]>([]);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [placement, setPlacement] = useState<Set<string>>(new Set());
  const [addBusy, setAddBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await loadStoryPhotoEditorAction(storyId);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setError(null);
    setAttached(res.attached);
    setAlbum(res.album);
    setNudge(res.nudge);
    // The add-photo fields are additive; default them so a partial payload can never crash the editor.
    const fams = res.families ?? [];
    setFamilies(fams);
    setGoogleConfigured(res.googleConfigured ?? false);
    setGoogleConnected(res.googleConnected ?? false);
    // Seed the placement selection to the first album the first time families arrive (owners with a
    // single family never see the picker; the sole family is used). Never clobber an in-progress
    // selection on a reload.
    setPlacement((prev) => (prev.size > 0 || fams.length === 0 ? prev : new Set([fams[0]!.id])));
  }, [storyId]);

  useEffect(() => {
    void load().finally(() => setLoaded(true));
  }, [load]);

  // Escape closes the "Add photos" modal (never mid-upload, so a stray keypress can't abandon an
  // in-flight batch). Mirrors the click-outside guard on the overlay.
  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !addBusy && !pending) setModalOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen, addBusy, pending]);

  // Phase C: attach the bulk-selected non-cover photos ONCE, after the first load resolves so we can
  // dedup against what the story already carries. Reuses the manual attach path exactly.
  const autoAttachDoneRef = useRef(false);
  useEffect(() => {
    if (!loaded || autoAttachDoneRef.current) return;
    autoAttachDoneRef.current = true;
    if (autoAttachPhotoIds.length === 0) return;
    const alreadyAttached = new Set(attached.map((a) => a.familyPhotoId));
    const toAttach = [...new Set(autoAttachPhotoIds)].filter((id) => !alreadyAttached.has(id));
    if (toAttach.length === 0) return;
    startTransition(async () => {
      for (const familyPhotoId of toAttach) {
        const fd = new FormData();
        fd.set("storyId", storyId);
        fd.set("familyPhotoId", familyPhotoId);
        try {
          await attachStoryPhotoAction(fd);
        } catch {
          /* swallow — reconciled by the reload */
        }
      }
      await load();
    });
  }, [loaded, autoAttachPhotoIds, attached, storyId, load]);

  // Run one mutation, then re-load. A returned { error } surfaces inline and skips the reload.
  const run = useCallback(
    (action: () => Promise<{ ok: true } | { error: string }>) => {
      startTransition(async () => {
        try {
          const res = await action();
          if ("error" in res) {
            setError(res.error);
            return;
          }
          setError(null);
          await load();
        } catch {
          setError(hub.actions.photoUpdateFailed);
        }
      });
    },
    [load],
  );

  const attach = (familyPhotoId: string) =>
    run(() => {
      const fd = new FormData();
      fd.set("storyId", storyId);
      fd.set("familyPhotoId", familyPhotoId);
      return attachStoryPhotoAction(fd);
    });

  const detach = (storyImageId: string) =>
    run(() => {
      const fd = new FormData();
      fd.set("storyId", storyId);
      fd.set("storyImageId", storyImageId);
      return detachStoryPhotoAction(fd);
    });

  const setCover = (storyImageId: string) =>
    run(() => {
      const fd = new FormData();
      fd.set("storyId", storyId);
      fd.set("storyImageId", storyImageId);
      return setStoryCoverAction(fd);
    });

  // Move an attached image one slot earlier/later. The client computes the FULL new order.
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= attached.length) return;
    const order = attached.map((a) => a.storyImageId);
    const [moved] = order.splice(index, 1);
    order.splice(target, 0, moved!);
    run(() => {
      const fd = new FormData();
      fd.set("storyId", storyId);
      for (const id of order) fd.append("orderedStoryImageIds", id);
      return reorderStoryPhotosAction(fd);
    });
  };

  // ── Add photos ────────────────────────────────────────────────────────────
  // The albums a new device/Google photo lands in: the whole placement set when there is a choice
  // (>1 family), else the sole family (or none — the caller guards on families.length).
  const placementIds = (): string[] =>
    families.length > 1 ? [...placement] : families.map((f) => f.id);

  const togglePlacement = (familyId: string) =>
    setPlacement((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });

  const canPlace = families.length > 0 && (families.length === 1 || placement.size > 0);

  function openDevicePicker() {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }

  // Upload the chosen device files into the album, then attach each new photo to the story. Runs one
  // photo at a time through the per-item album action (each returns the new id) so a single bad file
  // never aborts the batch; a final reload reconciles what actually landed.
  async function onDeviceFilesChosen(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    if (fileList.length > MAX_BATCH_FILES) {
      setError(hub.actions.tooManyPhotos(MAX_BATCH_FILES));
      return;
    }
    const targetFamilies = placementIds();
    setAddBusy(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        const prepared = await prepareAlbumPhoto(file);
        if (!prepared.ok) {
          setError(
            prepared.error === "heic_unsupported"
              ? hub.actions.photoHeicUnsupported
              : hub.actions.photoEncodeFailed,
          );
          continue;
        }
        // issue #20 — direct-to-storage: request a target, PUT the bytes, record the row.
        const uploaded = await uploadPhotoDirect(prepared.file, targetFamilies);
        if ("error" in uploaded) {
          setError(uploaded.error);
          continue;
        }
        const at = new FormData();
        at.set("storyId", storyId);
        at.set("familyPhotoId", uploaded.photoId);
        await attachStoryPhotoAction(at);
      }
      await load();
    } catch {
      setError(hub.storyImages.addFailed);
    } finally {
      setAddBusy(false);
    }
  }

  // Import from Google Photos (into the album) then auto-attach each imported photo. Mirrors the album
  // uploader's picker orchestration (start → popup → poll), then uses the per-item import action so we
  // learn each new photo id and can attach it to the story.
  async function runGoogleImport() {
    const targetFamilies = placementIds();
    setError(null);
    setAddBusy(true);
    try {
      const started = await startGooglePhotosImportAction();
      if ("error" in started) {
        setError(started.error);
        return;
      }
      let pickerUrl: string;
      try {
        pickerUrl = pickerUriForWeb(started.pickerUri);
      } catch {
        setError(hub.storyImages.addFailed);
        return;
      }
      const popup = window.open(
        pickerUrl,
        "chronicle-google-photos-picker",
        "popup=yes,width=1100,height=800",
      );
      if (!popup) {
        setError(hub.storyImages.googlePopupBlocked);
        return;
      }
      try {
        popup.opener = null;
      } catch {
        /* ignore if the browser already isolated the context */
      }

      const pollIntervalMs = started.pollIntervalMs ?? PICKER_POLL_INTERVAL_MS;
      const pollTimeoutMs = started.pollTimeoutMs ?? PICKER_POLL_TIMEOUT_MS;
      const deadline = Date.now() + pollTimeoutMs;
      let ready = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const polled = await pollGooglePhotosImportAction(started.sessionId);
        if ("error" in polled) {
          setError(polled.error);
          return;
        }
        if (polled.mediaItemsSet) {
          await new Promise((r) => setTimeout(r, 500));
          ready = true;
          break;
        }
      }
      try {
        if (!popup.closed) popup.close();
      } catch {
        /* ignore cross-origin / already-closed */
      }
      if (!ready) {
        setError(hub.storyImages.googlePickerTimedOut);
        return;
      }

      const listed = await listGooglePhotosImportAction(started.sessionId);
      if ("error" in listed) {
        setError(listed.error);
        return;
      }
      for (const item of listed.items) {
        const fd = new FormData();
        fd.set("id", item.id);
        fd.set("baseUrl", item.baseUrl);
        fd.set("mimeType", item.mimeType);
        if (item.filename) fd.set("filename", item.filename);
        for (const id of targetFamilies) fd.append("familyIds", id);
        let imported;
        try {
          imported = await importOneGooglePhotoAction(fd);
        } catch {
          setError(hub.storyImages.addFailed);
          continue;
        }
        if ("error" in imported) {
          setError(imported.error);
          continue;
        }
        const at = new FormData();
        at.set("storyId", storyId);
        at.set("familyPhotoId", imported.photoId);
        await attachStoryPhotoAction(at);
      }
      await load();
    } catch {
      setError(hub.storyImages.addFailed);
    } finally {
      setAddBusy(false);
    }
  }

  const busy = pending || addBusy;
  const attachedIds = new Set(attached.map((a) => a.familyPhotoId));

  return (
    <section style={{ marginBottom: 32 }}>
      <p style={label}>{hub.storyImages.editorHeading}</p>
      <p style={help}>{hub.storyImages.editorHelp}</p>

      {error ? (
        <p aria-live="polite" style={errorText}>
          {error}
        </p>
      ) : null}

      {/* Attached images with a compact per-image toolstrip (item 5): make-cover · move up · move
          down · delete — icon buttons, no wrapping text row. */}
      {attached.length > 0 ? (
        <div style={{ marginBottom: 20 }}>
          <p style={subLabel}>{hub.storyImages.attachedHeading}</p>
          <ul style={grid}>
            {attached.map((img, i) => (
              <li key={img.storyImageId} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- audited byte route. */}
                  <img
                    src={`/api/album-photo/${img.familyPhotoId}`}
                    alt={hub.storyImages.imageAlt(img.caption)}
                    style={tileImg}
                  />
                  {img.isCover ? <span style={coverBadge}>{hub.storyImages.coverBadge}</span> : null}
                </div>
                <div style={toolstrip} role="group" aria-label={hub.storyImages.attachedHeading}>
                  <button
                    type="button"
                    aria-label={hub.storyImages.setCover}
                    title={hub.storyImages.setCover}
                    disabled={busy || img.isCover}
                    onClick={() => setCover(img.storyImageId)}
                    style={toolBtn}
                  >
                    <span aria-hidden="true">{img.isCover ? "★" : hub.storyImages.coverIcon}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={hub.storyImages.moveUp}
                    title={hub.storyImages.moveUp}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                    style={toolBtn}
                  >
                    <span aria-hidden="true">{hub.storyImages.moveUpIcon}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={hub.storyImages.moveDown}
                    title={hub.storyImages.moveDown}
                    disabled={busy || i === attached.length - 1}
                    onClick={() => move(i, 1)}
                    style={toolBtn}
                  >
                    <span aria-hidden="true">{hub.storyImages.moveDownIcon}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={hub.storyImages.remove}
                    title={hub.storyImages.remove}
                    disabled={busy}
                    onClick={() => detach(img.storyImageId)}
                    style={{ ...toolBtn, ...toolBtnDanger }}
                  >
                    <span aria-hidden="true">{hub.storyImages.removeIcon}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Caption-driven "add this photo?" nudge (ADR-0009 Phase 4 · Slice B). Unchanged. */}
      {nudge && !dismissedNudge && !attachedIds.has(nudge.photoId) ? (
        <div role="note" aria-label={hub.compose.photoNudgeAria} style={nudgeBanner}>
          {/* eslint-disable-next-line @next/next/no-img-element -- audited byte route. */}
          <img
            src={`/api/album-photo/${nudge.photoId}`}
            alt={hub.storyImages.imageAlt(nudge.caption)}
            style={nudgeThumb}
          />
          <p style={nudgeText}>{hub.compose.photoNudge(nudge.caption)}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <KindredButton
              label={hub.compose.photoNudgeAdd}
              variant="primary"
              size="small"
              disabled={busy}
              onClick={() => attach(nudge.photoId)}
            />
            <KindredButton
              label={hub.compose.photoNudgeDismiss}
              variant="ghost"
              size="small"
              aria-label={hub.compose.photoNudgeDismissAria}
              onClick={() => setDismissedNudge(true)}
            />
          </div>
        </div>
      ) : null}

      {/* Add-photo entry points (items 2 + 3). Only meaningful once the owner belongs to a family. */}
      {loaded && families.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <KindredButton
            type="button"
            label={hub.storyImages.addFromAlbumButton}
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={() => setModalOpen(true)}
          />
          {googleConfigured && googleConnected ? (
            <KindredButton
              type="button"
              label={busy ? hub.storyImages.importing : hub.storyImages.addFromGoogleButton}
              variant="secondary"
              size="small"
              disabled={busy || !canPlace}
              onClick={() => void runGoogleImport()}
            />
          ) : null}
          {googleConfigured && !googleConnected ? (
            <a href="/api/google-photos/connect" style={connectLink}>
              {hub.storyImages.googleConnect}
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Hidden device file input — the modal's "Upload from device" button clicks it. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={busy}
        onChange={(e) => onDeviceFilesChosen(e.currentTarget.files)}
        style={{ display: "none" }}
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* "Add from album" modal: existing-photo picker + device upload + (multi-family) placement. */}
      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={hub.storyImages.pickModalTitle}
          style={modalOverlay}
          onClick={() => !busy && setModalOpen(false)}
        >
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={modalTitle}>{hub.storyImages.pickModalTitle}</h3>
              <KindredButton
                type="button"
                label={hub.storyImages.pickModalClose}
                variant="ghost"
                size="small"
                disabled={busy}
                onClick={() => setModalOpen(false)}
              />
            </div>

            {families.length > 1 ? (
              <fieldset style={placementFieldset}>
                <legend style={placementLegend}>{hub.storyImages.choosePlacementAlbums}</legend>
                <FamilyChoiceChips
                  families={families}
                  selected={placement}
                  onToggle={togglePlacement}
                  disabled={busy}
                />
              </fieldset>
            ) : null}

            <KindredButton
              type="button"
              label={addBusy ? hub.storyImages.uploading : hub.storyImages.uploadFromDevice}
              variant="primary"
              size="small"
              disabled={busy || !canPlace}
              onClick={openDevicePicker}
            />

            <div>
              <p style={subLabel}>{hub.storyImages.pickerHeading}</p>
              {album.length === 0 ? (
                <p style={help}>
                  {attached.length > 0 ? hub.storyImages.allAttached : hub.storyImages.noAlbumPhotos}
                </p>
              ) : (
                <ul style={grid}>
                  {album.map((p) => (
                    <li key={p.photoId} style={{ margin: 0 }}>
                      <button
                        type="button"
                        onClick={() => attach(p.photoId)}
                        disabled={busy}
                        aria-label={hub.storyImages.attachAria(p.caption)}
                        style={pickerButton}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- audited byte route. */}
                        <img
                          src={`/api/album-photo/${p.photoId}`}
                          alt={hub.storyImages.imageAlt(p.caption)}
                          style={tileImg}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ── styles (real design tokens only) ─────────────────────────────────────── */
const label: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--support)",
  margin: "0 0 6px",
};

const help: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: "0 0 14px",
};

const subLabel: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-label)",
  fontWeight: 600,
  color: "var(--text-meta)",
  margin: "0 0 10px",
};

const errorText: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-danger)",
  margin: "0 0 14px",
};

const nudgeBanner: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 14,
  marginBottom: 20,
  padding: 14,
  background: "var(--accent-soft)",
  border: "var(--border-width) solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
};

const nudgeThumb: React.CSSProperties = {
  width: 56,
  height: 56,
  objectFit: "cover",
  borderRadius: "var(--radius-sm)",
  display: "block",
  background: "var(--surface-sunken)",
  flexShrink: 0,
};

const nudgeText: React.CSSProperties = {
  flex: 1,
  minWidth: 160,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-body)",
  margin: 0,
};

const grid: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
  gap: 12,
};

const tileImg: React.CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  objectFit: "cover",
  borderRadius: "var(--radius-sm)",
  display: "block",
  background: "var(--surface-sunken)",
};

const coverBadge: React.CSSProperties = {
  position: "absolute",
  top: 6,
  left: 6,
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  fontWeight: 600,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--accent-on)",
  background: "var(--accent)",
  borderRadius: "var(--radius-pill)",
  padding: "3px 10px",
};

const pickerButton: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "transparent",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  display: "block",
  width: "100%",
};

const toolstrip: React.CSSProperties = {
  display: "flex",
  gap: 4,
  alignItems: "center",
};

const toolBtn: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 4px",
  border: "1.5px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface-card)",
  color: "var(--text-body)",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui)",
  lineHeight: 1,
};

const toolBtnDanger: React.CSSProperties = {
  color: "var(--text-danger)",
};

const connectLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  fontWeight: 600,
  color: "var(--accent)",
  textDecoration: "none",
  padding: "8px 4px",
};

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay-scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 1000,
};

const modalCard: React.CSSProperties = {
  background: "var(--surface-card)",
  borderRadius: "var(--radius-lg, 12px)",
  border: "1px solid var(--border)",
  boxShadow: "var(--shadow-lift)",
  padding: 24,
  width: "100%",
  maxWidth: 520,
  maxHeight: "85vh",
  overflowY: "auto",
  display: "grid",
  gap: 16,
};

const modalTitle: React.CSSProperties = {
  fontFamily: "var(--font-story)",
  fontSize: "1.25rem",
  margin: 0,
  color: "var(--text-body)",
};

const placementFieldset: React.CSSProperties = {
  border: "var(--border-width) solid var(--border)",
  borderRadius: 8,
  padding: "12px 14px",
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const placementLegend: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-meta)",
  padding: "0 6px",
};
