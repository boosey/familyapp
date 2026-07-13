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

export type AlbumView = "grid" | "masonry" | "list";

/** Slider bounds (px). Default ~140 lives in AlbumGrid. */
export const THUMB_MIN = 96;
export const THUMB_MAX = 260;

const VIEWS: ReadonlyArray<{ value: AlbumView; label: string }> = [
  { value: "grid", label: hub.album.viewGrid },
  { value: "masonry", label: hub.album.viewMasonry },
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
        justifyContent: "space-between",
        gap: 16,
        margin: "0 0 16px",
      }}
    >
      {/* Segmented Grid / Masonry / List. A radiogroup: arrow keys move between options, and the
          selected one is the sole tab stop. `aria-checked` carries the current selection. */}
      <div
        role="radiogroup"
        aria-label={hub.album.viewSelectorAria}
        style={{
          display: "inline-flex",
          padding: 3,
          gap: 2,
          borderRadius: "var(--radius-pill)",
          background: "var(--surface-sunken)",
          border: "var(--border-width) solid var(--border)",
        }}
      >
        {VIEWS.map((v) => {
          const selected = v.value === view;
          return (
            <button
              key={v.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onView(v.value)}
              onKeyDown={(e) => {
                // Arrow-key movement within the radiogroup (wrap-around).
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const i = VIEWS.findIndex((x) => x.value === view);
                  onView(VIEWS[(i + 1) % VIEWS.length]!.value);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const i = VIEWS.findIndex((x) => x.value === view);
                  onView(VIEWS[(i - 1 + VIEWS.length) % VIEWS.length]!.value);
                }
              }}
              style={{
                minHeight: 40,
                padding: "8px 18px",
                border: "none",
                borderRadius: "var(--radius-pill)",
                background: selected ? "var(--surface-card)" : "transparent",
                boxShadow: selected ? "var(--shadow-lift)" : "none",
                color: selected ? "var(--text-heading)" : "var(--text-meta)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                fontWeight: selected ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {/* Thumbnail-size slider — one control that drives tile size across all three views. The label
          is programmatically associated via aria-label; the ⊟/⊞ glyphs are decorative size hints. */}
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
    </div>
  );
}
