import { describe, expect, it } from "vitest";
import {
  assertStoryTransition,
  canTransitionStory,
  InvariantViolation,
} from "../src/index";

describe("story state machine", () => {
  it("permits the happy path draft -> pending_approval -> approved -> shared", () => {
    expect(canTransitionStory("draft", "pending_approval")).toBe(true);
    expect(canTransitionStory("pending_approval", "approved")).toBe(true);
    expect(canTransitionStory("approved", "shared")).toBe(true);
  });

  it("forbids skipping the approval gate (draft -> shared)", () => {
    expect(canTransitionStory("draft", "shared")).toBe(false);
    expect(() => assertStoryTransition("draft", "shared")).toThrow(
      InvariantViolation,
    );
  });

  it("forbids un-sharing by state edit (shared -> draft); only archival is allowed", () => {
    expect(canTransitionStory("shared", "draft")).toBe(false);
    expect(canTransitionStory("shared", "archived")).toBe(true);
  });
});
