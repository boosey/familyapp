"use client";
/**
 * TreeCallbacksContext — single callbacks provider for TreeCanvas child affordances (#319).
 *
 * Collapses the former TreeAdd / TreeFocus / TreeInvite contexts into one value so kebab / "+" /
 * invite entry points stay ignorant of canvas internals without nesting three thin providers.
 *
 * Hooks return no-ops outside a provider so KebabMenu still mounts standalone in unit tests.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { AddRelativeRelation } from "@chronicle/core";
import type { TreeNode } from "@chronicle/core";

export type OpenAddRelative = (
  anchorPersonId: string,
  relation: AddRelativeRelation,
  /** For a couple's child add: the other partner, pre-bound so the click predetermines both parents. */
  coParentPersonId?: string,
) => void;

export type FocusPerson = (personId: string) => void;

export type InvitePerson = (node: TreeNode) => void;

export type TreeCallbacks = {
  openAdd: OpenAddRelative;
  focusPerson: FocusPerson;
  invitePerson: InvitePerson;
};

const noopAdd: OpenAddRelative = () => {};
const noopFocus: FocusPerson = () => {};
const noopInvite: InvitePerson = () => {};

const NOOP_CALLBACKS: TreeCallbacks = {
  openAdd: noopAdd,
  focusPerson: noopFocus,
  invitePerson: noopInvite,
};

const TreeCallbacksContext = createContext<TreeCallbacks>(NOOP_CALLBACKS);

export function TreeCallbacksProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: TreeCallbacks;
}) {
  return <TreeCallbacksContext.Provider value={value}>{children}</TreeCallbacksContext.Provider>;
}

export function useTreeCallbacks(): TreeCallbacks {
  return useContext(TreeCallbacksContext);
}

export function useTreeAdd(): OpenAddRelative {
  return useTreeCallbacks().openAdd;
}

export function useTreeFocus(): FocusPerson {
  return useTreeCallbacks().focusPerson;
}

export function useTreeInvite(): InvitePerson {
  return useTreeCallbacks().invitePerson;
}
