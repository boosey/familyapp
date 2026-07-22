// @vitest-environment jsdom
/**
 * Capture is solemn (Phase 2 Task 6). The whole ComposingEditor subtree is the emotional core, so it
 * carries data-tone="solemn" on its outer container — that attribute is what dials the Scrapbook skin's
 * decorative palette / structural signatures down (the Task-1 globals guard + the module suppressions
 * key off `[data-tone="solemn"]`). This asserts the container ships the attribute in its calmest
 * phase (the take-0 capture entry, draft=null), which is the state every capture surface first renders.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ComposingEditor } from "./ComposingEditor";

// The composing editor pulls in a spread of server actions and next/navigation; none run in this
// render (idle capture-entry phase, no mutation fired), so stub them out to keep the shell renderable.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("./answer/[askId]/actions", () => ({
  composeStoryAction: vi.fn(),
  recordFollowUpTakeAction: vi.fn(),
  appendTypedTakeAction: vi.fn(),
  declineFollowUpAction: vi.fn(),
  finishDraftAction: vi.fn(),
  dropTakeAction: vi.fn(),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
  polishAnswerProseAction: vi.fn(),
}));
vi.mock("./stories/[id]/actions", () => ({
  editStoryDetailsAction: vi.fn(),
  tagStorySubjectAction: vi.fn(),
  untagStorySubjectAction: vi.fn(),
}));
vi.mock("./tag-suggestions-actions", () => ({
  loadTagSuggestionsAction: vi.fn(() => Promise.resolve({ people: [], families: [], tags: [] })),
}));

afterEach(cleanup);

it("wraps the capture subtree in a data-tone=\"solemn\" container", () => {
  const { container } = render(<ComposingEditor ask={null} draft={null} backTab="/hub?tab=stories" />);

  // Assert the attribute sits on the OUTERMOST rendered element, so the whole capture subtree
  // (every phase) is scoped — not merely present on some inner leaf while siblings escape solemn.
  const solemn = container.firstElementChild;
  expect(solemn).not.toBeNull();
  expect(solemn!.getAttribute("data-tone")).toBe("solemn");
});
