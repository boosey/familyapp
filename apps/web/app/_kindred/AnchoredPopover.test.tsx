// @vitest-environment jsdom
/**
 * AnchoredPopover (#300) — wide shell for collapsed browse panels. Open/close, title, Escape,
 * outside-click dismiss, focus stability while typing, and right-edge clamp.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { AnchoredPopover } from "./AnchoredPopover";
import { ANCHORED_POPOVER_EDGE_GUTTER_PX, ANCHORED_POPOVER_MAX_WIDTH_PX } from "./anchored-popover-constants";

function Harness({
  startOpen = false,
  withInput = false,
}: {
  startOpen?: boolean;
  withInput?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [value, setValue] = useState("");
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div>
      <button ref={anchorRef} type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <AnchoredPopover open={open} onClose={() => setOpen(false)} title="Views" anchorRef={anchorRef}>
        {withInput ? (
          <input
            aria-label="Search stories"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <p>layout options</p>
        )}
      </AnchoredPopover>
      <button type="button">Outside</button>
    </div>
  );
}

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

function stubRect(partial: Partial<DOMRect>) {
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      bottom: 50,
      right: 80,
      width: 70,
      height: 30,
      toJSON() {
        return {};
      },
      ...partial,
    }) as DOMRect;
}

beforeEach(() => {
  stubRect({});
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  cleanup();
});

describe("AnchoredPopover", () => {
  it("renders nothing while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens as a titled dialog with panel body and data-shell=popover", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Views" });
    expect(dialog.getAttribute("data-shell")).toBe("popover");
    expect(dialog.textContent).toContain("layout options");
    expect(screen.getByRole("heading", { name: "Views" })).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on outside pointerdown", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes via the Close control", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus into the dialog on open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Views" });
    expect(document.activeElement).toBe(dialog);
  });

  it("keeps focus on an input inside the panel across parent re-renders (typing)", () => {
    render(<Harness withInput />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const input = screen.getByRole("textbox", { name: "Search stories" });
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "a" } });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "ab" } });
    expect(document.activeElement).toBe(input);
  });

  it("clamps left using the max-width budget so a right-edge anchor cannot overflow", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    stubRect({ left: 600, right: 640, width: 40, top: 20, bottom: 50 });

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Views" });
    const left = Number.parseFloat(dialog.style.left);
    const width = Number.parseFloat(dialog.style.width);
    const budget = Math.min(ANCHORED_POPOVER_MAX_WIDTH_PX, 640 - ANCHORED_POPOVER_EDGE_GUTTER_PX * 2);
    expect(width).toBe(budget);
    expect(left + width).toBeLessThanOrEqual(640 - ANCHORED_POPOVER_EDGE_GUTTER_PX);
    expect(left).toBe(640 - budget - ANCHORED_POPOVER_EDGE_GUTTER_PX);
  });
});
