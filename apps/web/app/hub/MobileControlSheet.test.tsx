// @vitest-environment jsdom
/**
 * MobileControlSheet (ADR-0024 mobile pass) — the "⚙ Filters & view" trigger the hub tabs render on a
 * phone to open the shared BottomSheet of their secondary controls. These guards prove: the count badge
 * shows ONLY when activeCount > 0 (and reads that count), the label defaults from copy, and clicking the
 * trigger opens the sheet (revealing its children) — the closed→open transition the tabs depend on.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileControlSheet } from "./MobileControlSheet";

afterEach(() => cleanup());

describe("MobileControlSheet", () => {
  it("renders a '⚙ Filters & view' trigger (label from copy) with no badge when activeCount is 0", () => {
    render(
      <MobileControlSheet>
        <p>controls</p>
      </MobileControlSheet>,
    );
    const trigger = screen.getByRole("button", { name: /Filters & view/ });
    expect(trigger.textContent).toContain("⚙");
    // No active-count badge when nothing is filtering.
    expect(screen.queryByLabelText(/filter.* active/)).toBeNull();
  });

  it("shows the accent count badge (with its count) when activeCount > 0", () => {
    render(
      <MobileControlSheet activeCount={2}>
        <p>controls</p>
      </MobileControlSheet>,
    );
    const badge = screen.getByLabelText("2 filters active");
    expect(badge.textContent).toBe("2");
  });

  it("uses singular copy for a single active filter", () => {
    render(
      <MobileControlSheet activeCount={1}>
        <p>controls</p>
      </MobileControlSheet>,
    );
    expect(screen.getByLabelText("1 filter active")).toBeTruthy();
  });

  it("keeps the children hidden until the trigger is clicked, then reveals them in the sheet", () => {
    render(
      <MobileControlSheet activeCount={0}>
        <p>secondary controls</p>
      </MobileControlSheet>,
    );
    // Closed: no dialog, children not mounted.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("secondary controls")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Filters & view/ }));

    // Open: the BottomSheet dialog is present and hosts the children.
    const dialog = screen.getByRole("dialog", { name: "Filters & view" });
    expect(dialog.textContent).toContain("secondary controls");
  });

  it("honours a custom label on both the trigger and the sheet title", () => {
    render(
      <MobileControlSheet label="Photo filters" activeCount={0}>
        <p>x</p>
      </MobileControlSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Photo filters/ }));
    expect(screen.getByRole("dialog", { name: "Photo filters" })).toBeTruthy();
  });
});
