"use client";

/**
 * AnchoredPopover — wide-viewport shell for collapsed hub browse panels (ADR-0025 Amendment
 * 2026-07-21 / #300). Counterpart to {@link BottomSheet}: same title + close + panel-body contract,
 * but anchored under a trigger instead of sliding up from the bottom edge. Compact viewports keep
 * the sheet; this component is the desktop/mid-width chrome for Family / Search / Filters / Views.
 *
 * Owns open/close dismiss (outside pointer + Escape), light focus move into the panel on open, and
 * focus restore to the opener on close — matching BottomSheet's a11y posture (no aggressive trap).
 * Focus effects depend only on open/mount (not on unstable `onClose`) so typing inside the panel
 * cannot steal focus back to the dialog. Renders via a portal so overflow-clipped ancestors cannot
 * clip it.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { hub } from "@/app/_copy";
import {
  ANCHORED_POPOVER_EDGE_GUTTER_PX,
  ANCHORED_POPOVER_FLIP_BELOW_MIN_PX,
  ANCHORED_POPOVER_GAP_PX,
  ANCHORED_POPOVER_MAX_WIDTH_PX,
  ANCHORED_POPOVER_MIN_WIDTH_PX,
} from "./anchored-popover-constants";
import s from "./AnchoredPopover.module.css";

export interface AnchoredPopoverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Element the panel anchors to (typically the IconSheet trigger). */
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

interface AnchorBox {
  top: number;
  left: number;
  width: number;
  bottom: number;
}

function readAnchorBox(el: HTMLElement | null): AnchorBox | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, bottom: r.bottom };
}

/** Width budget used for placement clamp — the CSS max, not the trigger-sized floor. */
function panelWidthBudget(vw: number): number {
  const gutter = ANCHORED_POPOVER_EDGE_GUTTER_PX;
  return Math.min(ANCHORED_POPOVER_MAX_WIDTH_PX, Math.max(0, vw - gutter * 2));
}

function placePanel(box: AnchorBox): CSSProperties {
  const vw = typeof window !== "undefined" ? window.innerWidth : box.left + box.width;
  const vh = typeof window !== "undefined" ? window.innerHeight : box.bottom + 400;
  const gutter = ANCHORED_POPOVER_EDGE_GUTTER_PX;
  const gap = ANCHORED_POPOVER_GAP_PX;

  const width = panelWidthBudget(vw);
  const maxLeft = Math.max(gutter, vw - width - gutter);
  const left = Math.max(gutter, Math.min(box.left, maxLeft));

  const spaceBelow = vh - box.bottom;
  const placeAbove = spaceBelow < ANCHORED_POPOVER_FLIP_BELOW_MIN_PX && box.top > spaceBelow;

  return {
    position: "fixed",
    left,
    width,
    ...(placeAbove ? { bottom: vh - box.top + gap } : { top: box.bottom + gap }),
    ["--anchored-popover-min-width" as string]: `${ANCHORED_POPOVER_MIN_WIDTH_PX}px`,
    ["--anchored-popover-max-width" as string]: `${ANCHORED_POPOVER_MAX_WIDTH_PX}px`,
  };
}

export function AnchoredPopover({ open, onClose, title, anchorRef, children }: AnchoredPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Focus-on-open runs once per open cycle after the portal mounts (box becomes non-null).
  const didFocusRef = useRef(false);

  const [box, setBox] = useState<AnchorBox | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      didFocusRef.current = false;
      return;
    }
    const sync = () => setBox(readAnchorBox(anchorRef.current));
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [open, anchorRef]);

  // Escape — stable listener; reads onClose via ref so parent re-renders do not rebind.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Capture return-focus target when open flips true; restore when it flips false / unmounts.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    return () => {
      const el = returnFocusRef.current;
      if (el && document.contains(el)) el.focus();
    };
  }, [open]);

  // Focus the dialog once it is actually mounted (after box is measured). Scroll/resize must not
  // re-focus (didFocusRef). BottomSheet can focus in the open effect because it never gates on box.
  useLayoutEffect(() => {
    if (!open || !box || didFocusRef.current) return;
    panelRef.current?.focus();
    didFocusRef.current = true;
  }, [open, box]);

  // Outside click — ignore presses on the anchor (toggle stays with the trigger).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, anchorRef]);

  if (!open || typeof document === "undefined" || !box) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      className={s.panel}
      data-shell="popover"
      style={placePanel(box)}
    >
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
    </div>,
    document.body,
  );
}
