// @vitest-environment jsdom
/**
 * StoryReadBody wiring regression (Task 8, highlight-to-treasure). The hook is unit-tested separately;
 * this guards the component-level wiring the hook tests can't see:
 *   - a prose-tab treasure calls onTreasure AND flashes the .treasure class on the prose <p>;
 *   - the transcript tab does NOT fire treasure (the T8 review's MAJOR defect — regression guard);
 *   - the hint line renders only on the prose tab when treasuring is enabled.
 *
 * No jest-dom in this repo → native Vitest assertions + .getAttribute/querySelector/classList.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import { StoryReadBody } from "./StoryReadBody";
import styles from "./StoryReadBody.module.css";

const LABELS = {
  story: hub.browse.readStory,
  transcript: hub.browse.readTranscript,
  noProse: hub.browse.readNoProse,
};
const TREASURE_LABELS = { hint: hub.stories.treasureHint, aria: hub.stories.treasureAria };
const PROSE = "The whole treasured line lived here, told once and kept forever.";
const TRANSCRIPT = "um so yeah the whole treasured line lived here you know";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Install a fake Selection whose range's commonAncestorContainer is a node INSIDE `scope`, so the
 * hook's `el.contains(...)` genuinely passes. jsdom has no selection engine.
 */
function mockInScopeSelection(scope: HTMLElement, text: string) {
  const fakeSelection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: scope.firstChild as Node }),
    removeAllRanges: vi.fn(),
    toString: () => text,
  } as unknown as Selection;
  vi.spyOn(window, "getSelection").mockReturnValue(fakeSelection);
}

// The treasure scope wrapper is the region <div> (role="region" + the treasure aria-label).
function scopeEl(): HTMLElement {
  return screen.getByRole("region", { name: TREASURE_LABELS.aria });
}
function proseParagraph(): HTMLParagraphElement {
  return scopeEl().querySelector(`.${styles.prose}`) as HTMLParagraphElement;
}

it("fires onTreasure and flashes the .treasure class on a prose-tab drag", () => {
  const onTreasure = vi.fn();
  render(
    <StoryReadBody
      prose={PROSE}
      transcript={null}
      labels={LABELS}
      canTreasure
      onTreasure={onTreasure}
      treasureLabels={TREASURE_LABELS}
    />,
  );

  const scope = scopeEl();
  mockInScopeSelection(scope, PROSE);

  act(() => {
    scope.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  expect(onTreasure).toHaveBeenCalledTimes(1);
  // The flash class landed on the prose <p>. styles.treasure is `string | undefined` under
  // noUncheckedIndexedAccess, so assert via the className string rather than classList.contains().
  expect(proseParagraph().className).toContain(String(styles.treasure));
});

it("does NOT fire treasure while the transcript tab is active (T8 defect regression)", () => {
  const onTreasure = vi.fn();
  render(
    <StoryReadBody
      prose={PROSE}
      transcript={TRANSCRIPT}
      labels={LABELS}
      canTreasure
      onTreasure={onTreasure}
      treasureLabels={TREASURE_LABELS}
    />,
  );

  // Both bodies present → the segmented toggle is shown. Switch to the transcript tab.
  fireEvent.click(screen.getByRole("tab", { name: LABELS.transcript }));

  const scope = scopeEl();
  mockInScopeSelection(scope, TRANSCRIPT);

  act(() => {
    scope.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  expect(onTreasure).not.toHaveBeenCalled();
});

it("shows the treasure hint on the prose tab and hides it on the transcript tab", () => {
  render(
    <StoryReadBody
      prose={PROSE}
      transcript={TRANSCRIPT}
      labels={LABELS}
      canTreasure
      onTreasure={vi.fn()}
      treasureLabels={TREASURE_LABELS}
    />,
  );

  // Prose tab is the initial active body → hint present.
  expect(screen.queryByText(TREASURE_LABELS.hint)).not.toBeNull();

  // Toggle to transcript → hint gone.
  fireEvent.click(screen.getByRole("tab", { name: LABELS.transcript }));
  expect(screen.queryByText(TREASURE_LABELS.hint)).toBeNull();
});

it("shows no hint and no treasure region when canTreasure is false", () => {
  render(
    <StoryReadBody
      prose={PROSE}
      transcript={null}
      labels={LABELS}
      canTreasure={false}
      onTreasure={vi.fn()}
      treasureLabels={TREASURE_LABELS}
    />,
  );

  expect(screen.queryByText(TREASURE_LABELS.hint)).toBeNull();
  expect(screen.queryByRole("region", { name: TREASURE_LABELS.aria })).toBeNull();
});
