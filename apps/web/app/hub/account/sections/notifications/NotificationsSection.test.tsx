// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NotificationsSection } from "./NotificationsSection";
import { saveNotificationStreamFrequencyAction } from "./actions";

vi.mock("./actions", () => ({
  saveNotificationStreamFrequencyAction: vi.fn(async () => ({ ok: true })),
}));

const saveMock = vi.mocked(saveNotificationStreamFrequencyAction);

afterEach(() => {
  cleanup();
});

describe("NotificationsSection", () => {
  it("shows all three streams with every item | off only (no digest labels)", () => {
    render(
      <NotificationsSection
        initialFrequencies={{
          questions_for_me: "every_item",
          answers_to_my_asks: "every_item",
          family_activity: "off",
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: /notifications/i })).toBeTruthy();
    expect(screen.getByText("Questions for me")).toBeTruthy();
    expect(screen.getByText("Answers to my asks")).toBeTruthy();
    expect(screen.getByText("Family activity")).toBeTruthy();
    expect(screen.getAllByRole("radio", { name: /every item/i }).length).toBe(3);
    expect(screen.getAllByRole("radio", { name: /^off$/i }).length).toBe(3);
    expect(screen.queryByText(/daily/i)).toBeNull();
    expect(screen.queryByText(/weekly/i)).toBeNull();
    // family_activity starts off
    const familyGroup = screen.getByRole("radiogroup", { name: /family activity frequency/i });
    expect(familyGroup.querySelector('[aria-checked="true"]')?.textContent).toMatch(/off/i);
  });

  it("calls save action when Off is selected", async () => {
    saveMock.mockClear();
    render(
      <NotificationsSection
        initialFrequencies={{
          questions_for_me: "every_item",
          answers_to_my_asks: "every_item",
          family_activity: "every_item",
        }}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: /questions for me frequency/i });
    fireEvent.click(within(group).getByRole("radio", { name: /^off$/i }));
    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith("questions_for_me", "off");
    });
  });
});
