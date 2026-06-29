"use client";

/**
 * Reading-size control — a row of boxed "A"s, smallest to largest, that scales ALL rem-based text
 * across the app. The Kindred type scale is defined in `rem` (see tokens.css), so setting the root
 * element's font size rescales every token at once. The choice is persisted in localStorage and
 * re-applied on mount, so it survives navigation and reloads.
 *
 * Base root size is 18px (globals.css sets html { font-size: var(--text-ui-sm) } = 1.125rem). A
 * scale of 1 reproduces that; the larger steps multiply it. Inline pixel sizes (a few icons/arrows)
 * don't scale — the vast majority of UI text uses rem tokens and does.
 */
import { useEffect, useState, type CSSProperties } from "react";

const STORAGE_KEY = "kin-font-scale";
const BASE_ROOT_PX = 18;

interface Step {
  label: string;
  scale: number;
  /** Glyph size (px) shown inside the box so the row reads small → large. */
  glyph: number;
}

const STEPS: Step[] = [
  { label: "Small text", scale: 1, glyph: 13 },
  { label: "Medium text", scale: 1.15, glyph: 17 },
  { label: "Large text", scale: 1.3, glyph: 22 },
];

function applyScale(scale: number): void {
  document.documentElement.style.fontSize = `${BASE_ROOT_PX * scale}px`;
}

function nearestIndex(scale: number): number {
  let best = 0;
  for (let i = 1; i < STEPS.length; i++) {
    if (Math.abs(STEPS[i]!.scale - scale) < Math.abs(STEPS[best]!.scale - scale)) best = i;
  }
  return best;
}

export function KindredFontScale() {
  // Default to the first step until the persisted choice is read on mount (avoids SSR mismatch).
  const [active, setActive] = useState(0);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      const idx = nearestIndex(stored);
      setActive(idx);
      applyScale(STEPS[idx]!.scale);
    }
  }, []);

  function choose(idx: number): void {
    setActive(idx);
    applyScale(STEPS[idx]!.scale);
    window.localStorage.setItem(STORAGE_KEY, String(STEPS[idx]!.scale));
  }

  return (
    <div
      role="group"
      aria-label="Text size"
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {STEPS.map((step, idx) => {
        const on = idx === active;
        return (
          <button
            key={step.label}
            type="button"
            onClick={() => choose(idx)}
            aria-label={step.label}
            aria-pressed={on}
            title={step.label}
            style={boxStyle(on, step.glyph)}
          >
            A
          </button>
        );
      })}
    </div>
  );
}

function boxStyle(on: boolean, glyph: number): CSSProperties {
  return {
    width: 38,
    height: 38,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    borderRadius: "var(--radius-sm, 8px)",
    border: `var(--border-width) solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
    background: on ? "var(--accent)" : "var(--surface-card)",
    color: on ? "var(--accent-on)" : "var(--text-body)",
    /* Fixed px so the control itself never resizes when it changes the page scale. */
    fontFamily: "var(--font-story)",
    fontSize: glyph,
    fontWeight: 600,
    lineHeight: 1,
    flex: "0 0 auto",
  };
}
