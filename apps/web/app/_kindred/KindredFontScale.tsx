"use client";

/**
 * Reading-size control — a single radiused segmented control: a row of "A" cells, smallest to
 * largest, divided by vertical separators. Choosing a cell sets the root element's font size (in
 * points), which rescales ALL rem-based text across the app at once (the Kindred type scale is
 * rem-based; see tokens.css). The choice is persisted in localStorage and re-applied on mount, so
 * it survives navigation and reloads. Point sizes live in `font-scale-constants.ts`.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { common } from "@/app/_copy";
import { PREFERENCES } from "./preferences/registry";
import { readPreference, setPreference, applyPreference } from "./preferences/client";

/** Glyph size (px) shown inside each cell so the row reads small → large. Presentational only —
 *  fixed px so the control itself never resizes when it changes the page scale.
 *  Deliberately a *compressed* range (not the real point sizes): the A's only need to hint at the
 *  progression, not literally render at the size they represent — that made the control sprawl. */
const GLYPH_PX = [13, 15, 17, 19, 21];
const pref = PREFERENCES.readingSize;

export function KindredFontScale() {
  const [active, setActive] = useState<number>(pref.default);

  useEffect(() => {
    const idx = readPreference(pref) as number;
    setActive(idx);
    applyPreference(pref, idx);
  }, []);

  function choose(idx: number): void {
    setActive(idx);
    setPreference(pref, idx);
  }

  return (
    <div role="group" aria-label={common.fontScale.control} style={groupStyle}>
      {pref.apply.steps.map((_, idx) => {
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
    // Hug the glyph: tight horizontal padding, no fixed width. The control is now sized by its
    // content (~tap-friendly) instead of five oversized boxes.
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 7px",
    height: 28,
    cursor: "pointer",
    border: "none",
    // Vertical separators between cells (not before the first).
    borderLeft: idx === 0 ? "none" : "var(--border-width) solid var(--border-strong)",
    background: on ? "var(--accent)" : "transparent",
    color: on ? "var(--accent-on)" : "var(--text-body)",
    fontFamily: "var(--font-story)",
    fontSize: GLYPH_PX[idx],
    fontWeight: 600,
  };
}
