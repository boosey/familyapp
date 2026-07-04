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

  // These two pin the hazard the StoryComposer lifted-history fix relies on: a resetKey that CHURNS
  // across a replace() silently wipes the seeded undo step, whereas a STABLE resetKey preserves it.
  // (This is the honest guard — a StoryComposer-level assertion isn't observable pre-Slice-10, since
  // no editor is mounted during capture; the append seeds history into an unmounted editor.)
  it("a CHURNING resetKey across a replace collapses the stack (wipes the seeded step) — the hazard", () => {
    const { rerender } = render(<Harness initial="a" resetKey="k1" />);
    click("replace"); // stack: ["a", "POLISHED"], value "POLISHED"
    expect(val()).toBe("POLISHED");
    expect(canUndo()).toBe("true"); // the replace is undoable...

    // ...until the resetKey churns to a different value. The re-baseline effect fires and collapses
    // the stack to just the current value → the undo step replace() built is silently gone. THIS is
    // why StoryComposer keys on the stable `draft?.storyId`, NOT the churning `activeStoryId`.
    rerender(<Harness initial="a" resetKey="k2" />);
    expect(val()).toBe("POLISHED"); // the text survives (value lives in the parent)...
    expect(canUndo()).toBe("false"); // ...but the undo history was wiped.
  });

  it("a STABLE resetKey across a replace PRESERVES the seeded undo step — what the fix relies on", () => {
    const { rerender } = render(<Harness initial="a" resetKey="k1" />);
    click("replace");
    expect(canUndo()).toBe("true");

    // Same resetKey on the next render → the re-baseline effect early-returns; the stack is intact.
    rerender(<Harness initial="a" resetKey="k1" />);
    expect(canUndo()).toBe("true");
    click("undo");
    expect(val()).toBe("a"); // the seeded step is still walkable back to the original
  });

  // ADR-0014 Inc 3 slice 10, forward-risk (iii): the returned handle must be a STABLE object across
  // renders that don't change any member, so a parent can safely put it in long-lived callback deps
  // and a MediaRecorder onstop closure without churn/stale-closure risk. Its identity DOES change when
  // an affordance (canUndo/canRedo) flips — that's the signal downstream deps want.
  it("returns a memoized handle: stable identity across an inert re-render, new identity when canUndo flips", () => {
    const handles: unknown[] = [];
    function IdentityHarness({ bump }: { bump: number }) {
      const [value, setValue] = useState("");
      const h = useProseHistory(value, setValue);
      handles.push(h);
      return (
        <div>
          <span data-testid="bump">{bump}</span>
          <textarea data-testid="ta" value={value} onChange={(e) => setValue(e.target.value)} />
          <button data-testid="replace" onClick={() => h.replace("X")}>p</button>
        </div>
      );
    }

    const { rerender } = render(<IdentityHarness bump={0} />);
    const first = handles.at(-1);

    // Inert re-render (a new unrelated prop) → no member changed → SAME handle identity.
    rerender(<IdentityHarness bump={1} />);
    expect(handles.at(-1)).toBe(first);

    // A replace flips canUndo false→true → the handle identity MUST change so deps re-fire.
    click("replace");
    expect(handles.at(-1)).not.toBe(first);
  });
});
