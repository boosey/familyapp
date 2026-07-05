// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { OwnerActionMenu } from "../app/hub/stories/[id]/OwnerActionMenu";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const defaultProps = {
  storyId: "story-123",
  onEditDetails: vi.fn(),
  onManageSharing: vi.fn(),
  onEditStory: vi.fn(),
};

describe("OwnerActionMenu", () => {
  it("renders absolutely nothing when isOwner is false", () => {
    const { container } = render(
      <OwnerActionMenu {...defaultProps} isOwner={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the menu trigger when isOwner is true", () => {
    render(<OwnerActionMenu {...defaultProps} isOwner={true} />);
    const trigger = screen.getByLabelText("Story options");
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("opens the menu on clicking the trigger, and closes on Escape key", () => {
    render(<OwnerActionMenu {...defaultProps} isOwner={true} />);
    const trigger = screen.getByLabelText("Story options");
    
    // Menu is not open initially
    expect(screen.queryByRole("menu")).toBeNull();

    // Click to open
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();

    // Escape to close
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu on clicking outside", () => {
    render(
      <div>
        <div data-testid="outside">Outside Element</div>
        <OwnerActionMenu {...defaultProps} isOwner={true} />
      </div>
    );
    const trigger = screen.getByLabelText("Story options");
    
    // Click to open
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();

    // Click outside
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
