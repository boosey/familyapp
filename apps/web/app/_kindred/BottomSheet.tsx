"use client";

/**
 * BottomSheet (ADR-0024 "approach B" seam) — a reusable, presentational bottom-anchored sheet. It is the
 * mobile counterpart to {@link ModalShell}: same scrim (`--overlay-scrim`), same cap + internal-scroll +
 * safe-area contract, but anchored to the bottom edge with top-only rounding, a visual drag handle, and
 * a header row (title + ✕ close). The hub tabs open it via {@link MobileControlSheet} to group their
 * secondary controls on a phone.
 *
 * Behaviour it owns (unlike the presentational ModalShell): open/close is a prop; it renders NOTHING
 * when closed; it closes on scrim click AND Escape; and it focuses the panel on open (a light-touch
 * a11y matching ModalShell's adopters — it does NOT aggressively trap focus). Rendered via a portal to
 * `document.body` so the fixed overlay escapes any transformed/overflow-clipped ancestor.
 */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import s from "./BottomSheet.module.css";
import { hub } from "@/app/_copy";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The element focused before the sheet opened (usually the "⚙ Filters & view" trigger). Focus is
  // returned here on close so a keyboard/screen-reader user isn't stranded on <body>.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Escape-to-close (a keydown listener, like the bespoke modals). Only mounted while open.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    // Remember what to return focus to, then move focus into the sheet (light-touch: focus in, no trap).
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to the opener on close/unmount (guard: it may have left the DOM).
      const el = returnFocusRef.current;
      if (el && document.contains(el)) el.focus();
    };
  }, [open, onKeyDown]);

  // Portal target only exists in the browser; while closed (or during SSR) render nothing.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div role="presentation" className={s.overlay} onClick={onClose}>
      {/* Stop clicks inside the panel from bubbling to the scrim (so tapping a control never dismisses). */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={s.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.handle} aria-hidden="true" />
        <div className={s.header}>
          <h2 className={s.title}>{title}</h2>
          <button type="button" className={s.close} onClick={onClose} aria-label={hub.mobileControls.close}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
