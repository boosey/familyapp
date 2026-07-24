"use client";

/**
 * Optional photo picker for the Ask form (ADR-0009 Phase 3, redesigned as a MODAL in #204). Lets
 * the asker attach one or more album photos the question is ABOUT — "tell the story of THIS photo".
 * The closed form shows only an "Add photos" button plus a lightweight readout of the current
 * selection (small thumbnails + a count); the toggle grid lives inside a modal dialog that follows
 * the repo's modal pattern (AlbumDestinationModal): `role="dialog"` + `aria-modal`, Escape or a
 * backdrop click closes, Tab is trapped inside, and focus returns to the trigger on close.
 *
 * It renders INSIDE the Ask `<form>`: the selected photo ids ride out as hidden `subjectPhotoIds`
 * inputs on the SAME form submit (rendered on the closed form, so they submit whether or not the
 * modal was ever opened), so the server action (`submitAsk` → `createAsk`) receives them via
 * `formData.getAll("subjectPhotoIds")`. `createAsk` re-runs the album-access gate per id
 * server-side, so a tampered selection is rejected there — this component only decides what to
 * OFFER and what the user has ticked.
 *
 * Self-contained: fetches the asker's visible album photos via `loadAskPhotoOptionsAction` on mount
 * (auth re-resolved server-side). Elder-friendly: each photo is a large toggle button with an
 * accessible label; no drag, no native dialogs; a load error surfaces inline on the CLOSED form (and
 * again inside the modal). Design tokens only (see AskPhotoPicker.module.css).
 */
import { useEffect, useRef, useState } from "react";
import { hub } from "@/app/_copy";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { albumPhotoSrc } from "@/app/hub/album/photo-src";
import { loadAskPhotoOptionsAction, type AskAlbumPhoto } from "./ask-photo-actions";
import s from "./AskPhotoPicker.module.css";

export function AskPhotoPicker({
  initialSelectedPhotoIds = [],
}: { initialSelectedPhotoIds?: string[] } = {}) {
  const [album, setAlbum] = useState<AskAlbumPhoto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // The element that opened the modal, captured at open time so focus can be restored on close
  // (the trigger persists, unlike a dropdown menuitem — document.activeElement is safe here).
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    void loadAskPhotoOptionsAction()
      .then((res) => {
        if (!active) return;
        if ("error" in res) {
          setError(res.error);
          return;
        }
        setAlbum(res.album);
        // Seed the initial ticks from the `?subjectPhotoIds=` deep-link, but ONLY for ids that are
        // actually among the asker's loaded (visible) options — a preselected id that isn't offered is
        // dropped silently (never selected as a phantom, never thrown). Preserve loaded-option order.
        if (initialSelectedPhotoIds.length > 0) {
          const want = new Set(initialSelectedPhotoIds);
          const seed = res.album.filter((p) => want.has(p.photoId)).map((p) => p.photoId);
          if (seed.length > 0) setSelected(seed);
        }
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
    // Mount-once fetch + one-shot seed from the initial deep-link ids (parent passes a fresh array
    // each render; depending on it would re-fetch/clobber user edits). Intentional empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (photoId: string) =>
    setSelected((prev) =>
      prev.includes(photoId) ? prev.filter((id) => id !== photoId) : [...prev, photoId],
    );

  // Nothing to offer (and no error) → render nothing, keeping the ask form uncluttered.
  if (loaded && album.length === 0 && !error) return null;

  const selectedPhotos = selected
    .map((id) => album.find((p) => p.photoId === id))
    .filter((p): p is AskAlbumPhoto => p !== undefined);

  return (
    <div className={s.root}>
      {/* Selected ids ride the ask form submit as repeated hidden inputs — on the CLOSED form, so
          they submit even if the modal is never opened (e.g. a deep-link seeded selection). */}
      {selected.map((id) => (
        <input key={id} type="hidden" name="subjectPhotoIds" value={id} />
      ))}

      <ActionButton
        variant="secondary"
        label={hub.ask.photosAdd}
        onClick={() => {
          triggerRef.current = document.activeElement as HTMLElement | null;
          setOpen(true);
        }}
      />

      {/* A failed album load surfaces HERE on the closed form (not only inside the modal) — the
          asker learns photos couldn't load without having to click "Add photos" first. */}
      {error ? (
        <p aria-live="polite" className={s.error}>
          {error}
        </p>
      ) : null}

      {/* Lightweight readout of the current selection on the closed form: thumbnails + a count. */}
      {selectedPhotos.length > 0 ? (
        <div className={s.selection}>
          <ul className={s.thumbs}>
            {selectedPhotos.map((p) => (
              <li key={p.photoId}>
                {/* eslint-disable-next-line @next/next/no-img-element -- audited byte route. */}
                <img
                  src={albumPhotoSrc(p.photoId, { thumb: true })}
                  alt={hub.album.photoAlt(p.caption)}
                  className={s.thumb}
                />
              </li>
            ))}
          </ul>
          <p className={s.count}>{hub.ask.photosSelected(selectedPhotos.length)}</p>
        </div>
      ) : null}

      {open ? (
        <AskPhotoModal
          album={album}
          selected={selected}
          error={error}
          onToggle={toggle}
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
        />
      ) : null}
    </div>
  );
}

/**
 * The modal album picker. Edits are LIVE (toggling updates the asker's selection immediately);
 * Done / Escape / a backdrop click all simply close. Mirrors AlbumDestinationModal's dialog idiom.
 */
function AskPhotoModal({
  album,
  selected,
  error,
  onToggle,
  onClose,
  triggerRef,
}: {
  album: AskAlbumPhoto[];
  selected: string[];
  error: string | null;
  onToggle: (photoId: string) => void;
  onClose: () => void;
  /** The "Add photos" trigger, focused again when the modal unmounts. */
  triggerRef: React.RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = "ask-photo-modal-title";

  // Move focus into the dialog on open; restore it to the trigger on close (unmount).
  useEffect(() => {
    dialogRef.current?.focus();
    return () => triggerRef.current?.focus?.();
  }, [triggerRef]);

  // Focusable descendants of the dialog in DOM order — re-queried per keydown, mirroring
  // AlbumDestinationModal.
  function getFocusable(): HTMLElement[] {
    const root = dialogRef.current;
    if (!root) return [];
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  }

  // Escape = close; Tab/Shift+Tab trapped inside so a keyboard user can't reach the form behind it.
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

  return (
    <div
      data-testid="ask-photo-backdrop"
      // Backdrop click closes, but only when the backdrop ITSELF is the target (not a click
      // bubbling up from the dialog card) — the same idiom the album modals use.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={s.backdrop}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={s.dialog}
      >
        <h2 id={titleId} className={s.title}>
          {hub.ask.photosModalTitle}
        </h2>
        <p className={s.help}>{hub.ask.photosHelp}</p>

        {error ? (
          <p aria-live="polite" className={s.error}>
            {error}
          </p>
        ) : (
          <ul className={s.grid}>
            {album.map((p) => {
              const isSelected = selected.includes(p.photoId);
              return (
                <li key={p.photoId}>
                  <button
                    type="button"
                    onClick={() => onToggle(p.photoId)}
                    aria-pressed={isSelected}
                    aria-label={
                      isSelected
                        ? hub.ask.removePhotoAria(p.caption)
                        : hub.ask.attachPhotoAria(p.caption)
                    }
                    className={s.tile}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- audited byte route. */}
                    <img
                      src={albumPhotoSrc(p.photoId, { thumb: true })}
                      alt={hub.album.photoAlt(p.caption)}
                      // #219 — defer off-screen tile fetch/decode (paired with the grid's
                      // content-visibility in AskPhotoPicker.module.css).
                      loading="lazy"
                      className={s.tileImg}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className={s.actions}>
          <ActionButton variant="primary" onClick={onClose} label={hub.ask.photosDone} />
        </div>
      </div>
    </div>
  );
}
