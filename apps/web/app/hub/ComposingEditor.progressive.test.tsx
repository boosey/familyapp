// @vitest-environment jsdom
/**
 * Capture progressive action row — Speak/Type · Polish · Finish uses HubProgressiveControlRow
 * with collapse precedence Speak/Type (views) → Polish (family) → Finish (action).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { HubProgressiveControlRow } from "./HubProgressiveControlRow";

afterEach(cleanup);

const slots = {
  views: {
    expanded: <span data-testid="mode-labeled">Speak Type</span>,
    collapsed: <span data-testid="mode-icon">ST</span>,
  },
  family: {
    expanded: <span data-testid="polish-labeled">Polish</span>,
    collapsed: <span data-testid="polish-icon">P</span>,
  },
  action: {
    labeled: <span data-testid="finish-labeled">Finish</span>,
    iconified: <span data-testid="finish-icon">F</span>,
  },
};

describe("capture progressive Speak/Type · Polish · Finish row", () => {
  it("collapses Speak/Type before Polish, and Finish stays labeled longest", () => {
    // gaps(2) + actionLabeled(90) + viewsCollapsed(80) + familyExpanded(100) = 16+90+80+100 = 286
    // viewsExpanded(160)+familyExpanded(100)+gaps+action = 366 — so Speak/Type must collapse first.
    render(
      <HubProgressiveControlRow
        forceAvailableWidth={300}
        forceWidths={{
          views: { expanded: 160, collapsedIcon: 80 },
          family: { expanded: 100, collapsedIcon: 48 },
          actionLabeled: 90,
          actionIconified: 48,
        }}
        {...slots}
      />,
    );

    const row = document.querySelector("[data-hub-progressive-control-row]") as HTMLElement;
    expect(row.getAttribute("data-views")).toBe("collapsed-icon");
    expect(row.getAttribute("data-family")).toBe("expanded");
    expect(row.getAttribute("data-action")).toBe("labeled");
    expect(within(row).getByTestId("mode-icon")).toBeTruthy();
    expect(within(row).getByTestId("polish-labeled")).toBeTruthy();
    expect(within(row).getByTestId("finish-labeled")).toBeTruthy();
  });

  it("iconifies Finish only after browse units are at their most-collapsed forms", () => {
    render(
      <HubProgressiveControlRow
        forceAvailableWidth={120}
        forceWidths={{
          views: { expanded: 160, collapsedIcon: 80 },
          family: { expanded: 100, collapsedIcon: 48 },
          actionLabeled: 90,
          actionIconified: 48,
        }}
        {...slots}
      />,
    );

    const row = document.querySelector("[data-hub-progressive-control-row]") as HTMLElement;
    expect(row.getAttribute("data-views")).toBe("collapsed-icon");
    expect(row.getAttribute("data-family")).toBe("collapsed-icon");
    expect(row.getAttribute("data-action")).toBe("iconified");
    expect(within(row).getByTestId("finish-icon")).toBeTruthy();
  });
});
