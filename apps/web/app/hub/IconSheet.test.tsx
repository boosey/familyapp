// @vitest-environment jsdom
/**
 * IconSheet (#300) — labeled icon trigger with shared panel body; shell is sheet (compact) or
 * popover (wide) via resolveCollapsedBrowseShell + useIsCompact. Badge / label clarity preserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LayoutGrid } from "lucide-react";
import { IconSheet } from "./IconSheet";

let compact = false;

vi.mock("@/app/_kindred/useIsCompact", () => ({
  useIsCompact: () => compact,
}));

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  compact = false;
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      x: 40,
      y: 80,
      top: 80,
      left: 40,
      bottom: 120,
      right: 100,
      width: 60,
      height: 40,
      toJSON() {
        return {};
      },
    }) as DOMRect;
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  cleanup();
});

describe("IconSheet — trigger clarity (badge + label)", () => {
  it("renders a labeled icon trigger (label text + an svg glyph)", () => {
    render(
      <IconSheet icon={LayoutGrid} label="View" sheetTitle="View">
        <p>controls</p>
      </IconSheet>,
    );
    const trigger = screen.getByRole("button", { name: /View/ });
    expect(trigger.textContent).toContain("View");
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("renders NO badge when badgeCount is 0 or undefined (name is just the label)", () => {
    const { rerender } = render(
      <IconSheet icon={LayoutGrid} label="View" sheetTitle="View">
        <p>x</p>
      </IconSheet>,
    );
    expect(screen.getByRole("button", { name: "View" }).getAttribute("aria-label")).toBe("View");
    rerender(
      <IconSheet icon={LayoutGrid} label="View" sheetTitle="View" badgeCount={0}>
        <p>x</p>
      </IconSheet>,
    );
    expect(screen.getByRole("button", { name: "View" }).getAttribute("aria-label")).toBe("View");
  });

  it("badges when badgeCount > 0 — the visible count + the active-count phrase in the accessible name", () => {
    render(
      <IconSheet icon={LayoutGrid} label="Filter" sheetTitle="Filter" badgeCount={2}>
        <p>x</p>
      </IconSheet>,
    );
    expect(screen.getByText("2")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: /Filter/ });
    expect(trigger.getAttribute("aria-label")).toBe("Filter, 2 filters active");
  });
});

describe("IconSheet — shell selection (compact sheet / wide popover)", () => {
  it("opens an anchored popover on wide viewports (shared panel body)", () => {
    compact = false;
    render(
      <IconSheet icon={LayoutGrid} label="Search" sheetTitle="Search">
        <p>shared panel body</p>
      </IconSheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Search/ }));

    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(dialog.getAttribute("data-shell")).toBe("popover");
    expect(dialog.textContent).toContain("shared panel body");
  });

  it("opens a bottom sheet on compact viewports (same shared panel body)", () => {
    compact = true;
    render(
      <IconSheet icon={LayoutGrid} label="Family" sheetTitle="Family">
        <p>shared panel body</p>
      </IconSheet>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Family/ }));

    const dialog = screen.getByRole("dialog", { name: "Family" });
    expect(dialog.getAttribute("data-shell")).toBe("sheet");
    expect(dialog.textContent).toContain("shared panel body");
  });

  it("keeps children hidden until the trigger is clicked", () => {
    compact = true;
    render(
      <IconSheet icon={LayoutGrid} label="Filter" sheetTitle="Filter">
        <p>secondary controls</p>
      </IconSheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("secondary controls")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    expect(screen.getByRole("dialog", { name: "Filter" }).textContent).toContain("secondary controls");
  });
});
