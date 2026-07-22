// @vitest-environment jsdom
/**
 * SubTabsMenu (#301) — thin mechanics tests. Mirrors OwnerActionMenu.test.tsx: opens the menu, an
 * item selection both fires onSelect and closes the menu, Escape closes, and click-outside closes.
 * Precedence/expansion-stage behavior lives in resolveHubControlExpansion; this file is only the
 * menu's own open/select/close mechanics.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SubTabsMenu } from "./SubTabsMenu";
import { hub } from "@/app/_copy";

afterEach(() => {
  cleanup();
});

const items = [
  { key: "feed", label: hub.browse.modeFeed },
  { key: "timeline", label: hub.browse.modeTimeline },
];

describe("SubTabsMenu", () => {
  it("opens the menu on clicking the trigger (aria-expanded true)", () => {
    render(<SubTabsMenu items={items} active="feed" onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: hub.mobileControls.subTabsMenuAria });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);

    expect(screen.getByRole("menu", { name: hub.mobileControls.subTabsMenuAria })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("selecting an item calls onSelect with its key and closes the menu", () => {
    const onSelect = vi.fn();
    render(<SubTabsMenu items={items} active="feed" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.subTabsMenuAria }));

    fireEvent.click(screen.getByRole("menuitem", { name: hub.browse.modeTimeline }));

    expect(onSelect).toHaveBeenCalledWith("timeline");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape closes the open menu", () => {
    render(<SubTabsMenu items={items} active="feed" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.subTabsMenuAria }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicking outside closes the open menu", () => {
    render(
      <div>
        <div data-testid="outside">Outside Element</div>
        <SubTabsMenu items={items} active="feed" onSelect={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.subTabsMenuAria }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.pointerDown(screen.getByTestId("outside"));

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
