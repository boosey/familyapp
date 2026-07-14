"use client";
/**
 * TreeAddContext — the single "open the Add-a-relative modal" opener, provided by TreeCanvas and
 * consumed by the per-card affordances that used to NAVIGATE to /hub/kin (the "+" gutter buttons, the
 * per-card ⋮ KebabMenu, and the PersonPanel). Now that /hub/kin is gone and adding happens IN the tree
 * (spec 2026-07-14), those all call `openAdd(anchor, relation)` instead of pushing a route.
 *
 * The hook returns a no-op when rendered outside a provider, so those components still render standalone
 * (e.g. in unit tests that mount them without a TreeCanvas).
 */
import { createContext, useContext } from "react";
import type { AddRelativeRelation } from "@chronicle/core";

export type OpenAddRelative = (
  anchorPersonId: string,
  relation: AddRelativeRelation,
  /** For a couple's child add: the other partner, pre-bound so the click predetermines both parents. */
  coParentPersonId?: string,
) => void;

const TreeAddContext = createContext<OpenAddRelative | null>(null);

export const TreeAddProvider = TreeAddContext.Provider;

export function useTreeAdd(): OpenAddRelative {
  return useContext(TreeAddContext) ?? noop;
}

const noop: OpenAddRelative = () => {};
