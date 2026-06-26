/**
 * The Story lifecycle state machine. Encodes the legal transitions from Part II:
 *   draft -> pending_approval -> approved -> shared
 * with `archived` reachable from any non-draft state. Illegal jumps (e.g. draft -> shared,
 * skipping the approval gate) are rejected — the approval gate cannot be bypassed by a state
 * write.
 */
import type { StoryState } from "@chronicle/db";
import { InvariantViolation } from "./errors";

const TRANSITIONS: Record<StoryState, readonly StoryState[]> = {
  draft: ["pending_approval", "archived"],
  pending_approval: ["approved", "draft", "archived"],
  approved: ["shared", "archived"],
  shared: ["archived"],
  archived: [],
};

export function canTransitionStory(from: StoryState, to: StoryState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertStoryTransition(from: StoryState, to: StoryState): void {
  if (!canTransitionStory(from, to)) {
    throw new InvariantViolation(
      `illegal story state transition: ${from} -> ${to}`,
    );
  }
}
