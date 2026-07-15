"use client";
/**
 * TreeInviteContext — the single "invite this person to join" opener (tree Slice D, #6), provided by
 * TreeCanvas and consumed by the per-card ⋮ KebabMenu's Invite… item (and passed as a prop to the
 * details sheet, so BOTH entry points call ONE handler). A sibling of TreeFocusContext / TreeAddContext
 * so the kebab stays ignorant of canvas internals: it just calls `onInvite(node)` and the canvas
 * navigates to the EXISTING invite flow (`/hub?tab=invite`) pre-targeted at this person + family. No new
 * invite logic lives here — the target flow's form still posts to `createInvitation`.
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
