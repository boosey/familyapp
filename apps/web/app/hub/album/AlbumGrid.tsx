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
 * Filter / view / size are CONTROLLED props now: the shared {@link AlbumControls} owns that state (and
 * the toolbar that drives it) above this body, so both album mount paths compose the same toolbar in
 * one place. This component is the body — it filters `photos` by the controlled `filter` and renders
 * the tiles in the controlled `view` at `thumbPx` — plus its own selection / bulk / delete / viewer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { hub } from "@/app/_copy";
import { AlbumPhotoViewer } from "./AlbumPhotoViewer";
import { PhotoActionBar } from "./PhotoActionBar";
import { DEFAULT_THUMB, type AlbumView } from "./AlbumViewControls";
import { AlbumListView } from "./AlbumListView";
import {
  EMPTY_FILTER,
  isFilterActive,
  type AlbumFilterValue,
  type AlbumPeriod,
} from "./AlbumFilterBar";
import { AlbumBulkBar } from "./AlbumBulkBar";
import { deleteAlbumPhotoAction, bulkSoftDeleteAlbumPhotosAction } from "./actions";
import { albumPhotoSrc } from "./photo-src";
import type { PendingTile } from "./import-progress";

export interface AlbumGridPhoto {
  id: string;
  caption: string | null;
  canManage: boolean;
  // Phase C enrichment — OPTIONAL so existing minimal-photo tests / the board's placeholder path still
  // typecheck when only {id, caption, canManage} is passed. Absent facets simply never match a filter.
  contributorName?: string | null;
  /** `shortName` (ADR-0021) is the family tag's display label when set; `name` is the fallback. */
  families?: { id: string; name: string; shortName?: string | null }[];
  subjects?: { id: string; name: string }[];
  people?: { id: string; name: string }[];
  places?: { id: string; name: string }[];
  /** ISO string of capturedAt ?? createdAt (from the detailed read); undefined ⇒ never matches a period. */
  capturedAt?: string | null;
}

/** All person-facet ids on a photo — subjects ∪ appears-in people. */
function photoPersonIds(p: AlbumGridPhoto): Set<string> {
  const ids = new Set<string>();
  for (const s of p.subjects ?? []) ids.add(s.id);
  for (const pp of p.people ?? []) ids.add(pp.id);
  return ids;
}

/** Does a photo's `capturedAt` ISO string fall in the given coarse period? Undefined never matches a
 *  non-"all" period. Boundaries computed against `now` so the presets stay simple + testable. */
function matchesPeriod(iso: string | null | undefined, period: AlbumPeriod, now: Date): boolean {
  if (period === "all") return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const year = new Date(iso).getFullYear();
  const thisYear = now.getFullYear();
  const fiveAgo = thisYear - 5;
  if (period === "thisYear") return year === thisYear;
  if (period === "fiveYears") return year >= fiveAgo && year <= thisYear;
  // "older" — anything strictly before the last-5-years window.
  return year < fiveAgo;
}

/** A photo passes when it matches ALL active facets: every selected person id ⊆ its people, every
 *  selected place id ⊆ its places, its capture time is in the period, and the query (case-insensitive)
 *  is a substring of its caption OR any tag name (subjects/people/places). */
function passesFilter(p: AlbumGridPhoto, f: AlbumFilterValue, now: Date): boolean {
  if (f.personIds.size > 0) {
    const ids = photoPersonIds(p);
    for (const id of f.personIds) if (!ids.has(id)) return false;
  }
  if (f.placeIds.size > 0) {
    const ids = new Set((p.places ?? []).map((pl) => pl.id));
    for (const id of f.placeIds) if (!ids.has(id)) return false;
  }
  if (!matchesPeriod(p.capturedAt, f.period, now)) return false;
  const q = f.text.trim().toLowerCase();
  if (q !== "") {
    const haystack = [
      p.caption ?? "",
      ...(p.subjects ?? []).map((s) => s.name),
      ...(p.people ?? []).map((pp) => pp.name),
      ...(p.places ?? []).map((pl) => pl.name),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export function AlbumGrid({
  photos,
  filter = EMPTY_FILTER,
  view = "masonry",
  thumbPx = DEFAULT_THUMB,
  pendingTiles = [],
  onRetryTile,
}: {
  photos: AlbumGridPhoto[];
  /** The caption/tag/facet/period filter — CONTROLLED by {@link AlbumControls} (the toolbar owner);
   *  defaults to EMPTY_FILTER so a bare `<AlbumGrid photos>` (tests / uncontrolled) shows everything. */
  filter?: AlbumFilterValue;
  /** The layout — CONTROLLED by AlbumControls; defaults to Masonry when rendered uncontrolled. */
  view?: AlbumView;
  /** The thumbnail size (px) — CONTROLLED by AlbumControls; defaults to DEFAULT_THUMB uncontrolled. */
  thumbPx?: number;
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

  // Filtering runs over the CONTROLLED `filter` prop. `now` is captured once per render for the period
  // boundaries — stable within a render pass.
  const now = new Date();
  const filtered = useMemo(
    () => photos.filter((p) => passesFilter(p, filter, now)),
    // now is intentionally excluded: it changes every render but its effect (year buckets) is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [photos, filter],
  );

  // ---- Phase C: multi-select state --------------------------------------------------------------
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function exitSelectMode() {
    setSelecting(false);
    setSelected(new Set());
    setBulkNote(null);
  }
  // Long-press entry (item 3): enter selection mode with this one photo already picked. A no-op if
  // already selecting (a normal tap toggles then). This is now the SOLE entry — the standing "Select"
  // toggle was removed (#191); Esc or the bulk bar's Clear are the way back out.
  function enterSelectAndSelect(id: string) {
    if (selecting) return;
    setSelecting(true);
    setSelected(new Set([id]));
    setBulkNote(null);
  }

  // Esc cancels selection mode (item 3). Only listens while selecting, so it never intercepts Escape
  // for anything else (e.g. the open photo viewer, which owns its own Escape handling).
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitSelectMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  const selectedIds = useMemo(() => [...selected], [selected]);

  function bulkAsk() {
    const qs = selectedIds.map((id) => `subjectPhotoIds=${encodeURIComponent(id)}`).join("&");
    router.push(`/hub?tab=ask&${qs}`);
  }
  function bulkTell() {
    const qs = selectedIds.map((id) => `subjectPhotoIds=${encodeURIComponent(id)}`).join("&");
    router.push(`/hub/tell?${qs}`);
  }
  async function bulkDelete() {
    setBulkNote(null);
    setBulkDeleting(true);
    try {
      const fd = new FormData();
      for (const id of selectedIds) fd.append("photoIds", id);
      const result = await bulkSoftDeleteAlbumPhotosAction(fd);
      if ("error" in result) {
        setBulkNote(result.error);
        return;
      }
      setBulkNote(hub.album.bulkDeleteResult(result.deleted, result.failed));
      // Leave selection mode entirely once the bulk delete lands (#191). The standing "Select"/"Done"
      // toggle that used to offer a way out is gone, and the bulk bar hides the moment the selection
      // empties — so clearing only `selected` (keeping `selecting`) would strand the viewer with empty
      // checkboxes and no visible exit. Drop BOTH here (but keep the result note we just set).
      setSelecting(false);
      setSelected(new Set());
      router.refresh();
    } catch {
      setBulkNote(hub.album.bulkDeleteError);
    } finally {
      setBulkDeleting(false);
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
      {/* Body only — the filter/view/size CONTROLS live in AlbumControls above this. The standalone
          "Select" toggle was removed (#191): multi-select is entered by LONG-PRESSING a photo (see
          AlbumTile), and Esc cancels it. */}

      {/* Sticky bulk action bar — only while in selection mode with ≥1 photo picked. */}
      {selecting && selected.size > 0 ? (
        <AlbumBulkBar
          count={selected.size}
          onAsk={bulkAsk}
          onTell={bulkTell}
          onDelete={bulkDelete}
          // #191 — with the standing "Select" toggle removed, the bulk bar's Clear is now the visible
          // way OUT of selection mode (Esc still works): it drops the selection AND leaves select mode,
          // so a viewer is never stranded with empty checkboxes and no exit affordance.
          onClear={exitSelectMode}
          deleting={bulkDeleting}
        />
      ) : null}

      {bulkNote ? (
        <p
          role="status"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: "0 0 12px",
          }}
        >
          {bulkNote}
        </p>
      ) : null}

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

      {/* Active filters excluded everything (but the album isn't actually empty) → a "no matches" note. */}
      {filtered.length === 0 && photos.length > 0 && isFilterActive(filter) ? (
        <p
          role="status"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-meta)",
            margin: "0 0 24px",
          }}
        >
          {hub.album.filterNoMatches}
        </p>
      ) : view === "list" ? (
        <AlbumListView
          photos={filtered}
          thumbPx={thumbPx}
          onOpen={setOpenId}
          onDelete={handleDelete}
          selecting={selecting}
          selectedIds={selected}
          onToggleSelected={toggleSelected}
          onLongPress={enterSelectAndSelect}
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
          {filtered.map((photo) => (
            <AlbumTile
              key={photo.id}
              photo={photo}
              masonry
              selecting={selecting}
              selected={selected.has(photo.id)}
              onToggleSelected={() => toggleSelected(photo.id)}
              onLongPress={() => enterSelectAndSelect(photo.id)}
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
          {filtered.map((photo) => (
            <AlbumTile
              key={photo.id}
              photo={photo}
              selecting={selecting}
              selected={selected.has(photo.id)}
              onToggleSelected={() => toggleSelected(photo.id)}
              onLongPress={() => enterSelectAndSelect(photo.id)}
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
          src={albumPhotoSrc(tile.photoId, { thumb: true })}
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
          src={albumPhotoSrc(tile.photoId, { thumb: true })}
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
  selecting = false,
  selected = false,
  onToggleSelected,
  onLongPress,
  onOpen,
  onDelete,
}: {
  photo: AlbumGridPhoto;
  /** Masonry layout: natural aspect ratio + break-inside guard (Grid forces a 1:1 box). */
  masonry?: boolean;
  /** Phase C selection mode: show a checkbox, suppress the hover toolbar. */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  /** Long-press (press-and-hold) enters selection mode with this photo picked (item 3). */
  onLongPress?: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  // Long-press (item 3): a press held past LONG_PRESS_MS on the image enters selection mode. We stamp a
  // ref the moment it fires so the click that follows pointer-up is SWALLOWED (otherwise it would toggle
  // the just-picked photo back off, or open the viewer). Only armed when NOT already selecting.
  const LONG_PRESS_MS = 500;
  const pressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  function cancelPress() {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }
  function startPress() {
    if (selecting || !onLongPress) return;
    longPressFired.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }
  function handleImageClick() {
    // Swallow the click synthesized after a long-press so it doesn't toggle/open.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (selecting) onToggleSelected?.();
    else onOpen();
  }

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
      {/* Selection checkbox (Phase C) — overlaid top-left while in selection mode. A real, keyboard-
          operable checkbox with an accessible label naming the photo. */}
      {selecting ? (
        <label
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            zIndex: 2,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: "var(--radius-sm)",
            background: "var(--surface-card)",
            boxShadow: "var(--shadow-lift)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected?.()}
            aria-label={hub.album.selectPhotoAria(photo.caption)}
            style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--accent)" }}
          />
        </label>
      ) : (
        <>
          {/* Hover/focus mini-toolbar (item 2): the shared compact PhotoActionBar overlaid at the TOP of
              the thumbnail, revealed on :hover and :focus-within so keyboard users can Tab into it. Pure
              CSS reveal (opacity + pointer-events). SUPPRESSED in selection mode (above) so a stray tap
              on a per-tile action can't fire on a photo the contributor only meant to select. */}
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
        </>
      )}

      {/* The whole image is the trigger — a button with an accessible label naming what it opens. In
          selection mode tapping the image TOGGLES selection (never opens the viewer) so a tap meant to
          pick a photo can't accidentally leave the grid. */}
      <button
        type="button"
        onClick={handleImageClick}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        aria-label={selecting ? hub.album.selectPhotoAria(photo.caption) : hub.album.viewPhoto(photo.caption)}
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
          src={albumPhotoSrc(photo.id, { thumb: true })}
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
