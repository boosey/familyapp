// @vitest-environment jsdom
/**
 * IconSheet (ADR-0025 Phase B, Increment 3) — a labeled lucide-icon trigger that opens the shared
 * BottomSheet holding its controls. Guards: the trigger shows its label + glyph, tapping it opens the
 * sheet (revealing the children under the given title), and the active-count badge shows ONLY when
 * badgeCount > 0 (Increment 4 wiring; Step A passes none).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LayoutGrid } from "lucide-react";
import { IconSheet } from "./IconSheet";

afterEach(() => cleanup());

describe("IconSheet", () => {
  it("renders a labeled icon trigger (label text + an svg glyph)", () => {
    render(
      <IconSheet icon={LayoutGrid} label="View" sheetTitle="View">
        <p>controls</p>
      </IconSheet>,
    );
    const trigger = screen.getByRole("button", { name: /View/ });
    expect(trigger.textContent).toContain("View");
    // lucide renders an <svg>; the glyph is present and aria-hidden.
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("keeps children hidden until the trigger is clicked, then reveals them in the sheet", () => {
    render(
      <IconSheet icon={LayoutGrid} label="Filter" sheetTitle="Filter">
        <p>secondary controls</p>
      </IconSheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("secondary controls")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));

    const dialog = screen.getByRole("dialog", { name: "Filter" });
    expect(dialog.textContent).toContain("secondary controls");
  });

  it("renders NO badge when badgeCount is 0 or undefined", () => {
    const { rerender } = render(
      <IconSheet icon={LayoutGrid} label="View" sheetTitle="View">
        <p>x</p>
      </IconSheet>,
    );
    expect(screen.queryByLabelText(/filter.* active/)).toBeNull();
    rerender(
      <IconSheet icon={LayoutGrid} label="View" sheetTitle="View" badgeCount={0}>
        <p>x</p>
      </IconSheet>,
    );
    expect(screen.queryByLabelText(/filter.* active/)).toBeNull();
  });

  it("renders the accent count badge (with its count) when badgeCount > 0", () => {
    render(
      <IconSheet icon={LayoutGrid} label="Filter" sheetTitle="Filter" badgeCount={2}>
        <p>x</p>
      </IconSheet>,
    );
    const badge = screen.getByLabelText("2 filters active");
    expect(badge.textContent).toBe("2");
  });
});
