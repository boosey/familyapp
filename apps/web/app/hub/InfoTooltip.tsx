"use client";

import { useId, useRef, useState } from "react";
import styles from "./InfoTooltip.module.css";

interface InfoTooltipProps {
  /** Accessible name for the trigger (what the icon is "about") — the visible glyph is decorative. */
  label: string;
  /** The sentence revealed when the tooltip opens. */
  text: string;
}

/**
 * InfoTooltip (#160) — a small circled-i info affordance that reveals a single sentence as an
 * accessible tooltip. Introduced for the Requests heading (replacing an always-on instruction
 * paragraph) but deliberately generic/reusable.
 *
 * a11y: the trigger is a real `<button>` (keyboard-focusable, named by `label`). The tooltip is
 * revealed on keyboard focus AND on tap/click — never hover-only — and dismissed on Escape or blur.
 * A pointer-vs-keyboard guard (`pointerDown`) keeps a mouse/touch click a clean toggle instead of the
 * focus-opens-then-click-closes double-fire. Motion is gated behind `prefers-reduced-motion` and is a
 * quiet fade only — dignified, never whimsical.
 */
export function InfoTooltip({ label, text }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const pointerDown = useRef(false);
  const tooltipId = useId();

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onPointerDown={() => {
          pointerDown.current = true;
        }}
        onFocus={() => {
          // Keyboard focus reveals; a pointer-initiated focus does not (the click below toggles it),
          // so a mouse/touch click can't open-then-immediately-close.
          if (!pointerDown.current) setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          pointerDown.current = false;
        }}
        onClick={() => {
          setOpen((o) => !o);
          pointerDown.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      >
        <svg
          className={styles.icon}
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v3.5" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.35" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open ? (
        <span role="tooltip" id={tooltipId} className={styles.tooltip}>
          {text}
        </span>
      ) : null}
    </span>
  );
}
