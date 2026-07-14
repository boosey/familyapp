"use client";

/**
 * Story ACCOMPANIMENT editor (ADR-0009 Phase 2) — the "Photos" section shown in the composer's
 * review phase. The draft owner can attach photos from THEIR album, set a cover, remove a photo, and
 * reorder (elder-friendly up/down buttons — no drag). Images are off the consent ledger, so these
 * are plain mutations with no re-approval.
 *
 * Self-contained: it fetches its own data via `loadStoryPhotoEditorAction(storyId)` on mount and
 * re-fetches after each mutation, so it needs no draft-prop plumbing. Every mutation and the load
 * re-resolve auth + re-verify draft ownership SERVER-side (photo-actions.ts) — the storyId here only
 * names WHICH story; it never grants anything. Errors surface inline (no native dialogs).
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import {
  loadStoryPhotoEditorAction,
  attachStoryPhotoAction,
  detachStoryPhotoAction,
  setStoryCoverAction,
  reorderStoryPhotosAction,
  type EditorStoryImage,
  type EditorAlbumPhoto,
} from "./answer/[askId]/photo-actions";

type Nudge = { photoId: string; caption: string | null };

export function StoryPhotosEditor({
  storyId,
  autoAttachPhotoIds = [],
}: {
  storyId: string;
  /**
   * Phase C bulk "tell one story about these N photos": non-cover selected photo ids to attach to the
   * draft ONCE on mount, via the SAME `attachStoryPhotoAction` the manual picker uses (no bespoke
   * path). Ids already attached — notably the cover, which the story creation already attached as the
   * first image — are skipped, so a cover duplicated in the selection never double-attaches. The
   * server re-checks read access per photo, so a crafted id simply fails its own attach.
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
  }, [storyId]);

  useEffect(() => {
    void load().finally(() => setLoaded(true));
  }, [load]);

  // Phase C: attach the bulk-selected non-cover photos ONCE, after the first load resolves so we can
  // dedup against what the story already carries (the cover, attached at story creation). We reuse the
  // manual picker's exact server action (`attachStoryPhotoAction`) — the same audited attach path — so
  // this opens no new surface. Runs sequentially, then a single reload reflects them all. Guarded by a
  // ref so the post-attach reloads don't re-trigger the sweep. The de-dup is belt-and-suspenders: the
  // core primitive also rejects a duplicate attach, so a race can never double-attach either.
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
        // A single failed attach (e.g. an unseeable id) shouldn't abort the rest; the reload below
        // reconciles whatever actually landed.
        try {
          await attachStoryPhotoAction(fd);
        } catch {
          /* swallow — reconciled by the reload */
        }
      }
      await load();
    });
  }, [loaded, autoAttachPhotoIds, attached, storyId, load]);

  // Run one mutation, then re-load. A returned { error } surfaces inline and skips the reload (the
  // server made no change). Any thrown error degrades to a generic inline note.
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

  // Move an attached image one slot earlier/later. The client computes the FULL new order and posts
  // it (the core primitive validates it against the current set).
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

  return (
    <section style={{ marginBottom: 32 }}>
      <p style={label}>{hub.storyImages.editorHeading}</p>
      <p style={help}>{hub.storyImages.editorHelp}</p>

      {error ? (
        <p aria-live="polite" style={errorText}>
          {error}
        </p>
      ) : null}

      {/* Attached images with per-image controls. */}
      {attached.length > 0 ? (
        <div style={{ marginBottom: 20 }}>
          <p style={subLabel}>{hub.storyImages.attachedHeading}</p>
          <ul style={grid}>
            {attached.map((img, i) => (
              <li key={img.storyImageId} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- audited byte route, not a
                      static asset; next/image would proxy/optimize it. */}
                  <img
                    src={`/api/album-photo/${img.familyPhotoId}`}
                    alt={hub.storyImages.imageAlt(img.caption)}
                    style={tileImg}
                  />
                  {img.isCover ? <span style={coverBadge}>{hub.storyImages.coverBadge}</span> : null}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {!img.isCover ? (
                    <KindredButton
                      label={hub.storyImages.setCover}
                      variant="ghost"
                      size="small"
                      disabled={pending}
                      onClick={() => setCover(img.storyImageId)}
                    />
                  ) : null}
                  <KindredButton
                    label={hub.storyImages.moveUp}
                    variant="ghost"
                    size="small"
                    disabled={pending || i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <KindredButton
                    label={hub.storyImages.moveDown}
                    variant="ghost"
                    size="small"
                    disabled={pending || i === attached.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <KindredButton
                    label={hub.storyImages.remove}
                    variant="ghost"
                    size="small"
                    disabled={pending}
                    onClick={() => detach(img.storyImageId)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Caption-driven "add this photo?" nudge (ADR-0009 Phase 4 · Slice B). Shown only on a real
          caption match, only while the suggested photo is still unattached (guarded defensively —
          the candidate pool is already unattached), and until the owner dismisses it. Attaching
          reuses the SAME `attach` server action as the manual picker below. */}
      {nudge && !dismissedNudge && !attached.some((a) => a.familyPhotoId === nudge.photoId) ? (
        <div role="note" aria-label={hub.compose.photoNudgeAria} style={nudgeBanner}>
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
              disabled={pending}
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

      {/* Album picker — tap a photo to attach it. */}
      <div>
        <p style={subLabel}>{hub.storyImages.pickerHeading}</p>
        {!loaded ? null : album.length === 0 ? (
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
                  disabled={pending}
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
  color: "var(--text-danger, #b00)",
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
