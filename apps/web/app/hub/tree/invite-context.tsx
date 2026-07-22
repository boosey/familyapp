"use client";
/**
 * TreeInviteContext — the single "invite this person to join" opener (originally tree Slice D #6; #334
 * retired the deep-link in favor of an in-place modal), provided by TreeCanvas and consumed by the
 * per-card ⋮ KebabMenu's Invite… item (and passed as a prop to the details sheet, so BOTH entry points
 * call ONE handler). A sibling of TreeFocusContext / TreeAddContext so the kebab stays ignorant of
 * canvas internals: it just calls `onInvite(node)` and the canvas opens `PersonInviteModal` — an
 * IN-PLACE overlay, never a navigation away from Tree (#334 AC 1/5).
 *
 * The hook returns a no-op when rendered outside a provider, so KebabMenu still renders standalone
 * (e.g. in unit tests that mount it without a TreeCanvas).
 */
import { createContext, useContext } from "react";
import type { TreeNode } from "@chronicle/core";

export type InvitePerson = (node: TreeNode) => void;

const TreeInviteContext = createContext<InvitePerson | null>(null);

export const TreeInviteProvider = TreeInviteContext.Provider;

export function useTreeInvite(): InvitePerson {
  return useContext(TreeInviteContext) ?? noop;
}

const noop: InvitePerson = () => {};
