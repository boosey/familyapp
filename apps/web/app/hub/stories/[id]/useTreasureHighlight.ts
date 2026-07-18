"use client";

/**
 * useTreasureHighlight (Task 8) — the drag-to-treasure gesture.
 *
 * Binds mouseup/touchend on a scope element; when the user finishes a non-empty text selection whose
 * range lives inside that element, it calls `onTreasure(trimmedText)` and clears the selection. The
 * caller wires `onTreasure` to the EXISTING Like path (a SET, not a toggle), so this is purely the
 * gesture — no mutation lives here. SSR-safe (no window touch on the server) and dependency-light.
 */
import { useEffect, type RefObject } from "react";

export function useTreasureHighlight(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onTreasure: (text: string) => void,
): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const el = ref.current;
    if (!el) return;
    const handle = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;
      const text = sel.toString().trim();
      if (text.length === 0) return;
      onTreasure(text);
      sel.removeAllRanges();
    };
    el.addEventListener("mouseup", handle);
    el.addEventListener("touchend", handle);
    return () => {
      el.removeEventListener("mouseup", handle);
      el.removeEventListener("touchend", handle);
    };
  }, [ref, enabled, onTreasure]);
}
