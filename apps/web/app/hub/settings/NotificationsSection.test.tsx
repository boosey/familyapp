// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotificationsSection } from "./NotificationsSection";

vi.mock("./actions", () => ({
  saveNotificationStreamFrequencyAction: vi.fn(async () => ({ ok: true })),
}));

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
});
