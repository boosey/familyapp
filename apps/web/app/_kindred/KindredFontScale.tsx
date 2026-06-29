"use client";

/**
 * Reading-size control — a single radiused segmented control: a row of "A" cells, smallest to
 * largest, divided by vertical separators. Choosing a cell sets the root element's font size (in
 * points), which rescales ALL rem-based text across the app at once (the Kindred type scale is
 * rem-based; see tokens.css). The choice is persisted in localStorage and re-applied on mount, so
 * it survives navigation and reloads. Point sizes live in `font-scale-constants.ts`.
 */
import { useEffect, useState, type CSSProperties } from "react";
import {
  FONT_SIZE_STEPS_PT,
  DEFAULT_FONT_SIZE_INDEX,
  FONT_SIZE_STORAGE_KEY,
} from "./font-scale-constants";
import { common } from "@/app/_copy";

/** Glyph size (px) shown inside each cell so the row reads small → large. Presentational only —
 *  fixed px so the control itself never resizes when it changes the page scale. */
const GLYPH_PX = [12, 15, 18, 22, 26];

function applyStep(idx: number): void {
  document.documentElement.style.fontSize = `${FONT_SIZE_STEPS_PT[idx]}pt`;
}

export function KindredFontScale() {
  const [active, setActive] = useState(DEFAULT_FONT_SIZE_INDEX);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY));
    const idx =
      Number.isInteger(stored) && stored >= 0 && stored < FONT_SIZE_STEPS_PT.length
        ? stored
        : DEFAULT_FONT_SIZE_INDEX;
    setActive(idx);
    applyStep(idx);
  }, []);

  function choose(idx: number): void {
    setActive(idx);
    applyStep(idx);
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(idx));
  }

  return (
    <div role="group" aria-label={common.fontScale.control} style={groupStyle}>
      {FONT_SIZE_STEPS_PT.map((_, idx) => {
        const on = idx === active;
        return (
          <button
            key={idx}
            type="button"
            onClick={() => choose(idx)}
            aria-label={common.fontScale.labels[idx]}
            aria-pressed={on}
            title={common.fontScale.labels[idx]}
            style={cellStyle(on, idx)}
          >
            A
          </button>
        );
      })}
    </div>
  );
}

const groupStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "stretch",
  borderRadius: "var(--radius-md, 10px)",
  border: "var(--border-width) solid var(--border-strong)",
  background: "var(--surface-card)",
  overflow: "hidden",
};

function cellStyle(on: boolean, idx: number): CSSProperties {
  return {
    width: 44,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    border: "none",
    // Vertical separators between cells (not before the first).
    borderLeft: idx === 0 ? "none" : "var(--border-width) solid var(--border-strong)",
    background: on ? "var(--accent)" : "transparent",
    color: on ? "var(--accent-on)" : "var(--text-body)",
    fontFamily: "var(--font-story)",
    fontSize: GLYPH_PX[idx],
    fontWeight: 600,
    lineHeight: 1,
  };
}
