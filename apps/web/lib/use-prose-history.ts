"use client";

/**
 * Undo/redo history for a controlled text value (the prose editor). The VALUE still lives in the
 * parent (so submit paths keep reading one source of truth); this hook layers a snapshot stack on top
 * of it and drives undo/redo/replace by calling the parent's `onChange`.
 *
 * Snapshot policy:
 *  - Typing is coalesced: a run of keystrokes becomes ONE history entry once the value settles for
 *    `SNAPSHOT_DEBOUNCE_MS` (so undo steps back a phrase, not a character — native Ctrl-Z is
 *    per-character and still works inside the textarea; this is the coarser, button-driven history
 *    that also spans AI polishes).
 *  - An AI polish (`replace`) first captures the current typed value, then adds the polished result —
 *    so one undo returns to the pre-polish text, and a further undo keeps walking back to the original.
 *  - `undo` right after typing flushes the still-pending keystrokes first, so nothing typed is lost
 *    from the history.
 *
 * `resetKey` re-baselines the stack (e.g. a different draft/story mounts into the same editor).
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface HistState {
  stack: string[];
  index: number;
}

export interface ProseHistory {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Commit a programmatic replacement (AI polish) as a new entry, capturing the current value first. */
  replace: (next: string) => void;
}

export const SNAPSHOT_DEBOUNCE_MS = 600;

export function useProseHistory(
  value: string,
  onChange: (next: string) => void,
  resetKey?: string,
): ProseHistory {
  const [hist, setHist] = useState<HistState>(() => ({ stack: [value], index: 0 }));
  // The value we most recently set OURSELVES (undo/redo/replace/reset). The debounce effect skips it,
  // so restoring a value never immediately re-snapshots it as if the user had typed it.
  const lastSet = useRef(value);
  const prevResetKey = useRef(resetKey);

  // Re-baseline when the caller swaps in a different document.
  useEffect(() => {
    if (resetKey === prevResetKey.current) return;
    prevResetKey.current = resetKey;
    lastSet.current = value;
    setHist({ stack: [value], index: 0 });
  }, [resetKey, value]);

  // Coalesced snapshot of typing: once `value` settles and it wasn't a change we made, push it.
  useEffect(() => {
    if (value === lastSet.current) return;
    const t = setTimeout(() => {
      setHist((h) => {
        if (h.stack[h.index] === value) return h;
        const base = h.stack.slice(0, h.index + 1);
        return { stack: [...base, value], index: base.length };
      });
    }, SNAPSHOT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);

  const pendingTyped = hist.stack[hist.index] !== value;
  const canUndo = hist.index > 0 || pendingTyped;
  const canRedo = !pendingTyped && hist.index < hist.stack.length - 1;

  const undo = useCallback(() => {
    const { stack, index } = hist;
    const typed = stack[index] !== value;
    // Flush a pending typed value so "undo right after typing" reverts that typing.
    const flushed = typed ? [...stack.slice(0, index + 1), value] : stack;
    const flushedIndex = typed ? flushed.length - 1 : index;
    if (flushedIndex <= 0 && !typed) return; // nothing before and nothing pending
    const targetIndex = flushedIndex > 0 ? flushedIndex - 1 : 0;
    const target = flushed[targetIndex]!;
    lastSet.current = target;
    setHist({ stack: flushed, index: targetIndex });
    onChange(target);
  }, [hist, value, onChange]);

  const redo = useCallback(() => {
    const { stack, index } = hist;
    if (stack[index] !== value) return; // pending typed → future is stale, no redo
    if (index >= stack.length - 1) return;
    const target = stack[index + 1]!;
    lastSet.current = target;
    setHist({ stack, index: index + 1 });
    onChange(target);
  }, [hist, value, onChange]);

  const replace = useCallback(
    (next: string) => {
      const { stack, index } = hist;
      const base = stack.slice(0, index + 1);
      const withCurrent = base[base.length - 1] === value ? base : [...base, value];
      const finalStack =
        withCurrent[withCurrent.length - 1] === next ? withCurrent : [...withCurrent, next];
      lastSet.current = next;
      setHist({ stack: finalStack, index: finalStack.length - 1 });
      onChange(next);
    },
    [hist, value, onChange],
  );

  return { canUndo, canRedo, undo, redo, replace };
}
