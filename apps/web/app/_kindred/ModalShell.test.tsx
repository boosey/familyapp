// @vitest-environment jsdom
/**
 * ModalShell (ADR-0024 Round A) — the shared mobile-dialog wrapper the bespoke modals adopt in Round B.
 * These guards prove the behaviour Round B relies on (children render, overlay click closes, a click
 * inside the surface does NOT close, per-modal maxWidth is wired), plus a string-scan of the CSS module
 * bonding the three fixes the modals lacked: a max-height cap, internal overflow scroll, and safe-area
 * edge inset (mirrors the string-scan style of responsive-breakpoints.test.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModalShell } from "./ModalShell";

afterEach(() => cleanup());

const HERE = dirname(fileURLToPath(import.meta.url));

describe("ModalShell — behaviour", () => {
  it("renders its children inside a spreadable dialog surface", () => {
    render(
      <ModalShell onOverlayClick={vi.fn()} role="dialog" aria-modal="true" aria-label="Add relative">
        <p>form body</p>
      </ModalShell>,
    );
    const dialog = screen.getByRole("dialog", { name: "Add relative" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("form body");
  });

  it("calls onOverlayClick when the scrim is clicked", () => {
    const onOverlayClick = vi.fn();
    render(
      <ModalShell onOverlayClick={onOverlayClick} data-testid="shell">
        <p>body</p>
      </ModalShell>,
    );
    // The overlay is the presentation wrapper around the surface.
    const overlay = screen.getByRole("presentation");
    fireEvent.click(overlay);
    expect(onOverlayClick).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onOverlayClick when a click originates inside the surface", () => {
    const onOverlayClick = vi.fn();
    render(
      <ModalShell onOverlayClick={onOverlayClick}>
        <button type="button">inside</button>
      </ModalShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "inside" }));
    expect(onOverlayClick).not.toHaveBeenCalled();
  });

  it("wires the per-modal maxWidth through the --modal-shell-max-width custom property", () => {
    render(
      <ModalShell onOverlayClick={vi.fn()} maxWidth={440} role="dialog" aria-label="x">
        <p>body</p>
      </ModalShell>,
    );
    const dialog = screen.getByRole("dialog", { name: "x" });
    expect(dialog.style.getPropertyValue("--modal-shell-max-width")).toBe("440px");
  });

  it("defaults maxWidth to 480px when omitted", () => {
    render(
      <ModalShell onOverlayClick={vi.fn()} role="dialog" aria-label="y">
        <p>body</p>
      </ModalShell>,
    );
    expect(
      screen.getByRole("dialog", { name: "y" }).style.getPropertyValue("--modal-shell-max-width"),
    ).toBe("480px");
  });
});

describe("ModalShell — CSS contract (the three fixes the bespoke modals lacked)", () => {
  const css = readFileSync(join(HERE, "ModalShell.module.css"), "utf8");

  it("caps surface height and scrolls internally", () => {
    expect(css).toContain("max-height: var(--modal-max-height)");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("overscroll-behavior: contain");
  });

  it("insets from the screen edges with safe-area on every side", () => {
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(css).toContain(`env(safe-area-inset-${side})`);
    }
    expect(css).toContain("var(--modal-edge-inset)");
  });
});
