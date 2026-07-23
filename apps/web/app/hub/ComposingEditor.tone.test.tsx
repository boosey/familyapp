// @vitest-environment jsdom
/**
 * Capture is no longer solemn-muted — full Scrapbook signatures apply on the composing surface.
 * This asserts the outer container does NOT ship data-tone="solemn".
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ComposingEditor } from "./ComposingEditor";
import { CAPTURE_VOICE_SIZE_ENTRY_PX, CAPTURE_VOICE_SIZE_FOOTER_PX } from "@/lib/constants";

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

it("does not wrap the capture subtree in data-tone=\"solemn\"", () => {
  const { container } = render(<ComposingEditor ask={null} draft={null} backTab="/hub?tab=stories" />);

  const root = container.firstElementChild;
  expect(root).not.toBeNull();
  expect(root!.getAttribute("data-tone")).not.toBe("solemn");
  expect(container.querySelector('[data-tone="solemn"]')).toBeNull();
});

it("uses the compact capture mic size on take-0 entry", () => {
  render(<ComposingEditor ask={null} draft={null} backTab="/hub?tab=stories" />);
  const btn = screen.getByRole("button", { name: "Tap to speak" });
  expect(btn.style.width).toBe(`${CAPTURE_VOICE_SIZE_ENTRY_PX}px`);
  expect(btn.style.height).toBe(`${CAPTURE_VOICE_SIZE_ENTRY_PX}px`);
});

it("capture voice sizes stay single-sourced (footer smaller than entry)", () => {
  expect(CAPTURE_VOICE_SIZE_FOOTER_PX).toBeLessThan(CAPTURE_VOICE_SIZE_ENTRY_PX);
  expect(CAPTURE_VOICE_SIZE_ENTRY_PX).toBe(120);
  expect(CAPTURE_VOICE_SIZE_FOOTER_PX).toBe(96);
});

it("ComposingEditor module exposes progressive chip action row", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(join(dir, "ComposingEditor.module.css"), "utf8");
  expect(css).toContain(".progressiveRow");
  expect(css).toContain(".chip");
});
