"use client";
/**
 * TreeFocusContext — the single "re-root the tree on this person" opener (tree Slice A #2), provided by
 * TreeCanvas and consumed by the per-card ⋮ KebabMenu's Focus item. A sibling of TreeAddContext so the
 * kebab stays ignorant of canvas internals: it just calls `onFocus(personId)` and the canvas does the
 * server re-root + relabel + ring move + pan-delta (the camera holds still).
 *
 * The hook returns a no-op when rendered outside a provider, so KebabMenu still renders standalone
 * (e.g. in unit tests that mount it without a TreeCanvas).
 */
import { createContext, useContext } from "react";

export type FocusPerson = (personId: string) => void;

const TreeFocusContext = createContext<FocusPerson | null>(null);

export const TreeFocusProvider = TreeFocusContext.Provider;

export function useTreeFocus(): FocusPerson {
  return useContext(TreeFocusContext) ?? noop;
}

const noop: FocusPerson = () => {};
