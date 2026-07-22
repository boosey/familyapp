// @vitest-environment jsdom
/**
 * BottomSheet (ADR-0024 "approach B" seam) — the reusable bottom-anchored sheet the hub tabs open on a
 * phone to group their secondary controls. These guards prove the behaviour the tabs rely on (renders
 * nothing when closed, renders children + a labelled dialog when open, closes on scrim click AND
 * Escape, a click inside the panel does NOT close), plus a string-scan of the CSS module bonding the
 * three geometry fixes it shares with ModalShell: a max-height cap, internal overflow scroll, and a
 * safe-area bottom inset (mirrors ModalShell.test.tsx's CSS-contract style).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { BottomSheet } from "./BottomSheet";

afterEach(() => cleanup());

const HERE = dirname(fileURLToPath(import.meta.url));

describe("BottomSheet — behaviour", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <BottomSheet open={false} onClose={vi.fn()} title="Filters & view">
        <p>sheet body</p>
      </BottomSheet>,
    );
    expect(container.textContent).not.toContain("sheet body");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders its children inside a titled dialog when open", () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Filters & view">
        <p>sheet body</p>
      </BottomSheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Filters & view" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-shell")).toBe("sheet");
    expect(dialog.textContent).toContain("sheet body");
  });

  it("calls onClose when the scrim is clicked", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Filters & view">
        <p>body</p>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when a click originates inside the panel", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Filters & view">
        <button type="button">inside</button>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "inside" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape while open", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Filters & view">
        <p>body</p>
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the opener when it closes (a11y regression)", () => {
    // A real opener (like the "Filters & view" trigger) holds focus before the sheet opens.
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { rerender } = render(
      <BottomSheet open onClose={vi.fn()} title="Filters & view">
        <button type="button">inside</button>
      </BottomSheet>,
    );
    // Focus moved into the sheet on open.
    expect(document.activeElement).not.toBe(opener);

    // Closing (open → false) must return focus to the opener, not strand it on <body>.
    rerender(
      <BottomSheet open={false} onClose={vi.fn()} title="Filters & view">
        <button type="button">inside</button>
      </BottomSheet>,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps focus on an input inside the sheet across parent re-renders (typing)", () => {
    function SheetWithInput({ closeStub }: { closeStub: () => void }) {
      const [value, setValue] = useState("");
      return (
        <BottomSheet open onClose={closeStub} title="Search">
          <input
            aria-label="Search stories"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </BottomSheet>
      );
    }
    const { rerender } = render(<SheetWithInput closeStub={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Search stories" });
    input.focus();
    expect(document.activeElement).toBe(input);
    // New onClose identity (parent re-render) must not steal focus back to the dialog.
    rerender(<SheetWithInput closeStub={vi.fn()} />);
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "hi" } });
    expect(document.activeElement).toBe(input);
  });

  it("has a close (✕) button labelled from copy", () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Filters & view">
        <p>body</p>
      </BottomSheet>,
    );
    // The close control exists and is a real button (its accessible name comes from hub.mobileControls.close).
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

describe("BottomSheet — CSS contract (shared cap + scroll + safe-area, bottom-anchored)", () => {
  const css = readFileSync(join(HERE, "BottomSheet.module.css"), "utf8");

  it("caps panel height and scrolls internally", () => {
    expect(css).toContain("max-height: min(85dvh");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("overscroll-behavior: contain");
  });

  it("clears the home indicator with a safe-area bottom inset", () => {
    expect(css).toContain("env(safe-area-inset-bottom)");
  });

  it("anchors to the bottom with top-only rounding", () => {
    expect(css).toContain("align-items: flex-end");
    expect(css).toContain("border-top-left-radius: var(--radius-lg)");
    expect(css).toContain("border-top-right-radius: var(--radius-lg)");
  });

  it("suppresses the slide-up animation under reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain('data-reduce-motion="on"');
  });
});
