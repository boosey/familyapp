"use client";

/**
 * BottomSheet (ADR-0024 "approach B" seam) — a reusable, presentational bottom-anchored sheet. It is the
 * mobile counterpart to {@link ModalShell}: same scrim (`--overlay-scrim`), same cap + internal-scroll +
 * safe-area contract, but anchored to the bottom edge with top-only rounding, a visual drag handle, and
 * a header row (title + ✕ close). The hub tabs open it via {@link IconSheet} (the per-concern
 * View/Family/Filter triggers) to group their secondary controls on a phone; wide viewports use
 * {@link AnchoredPopover} instead (#300).
 *
 * Behaviour it owns (unlike the presentational ModalShell): open/close is a prop; it renders NOTHING
 * when closed; it closes on scrim click AND Escape; and it focuses the panel on open (a light-touch
 * a11y matching ModalShell's adopters — it does NOT aggressively trap focus). Focus effects depend
 * only on `open` (not on unstable `onClose`) so typing inside the sheet cannot steal focus back to
 * the dialog. Rendered via a portal to `document.body` so the fixed overlay escapes any
 * transformed/overflow-clipped ancestor.
 */
import { useEffect, useRef, type ReactNode } from "react";
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
  // The element focused before the sheet opened (usually the IconSheet trigger). Focus is
  // returned here on close so a keyboard/screen-reader user isn't stranded on <body>.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape-to-close. Stable while open; reads onClose via ref so parent re-renders do not rebind.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Focus move/restore only when `open` flips — not when onClose identity changes.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    panelRef.current?.focus();
    return () => {
      const el = returnFocusRef.current;
      if (el && document.contains(el)) el.focus();
    };
  }, [open]);

  // Portal target only exists in the browser; while closed (or during SSR) render nothing.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div role="presentation" className={s.overlay} onClick={() => onCloseRef.current()}>
      {/* Stop clicks inside the panel from bubbling to the scrim (so tapping a control never dismisses). */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={s.panel}
        data-shell="sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.handle} aria-hidden="true" />
        <div className={s.header}>
          <h2 className={s.title}>{title}</h2>
          <button
            type="button"
            className={s.close}
            onClick={() => onCloseRef.current()}
            aria-label={hub.mobileControls.close}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
