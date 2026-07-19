"use client";

/**
 * AlbumControls (album controls hoist) — the album's StoriesSurface equivalent: the ONE client owner
 * of the album's shared two-row {@link HubToolbar}, so the album's control area can't drift from the
 * other hub sub-tabs and — crucially — so BOTH album mount paths (the flag-off `AlbumSurface` pair and
 * the flag-on `AlbumBoard`) render the SAME toolbar with the "Add Photos" affordance on the SAME row as
 * the When/Search filters.
 *
 *   R1:  [When ▾ · Search · Clear]                 ·······  [Add Photos ▾ (addSlot)]
 *   R2:  [Family selector chips (familyChips)]     ·······  [size slider + Masonry/Grid/List]
 *
 * State owned here (was hoisted OUT of AlbumGrid so the toolbar composes in ONE place, above a
 * body-only grid — mirroring StoriesSurface owning the toolbar over a controlled StoryBrowse body):
 *  - `filter` (When/Search/facets) — the AlbumFilterValue, threaded down to AlbumGrid which does the
 *    actual filtering; the People/Places facet options are derived HERE from the current photos.
 *  - `view` (Masonry/Grid/List) + `thumbPx` (size slider) — the R2-right selector, persisted to
 *    localStorage with an SSR-safe default + a client-only hydrate effect (no hydration mismatch).
 * Selection / bulk / delete / photo-viewer state stays IN AlbumGrid (body concerns).
 *
 * Empty album (no photos AND no in-flight tiles): there is no grid body to host the toolbar, so this
 * renders a MINIMAL toolbar carrying just the Add Photos affordance (R1-right) + the family chips
 * (R2-left) above the welcoming empty note — the add/import flow is never hidden by an empty album.
 *
 * All authorization already happened upstream; this only renders + narrows what the surface handed it.
 */
import { useEffect, useMemo, useState } from "react";
import { HubToolbar } from "../HubToolbar";
import { useIsCompact } from "@/app/_kindred/useIsCompact";
import { AlbumGrid, type AlbumGridPhoto } from "./AlbumGrid";
import {
  AlbumFilterBar,
  EMPTY_FILTER,
  isFilterActive,
  type AlbumFilterValue,
} from "./AlbumFilterBar";
import {
  AlbumViewControls,
  DEFAULT_THUMB,
  THUMB_MAX,
  THUMB_MIN,
  type AlbumView,
} from "./AlbumViewControls";
import type { PendingTile } from "./import-progress";

const VIEW_KEY = "album:view";
const THUMB_KEY = "album:thumbPx";

function clampThumb(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_THUMB;
  return Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(px)));
}

function isView(v: string | null): v is AlbumView {
  return v === "grid" || v === "masonry" || v === "list";
}

export function AlbumControls({
  photos,
  pendingTiles = [],
  onRetryTile,
  addSlot,
  familyChips,
  familyFilterActive = false,
  notices,
  emptyNote,
}: {
  photos: AlbumGridPhoto[];
  /** ADR-0015 · F2 in-flight/failed placeholder tiles (board path only). */
  pendingTiles?: PendingTile[];
  /** Called with a failed tile's `tempId` when its retry affordance is tapped (board path only). */
  onRetryTile?: (tempId: string) => void;
  /** The "Add Photos" uploader element — rendered right-justified in the toolbar's R1-right on BOTH
   *  the populated and empty paths, so the add/import flow always shares the When/Search row. */
  addSlot?: React.ReactNode;
  /** The shared browse Family filter chips (ADR-0021) — HubToolbar's R2-left. Omit (<2 families) and
   *  the slot collapses (HubToolbar's empty-row rule). */
  familyChips?: React.ReactNode;
  /** Whether the `?families=` chip filter is narrowed to a subset (computed upstream in AlbumSurface,
   *  which owns the selection). On mobile the chips move INSIDE the closed "Filters & view" sheet, so
   *  this must feed the trigger badge — otherwise a family-narrowed grid shows with no indication. */
  familyFilterActive?: boolean;
  /** Board-only status lines (import "X of N", a list-step error, a "nothing imported" note),
   *  rendered BELOW the toolbar and above the grid body. */
  notices?: React.ReactNode;
  /** The welcoming empty-album note shown when there are no photos and no in-flight tiles. */
  emptyNote: string;
}) {
  // ---- Filter state (client-side; AlbumGrid does the actual filtering over these values) --------
  const [filter, setFilter] = useState<AlbumFilterValue>(EMPTY_FILTER);

  // Filter-menu options: the UNION of people (subjects ∪ appears-in) and of places across the CURRENT
  // photos, deduped by id, sorted by name for a stable menu.
  const peopleOptions = useMemo(() => {
    const by = new Map<string, string>();
    for (const p of photos) {
      for (const s of p.subjects ?? []) by.set(s.id, s.name);
      for (const pp of p.people ?? []) by.set(pp.id, pp.name);
    }
    return [...by].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [photos]);
  const placeOptions = useMemo(() => {
    const by = new Map<string, string>();
    for (const p of photos) for (const pl of p.places ?? []) by.set(pl.id, pl.name);
    return [...by].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [photos]);

  // ---- Layout + thumbnail-size state -------------------------------------------------------------
  // Start at the SSR-safe defaults (Masonry / DEFAULT_THUMB) — never touch localStorage during render —
  // then hydrate the stored choice in a client-only effect (mirrors StoriesSurface's feedView effect).
  const [view, setView] = useState<AlbumView>("masonry");
  const [thumbPx, setThumbPx] = useState<number>(DEFAULT_THUMB);
  useEffect(() => {
    try {
      const storedView = window.localStorage.getItem(VIEW_KEY);
      if (isView(storedView)) setView(storedView);
      const storedThumb = window.localStorage.getItem(THUMB_KEY);
      if (storedThumb !== null) setThumbPx(clampThumb(Number(storedThumb)));
    } catch {
      /* localStorage unavailable — keep defaults. */
    }
  }, []);
  function changeView(v: AlbumView) {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore persistence failure */
    }
  }
  function changeThumb(px: number) {
    const next = clampThumb(px);
    setThumbPx(next);
    try {
      window.localStorage.setItem(THUMB_KEY, String(next));
    } catch {
      /* ignore persistence failure */
    }
  }

  // ADR-0024: on a phone (< 40rem) the album's filter cluster + family chips + view controls move into a
  // "⚙ Filters & view" bottom sheet, leaving only "Add Photos" on the primary row. Desktop is unchanged.
  const compact = useIsCompact();

  // Active-count for the mobile trigger badge: one for an engaged filter (period/people/places/text —
  // isFilterActive already collapses the four facets) + one for a non-default view + one for a narrowed
  // family-chip filter. The family chip subset is opaque here (an upstream ReactNode), so AlbumSurface
  // passes `familyFilterActive` down: on mobile the chips are hidden inside the closed sheet, so an
  // un-counted family filter would leave the grid narrowed with no visible indication.
  const activeCount =
    (isFilterActive(filter) ? 1 : 0) + (view !== "masonry" ? 1 : 0) + (familyFilterActive ? 1 : 0);

  const hasBody = photos.length > 0 || pendingTiles.length > 0;

  // Empty album: no grid to host the full filter toolbar, so render a MINIMAL toolbar carrying only the
  // Add Photos affordance (R1-right) + the family chips (R2-left) above the empty note. The filters and
  // view controls would steer nothing here, so they are omitted (their slots collapse).
  // DELIBERATELY EXEMPT from the mobile "Filters & view" sheet (`compact` is unused on this path): there
  // is no photo grid below to protect from vertical bloat, and the chips are the one useful control here
  // (switch which family's empty album you're looking at) — hiding them behind a gear on an empty screen
  // is worse UX than leaving them inline. So no sheet, no badge, chips stay visible.
  if (!hasBody) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <HubToolbar row1Right={addSlot ?? null} row2Left={familyChips ?? null} />
        {notices}
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          {emptyNote}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* The shared control block: the facet-chips row (People/Places, when the photos carry them) plus
          the two-row HubToolbar — R1 [When·Search·Clear … Add Photos], R2 [Family selector … size +
          view layout]. AlbumFilterBar composes it; each slot gates its own presence. */}
      <AlbumFilterBar
        people={peopleOptions}
        places={placeOptions}
        value={filter}
        onChange={setFilter}
        familyChips={familyChips}
        addSlot={addSlot}
        compact={compact}
        activeCount={activeCount}
        rightSlot={
          <AlbumViewControls
            view={view}
            onView={changeView}
            thumbPx={thumbPx}
            onThumbPx={changeThumb}
          />
        }
      />

      {notices}

      {/* Body only — the grid receives the controlled filter/view/thumbPx and renders tiles (+ its own
          selection/bulk/delete/viewer affordances and pending-import placeholders). */}
      <AlbumGrid
        photos={photos}
        filter={filter}
        view={view}
        thumbPx={thumbPx}
        pendingTiles={pendingTiles}
        onRetryTile={onRetryTile}
      />
    </div>
  );
}
