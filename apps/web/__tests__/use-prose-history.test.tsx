// @vitest-environment jsdom
/**
 * useProseHistory: undo/redo over a controlled text value. The VALUE lives in the parent (here a
 * harness holding useState) exactly as KindredProseEditor uses it; the hook layers a coalesced
 * snapshot stack on top and drives undo/redo/replace via the parent's onChange.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useProseHistory } from "@/lib/use-prose-history";

function Harness({ initial, resetKey }: { initial: string; resetKey?: string }) {
  const [value, setValue] = useState(initial);
  const h = useProseHistory(value, setValue, resetKey);
  return (
    <div>
      <textarea data-testid="ta" value={value} onChange={(e) => setValue(e.target.value)} />
      <span data-testid="val">{value}</span>
      <span data-testid="canUndo">{String(h.canUndo)}</span>
      <span data-testid="canRedo">{String(h.canRedo)}</span>
      <button data-testid="undo" onClick={h.undo}>u</button>
      <button data-testid="redo" onClick={h.redo}>r</button>
      <button data-testid="replace" onClick={() => h.replace("POLISHED")}>p</button>
    </div>
  );
}

const val = () => screen.getByTestId("val").textContent;
const canUndo = () => screen.getByTestId("canUndo").textContent;
const canRedo = () => screen.getByTestId("canRedo").textContent;
const type = (v: string) =>
  act(() => {
    fireEvent.change(screen.getByTestId("ta"), { target: { value: v } });
  });
const click = (id: string) => act(() => void fireEvent.click(screen.getByTestId(id)));
const tick = () => act(() => void vi.advanceTimersByTime(600));

describe("useProseHistory", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("coalesces a run of keystrokes into one undo step, then redo restores", () => {
    render(<Harness initial="" />);
    type("a");
    type("ab");
    type("abc");
    // Before the debounce fires there is still an uncommitted value → undo is already available.
    expect(canUndo()).toBe("true");
    tick(); // snapshot "abc"

    click("undo");
    expect(val()).toBe(""); // back to the original baseline
    expect(canRedo()).toBe("true");

    click("redo");
    expect(val()).toBe("abc");
    expect(canRedo()).toBe("false");
  });

  it("undo immediately after typing (before the debounce) still reverts the typing", () => {
    render(<Harness initial="" />);
    type("hello");
    // no tick — the debounce snapshot has NOT fired yet
    click("undo");
    expect(val()).toBe("");
  });

  it("a polish (replace) is reversible: undo returns to the pre-polish text, then to the original", () => {
    render(<Harness initial="orig" />);
    type("orig edited");
    tick();

    click("replace");
    expect(val()).toBe("POLISHED");

    click("undo");
    expect(val()).toBe("orig edited");

    click("undo");
    expect(val()).toBe("orig");
    expect(canUndo()).toBe("false");
  });

  it("typing after an undo clears the redo future", () => {
    render(<Harness initial="" />);
    type("first");
    tick();
    click("undo"); // back to ""
    expect(canRedo()).toBe("true");
    type("second");
    // A fresh edit invalidates the redo branch.
    expect(canRedo()).toBe("false");
  });

  it("resetKey re-baselines history (a new document mounts with a clean stack)", () => {
    const { rerender } = render(<Harness initial="a" resetKey="k1" />);
    type("ab");
    tick();
    expect(canUndo()).toBe("true");

    rerender(<Harness initial="a" resetKey="k2" />);
    // History is re-baselined to the current value → nothing to undo.
    expect(canUndo()).toBe("false");
  });
});
