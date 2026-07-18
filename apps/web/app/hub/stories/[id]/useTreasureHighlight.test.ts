// @vitest-environment jsdom
/**
 * useTreasureHighlight (Task 8, highlight-to-treasure) unit tests.
 *
 * The hook binds mouseup/touchend on a scope element and, on a non-empty selection whose range is
 * inside that element, calls `onTreasure(trimmedText)` and clears the selection. It must ignore
 * collapsed selections, selections outside the scope, and must not bind at all when disabled.
 *
 * jsdom has no real selection engine, so we mock `window.getSelection` to hand back a fake Selection
 * and build a range whose `commonAncestorContainer` is a real DOM node (so `el.contains(...)` is
 * genuinely exercised).
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useTreasureHighlight } from "./useTreasureHighlight";

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  container.textContent = "The whole treasured line lived here.";
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

/**
 * Install a fake Selection. `insideText` chooses whether the range's commonAncestorContainer is a
 * node inside `container` (treasure should fire) or a detached node outside it (should be ignored).
 */
function mockSelection(opts: {
  text: string;
  isCollapsed: boolean;
  rangeCount: number;
  inside: boolean;
}) {
  const commonAncestorContainer = opts.inside
    ? (container.firstChild as Node) // the text node inside the container
    : document.createElement("div"); // detached, not inside the container

  const removeAllRanges = vi.fn();
  const getRangeAt = vi.fn(() => ({ commonAncestorContainer }));

  const fakeSelection = {
    isCollapsed: opts.isCollapsed,
    rangeCount: opts.rangeCount,
    getRangeAt,
    removeAllRanges,
    toString: () => opts.text,
  } as unknown as Selection;

  vi.spyOn(window, "getSelection").mockReturnValue(fakeSelection);
  return { removeAllRanges, getRangeAt };
}

function renderOnContainer(enabled: boolean, onTreasure: (t: string) => void) {
  const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
  ref.current = container;
  renderHook(() => useTreasureHighlight(ref, enabled, onTreasure));
}

it("fires onTreasure once with trimmed text and clears the selection for an in-scope selection", () => {
  const onTreasure = vi.fn();
  const { removeAllRanges } = mockSelection({
    text: "  treasured line  ",
    isCollapsed: false,
    rangeCount: 1,
    inside: true,
  });
  renderOnContainer(true, onTreasure);

  container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  expect(onTreasure).toHaveBeenCalledTimes(1);
  expect(onTreasure).toHaveBeenCalledWith("treasured line");
  expect(removeAllRanges).toHaveBeenCalledTimes(1);
});

it("does nothing for a collapsed selection", () => {
  const onTreasure = vi.fn();
  const { removeAllRanges } = mockSelection({
    text: "",
    isCollapsed: true,
    rangeCount: 1,
    inside: true,
  });
  renderOnContainer(true, onTreasure);

  container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  expect(onTreasure).not.toHaveBeenCalled();
  expect(removeAllRanges).not.toHaveBeenCalled();
});

it("ignores a selection whose range is outside the scope element", () => {
  const onTreasure = vi.fn();
  const { removeAllRanges } = mockSelection({
    text: "something elsewhere",
    isCollapsed: false,
    rangeCount: 1,
    inside: false,
  });
  renderOnContainer(true, onTreasure);

  container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  expect(onTreasure).not.toHaveBeenCalled();
  expect(removeAllRanges).not.toHaveBeenCalled();
});

it("does not bind a listener when disabled", () => {
  const onTreasure = vi.fn();
  const getSelection = mockSelection({
    text: "treasured line",
    isCollapsed: false,
    rangeCount: 1,
    inside: true,
  });
  renderOnContainer(false, onTreasure);

  container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  expect(onTreasure).not.toHaveBeenCalled();
  // getSelection is never even consulted because the handler was never bound.
  expect(getSelection.getRangeAt).not.toHaveBeenCalled();
});
