"use client";

/**
 * AlbumControls (#302) — the album's StoriesSurface equivalent: ONE client owner of the progressive
 * hub control row. Occupancy: Family → Search → Filters → Views (no Sub tabs). Add Photos stays on
 * the trailing edge outside collapse. Search and Filters are separate units (Filters collapses first).
 *
 * Both album mount paths (flag-off AlbumSurface and flag-on AlbumBoard) render through this so the
 * control chrome cannot drift. State owned here:
 *  - `filter` (When/Search/facets) — threaded to AlbumGrid
 *  - `view` + `thumbPx` — Views unit, localStorage-persisted
 *
 * Empty album: progressive row with Family + Add Photos only (no Search/Filters/Views — they steer
 * nothing). Legacy HubToolbar remains for Family/Questions until #297.
 */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ImagePlus, LayoutGrid, ListFilter, Search, UsersRound } from "lucide-react";
import { hub } from "@/app/_copy";
import actionButtonStyles from "@/app/_kindred/ActionButton.module.css";
import { HubProgressiveControlRow } from "../HubProgressiveControlRow";
import { IconSheet } from "../IconSheet";
import { ICON_SHEET_GLYPH_SIZE } from "../icon-sheet-constants";
import { AlbumGrid, type AlbumGridPhoto } from "./AlbumGrid";
import {
  AlbumFacetFilters,
  AlbumSearchFilter,
  EMPTY_FILTER,
  isFacetFilterActive,
  isSearchActive,
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

/** Lightweight width probes for Add Photos — avoid dual-mounting AlbumUploader in the measure strip. */
function addPhotosMeasureLabeled(): ReactNode {
  return (
    <button type="button" className={actionButtonStyles.button} tabIndex={-1}>
      {hub.album.addPhotosMenu}{" "}
      <span aria-hidden="true">▾</span>
    </button>
  );
}

function addPhotosMeasureIconified(): ReactNode {
  return (
    <button type="button" className={actionButtonStyles.button} tabIndex={-1} aria-label={hub.album.addPhotosMenu}>
      <ImagePlus size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
    </button>
  );
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
  /** Test seam: force progressive-row width (skips ResizeObserver). */
  forceAvailableWidth,
  forceWidths,
}: {
  photos: AlbumGridPhoto[];
  /** ADR-0015 · F2 in-flight/failed placeholder tiles (board path only). */
  pendingTiles?: PendingTile[];
  /** Called with a failed tile's `tempId` when its retry affordance is tapped (board path only). */
  onRetryTile?: (tempId: string) => void;
  /** The "Add Photos" uploader — trailing progressive-row action (may iconify by width). */
  addSlot?: ReactNode;
  /** Shared browse Family filter chips (ADR-0021). Omit when <2 families. */
  familyChips?: ReactNode;
  /** Whether `?families=` is narrowed to a subset — badges the collapsed Family icon. */
  familyFilterActive?: boolean;
  /** Board-only status lines below the control row. */
  notices?: ReactNode;
  /** Welcoming empty-album note when there are no photos and no in-flight tiles. */
  emptyNote: string;
  forceAvailableWidth?: number;
  forceWidths?: React.ComponentProps<typeof HubProgressiveControlRow>["forceWidths"];
}) {
  const [filter, setFilter] = useState<AlbumFilterValue>(EMPTY_FILTER);
  const [actionForm, setActionForm] = useState<"labeled" | "iconified">("labeled");

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

  const hasBody = photos.length > 0 || pendingTiles.length > 0;

  const visibleAction =
    addSlot && isValidElement(addSlot) && typeof addSlot.type !== "string"
      ? cloneElement(addSlot as ReactElement<{ iconified?: boolean }>, {
          iconified: actionForm === "iconified",
        })
      : addSlot;

  const action = addSlot
    ? {
        labeled: addPhotosMeasureLabeled(),
        iconified: addPhotosMeasureIconified(),
        visible: visibleAction,
      }
    : undefined;

  const family =
    familyChips != null
      ? {
          expanded: familyChips,
          collapsed: (
            <IconSheet
              icon={UsersRound}
              label={hub.mobileControls.familyLabel}
              sheetTitle={hub.mobileControls.familyLabel}
              badgeCount={familyFilterActive ? 1 : 0}
            >
              {familyChips}
            </IconSheet>
          ),
        }
      : undefined;

  // Empty album: Family + Add Photos only — filters/views steer nothing.
  if (!hasBody) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <HubProgressiveControlRow
          family={family}
          action={action}
          onActionFormChange={setActionForm}
          forceAvailableWidth={forceAvailableWidth}
          forceWidths={forceWidths}
        />
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

  const searchExpanded = <AlbumSearchFilter value={filter} onChange={setFilter} />;
  const searchCollapsed = (
    <IconSheet
      icon={Search}
      label={hub.mobileControls.searchLabel}
      sheetTitle={hub.mobileControls.searchLabel}
      badgeCount={isSearchActive(filter) ? 1 : 0}
    >
      <AlbumSearchFilter value={filter} onChange={setFilter} />
    </IconSheet>
  );

  const filtersExpanded = (
    <AlbumFacetFilters
      people={peopleOptions}
      places={placeOptions}
      value={filter}
      onChange={setFilter}
    />
  );
  const filtersCollapsed = (
    <IconSheet
      icon={ListFilter}
      label={hub.mobileControls.filterLabel}
      sheetTitle={hub.mobileControls.filterLabel}
      badgeCount={isFacetFilterActive(filter) ? 1 : 0}
    >
      <AlbumFacetFilters
        people={peopleOptions}
        places={placeOptions}
        value={filter}
        onChange={setFilter}
      />
    </IconSheet>
  );

  const viewsExpanded = (
    <AlbumViewControls
      view={view}
      onView={changeView}
      thumbPx={thumbPx}
      onThumbPx={changeThumb}
    />
  );
  const viewsCollapsed = (
    <IconSheet
      icon={LayoutGrid}
      label={hub.mobileControls.viewLabel}
      sheetTitle={hub.mobileControls.viewLabel}
    >
      <AlbumViewControls
        view={view}
        onView={changeView}
        thumbPx={thumbPx}
        onThumbPx={changeThumb}
      />
    </IconSheet>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <HubProgressiveControlRow
        family={family}
        search={{ expanded: searchExpanded, collapsed: searchCollapsed }}
        filters={{ expanded: filtersExpanded, collapsed: filtersCollapsed }}
        views={{ expanded: viewsExpanded, collapsed: viewsCollapsed }}
        action={action}
        onActionFormChange={setActionForm}
        forceAvailableWidth={forceAvailableWidth}
        forceWidths={forceWidths}
      />

      {notices}

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
