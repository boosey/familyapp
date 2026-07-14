"use client";

/**
 * AlbumPhotoViewer — the per-photo viewer that HOSTS a photo's options (ADR-0009 caption ·
 * ADR-0008 delete · #18). Tapping a tile in `AlbumGrid` opens this dialog: a larger view of the ONE
 * photo, with its management controls (edit caption, two-tap delete) living HERE rather than inline
 * in the grid. This matches the app's single-photo semantics and declutters the grid.
 *
 * The bytes come from the audited auth route (`/api/album-photo/[photoId]`), which re-checks read
 * authorization on every request; the options call the `editAlbumCaptionAction` /
 * `deleteAlbumPhotoAction` server actions, which re-resolve auth and re-run the contributor/steward
 * check server-side. As everywhere in the album, `photo.canManage` only decides whether to SHOW a
 * control — the seam is authoritative and never grants anything the flag alone implies.
 *
 * Elder-friendly accessibility: a real modal dialog (`role="dialog"` + `aria-modal` + an accessible
 * name), Escape closes, a backdrop click closes, focus moves into the dialog on open and is restored
 * to the trigger tile on close, generous touch targets, and no native confirm()/alert() — delete is
 * a two-tap in-UI confirm ("Delete" → "Tap again to remove"). Inline errors surface with
 * role="alert" using the app's alert convention.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editAlbumCaptionAction, deleteAlbumPhotoAction } from "./actions";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import type { AlbumGridPhoto } from "./AlbumGrid";
import { PhotoActionBar } from "./PhotoActionBar";
import { PhotoTagPanel } from "./PhotoTagPanel";

export function AlbumPhotoViewer({
  photo,
  onClose,
  scopeFamilyId = null,
}: {
  photo: AlbumGridPhoto;
  onClose: () => void;
  /** Optional: seeds a new place's target family when the photo is placed in several. */
  scopeFamilyId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The viewer stays OPEN across a successful caption save, so it tracks the caption locally and
  // reflects the saved value immediately (a router.refresh() will re-seed the same value via props).
  const [caption, setCaption] = useState(photo.caption);
  const [draft, setDraft] = useState(photo.caption ?? "");
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  // The "Tag people" action bar button scrolls this section into view and focuses its input.
  const peopleSectionRef = useRef<HTMLDivElement>(null);
  const peopleInputRef = useRef<HTMLInputElement>(null);

  function focusPeopleTagging() {
    peopleSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    peopleInputRef.current?.focus();
  }

  // Focus management: remember what was focused when the viewer opened (the trigger tile), move
  // focus into the dialog, and restore it to the trigger when the viewer unmounts (on close/delete).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Focusable descendants of the dialog, in DOM order — re-queried on each keydown (not cached),
  // since which controls exist changes with `editing` / `canManage`.
  function getFocusable(): HTMLElement[] {
    const root = dialogRef.current;
    if (!root) return [];
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  }

  // Escape closes the dialog. Tab/Shift+Tab is TRAPPED inside the dialog: without this, tabbing off
  // the first/last focusable control reaches the grid tiles behind the modal (they precede the dialog
  // in DOM order), letting a keyboard user open a DIFFERENT photo while this viewer is still mounted.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const activeIndex = active ? focusable.indexOf(active) : -1;
      if (e.shiftKey) {
        if (activeIndex <= 0) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeIndex === -1 || activeIndex === focusable.length - 1) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The caption is an ALWAYS-visible entry field now, so it saves on blur when the value changed —
  // no explicit Save button, but nothing is lost silently: a changed value is committed the moment
  // focus leaves the field. A pending save is skipped (the transition is already in flight).
  function saveCaptionIfChanged() {
    if (pending) return;
    if (draft === (caption ?? "")) return;
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
      // Reflect the saved caption in the still-open viewer, then refresh the server component so the
      // grid tile (and its label) pick up the new value too.
      setCaption(draft);
      router.refresh();
    });
  }

  // Delete's two-tap confirm now lives inside PhotoActionBar; this runs on the CONFIRMED tap only.
  function onDeleteConfirmed() {
    const formData = new FormData();
    formData.append("photoId", photo.id);
    startTransition(async () => {
      const result = await deleteAlbumPhotoAction(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // On success: close the viewer AND refresh — the tile vanishes when the server re-renders.
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      data-testid="album-viewer-backdrop"
      // Backdrop click closes, but only when the backdrop ITSELF is the click target (not a click
      // that bubbled up from the dialog card) — a robust alternative to stopPropagation.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(12px, 4vw, 32px)",
        background: "rgba(46, 38, 32, 0.55)",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={hub.album.viewerAria(caption)}
        tabIndex={-1}
        style={{
          background: "var(--surface-card)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lift)",
          maxWidth: 560,
          width: "100%",
          maxHeight: "90dvh",
          overflowY: "auto",
          padding: "clamp(16px, 4vw, 24px)",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          outline: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <KindredButton
            variant="ghost"
            size="small"
            onClick={onClose}
            aria-label={hub.album.closeViewer}
          >
            {hub.album.closeViewer}
          </KindredButton>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element -- bytes are served by our audited auth
            route, not a static asset; next/image would proxy/optimize it. */}
        <img
          src={`/api/album-photo/${photo.id}`}
          alt={hub.album.photoAlt(caption)}
          style={{
            width: "100%",
            maxHeight: "60dvh",
            objectFit: "contain",
            borderRadius: "var(--radius-md)",
            display: "block",
            background: "var(--surface-sunken)",
          }}
        />

        {photo.canManage ? (
          <div
            aria-label={hub.album.managePhotoAria(caption)}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/* Always-visible caption ENTRY FIELD (album enhancements item 3). It seeds from the
                photo caption and saves on blur when changed — no explicit Save button, but nothing is
                lost silently. The action bar's Edit affordance focuses this field via the ref. */}
            <input
              ref={captionInputRef}
              type="text"
              aria-label={hub.album.captionLabel}
              placeholder={hub.album.captionField}
              value={draft}
              disabled={pending}
              maxLength={500}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onBlur={saveCaptionIfChanged}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui)",
                padding: "12px 14px",
                borderRadius: "var(--radius-sm)",
                border: "var(--border-width) solid var(--border)",
                width: "100%",
                boxSizing: "border-box",
              }}
            />

            {/* Per-photo action buttons on ONE line below the caption field (PhotoActionBar full). It
                owns the two-tap delete confirm internally and carries the Ask/Tell deep-links + the
                manage-only Edit / Tag people / Tag faces / Delete. onEdit focuses the caption input;
                onTagPeople is omitted in Phase A (renders as a disabled placeholder). */}
            <PhotoActionBar
              photo={{ id: photo.id, caption, canManage: photo.canManage }}
              variant="full"
              busy={pending}
              onEdit={() => captionInputRef.current?.focus()}
              onDelete={onDeleteConfirmed}
              onTagPeople={focusPeopleTagging}
            />

            {/* Tag-management panel (Phase B3): Subjects / People / Places / Family. Self-gates its
                own editing on the photo detail's canManage; renders for all viewers. */}
            <PhotoTagPanel
              photoId={photo.id}
              scopeFamilyId={scopeFamilyId}
              peopleSectionRef={peopleSectionRef}
              peopleInputRef={peopleInputRef}
            />

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
          </div>
        ) : (
          <>
            {caption ? (
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui)",
                  color: "var(--text-body)",
                  margin: 0,
                }}
              >
                {caption}
              </p>
            ) : null}
            {/* A viewer who can't manage still gets the Ask/Tell deep-links (no manage-only controls). */}
            <PhotoActionBar
              photo={{ id: photo.id, caption, canManage: photo.canManage }}
              variant="full"
              busy={pending}
              onEdit={() => {}}
              onDelete={() => {}}
            />
            {/* Tags are viewable by everyone; the panel self-gates editing on its own canManage. */}
            <PhotoTagPanel
              photoId={photo.id}
              scopeFamilyId={scopeFamilyId}
              peopleSectionRef={peopleSectionRef}
              peopleInputRef={peopleInputRef}
            />
          </>
        )}
      </div>
    </div>
  );
}
