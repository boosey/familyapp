"use client";

/**
 * AlbumViewControls (album enhancements 2026-07-13 · items 7 + 8) — the controls bar above the album:
 *   - a segmented Grid / Masonry / List selector (a radiogroup so it's one keyboard stop with arrow-key
 *     movement between options), and
 *   - one thumbnail-size range slider that resizes tiles in EVERY view.
 *
 * Pure presentational: all state lives in `AlbumGrid`; this just renders the current `view`/`thumbPx`
 * and reports changes. Token-styled with elder-friendly targets.
 */
import { hub } from "@/app/_copy";
import { SegmentedControl } from "@/app/_kindred/SegmentedControl";

export type AlbumView = "grid" | "masonry" | "list";

/** Slider bounds (px). Default ~140 lives in AlbumGrid. */
export const THUMB_MIN = 96;
export const THUMB_MAX = 260;

const VIEWS: ReadonlyArray<{ value: AlbumView; label: string }> = [
  { value: "masonry", label: hub.album.viewMasonry },
  { value: "grid", label: hub.album.viewGrid },
  { value: "list", label: hub.album.viewList },
];

export function AlbumViewControls({
  view,
  onView,
  thumbPx,
  onThumbPx,
}: {
  view: AlbumView;
  onView: (v: AlbumView) => void;
  thumbPx: number;
  onThumbPx: (px: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 16,
        margin: 0,
      }}
    >
      {/* Order (#): the thumbnail-size slider comes FIRST, then the Grid/Masonry/List selector is pinned
          hard-right. One control drives tile size across all three views; the label is programmatically
          associated via aria-label; the ▪ glyphs are decorative size hints. */}
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-meta)",
        }}
      >
        <span aria-hidden="true" title={hub.album.thumbnailSmaller} style={{ fontSize: "0.85rem" }}>
          ▪
        </span>
        <input
          type="range"
          min={THUMB_MIN}
          max={THUMB_MAX}
          step={4}
          value={thumbPx}
          onChange={(e) => onThumbPx(Number(e.target.value))}
          aria-label={hub.album.thumbnailSizeLabel}
          aria-valuetext={`${thumbPx}px`}
          style={{ width: 160, cursor: "pointer", accentColor: "var(--accent)" }}
        />
        <span aria-hidden="true" title={hub.album.thumbnailLarger} style={{ fontSize: "1.2rem" }}>
          ▪
        </span>
      </label>

      {/* Segmented Grid / Masonry / List — the shared SegmentedControl (radio variant): one boxed pill
          look with arrow-key movement and roving tabindex, matching every other view selector (#1/#5).
          Rendered LAST in this flex-end slot so it sits right-justified (rj), after the size slider. */}
      <SegmentedControl
        variant="radio"
        ariaLabel={hub.album.viewSelectorAria}
        active={view}
        onSelect={(k) => onView(k as AlbumView)}
        items={VIEWS.map((v) => ({ key: v.value, label: v.label }))}
      />
    </div>
  );
}
