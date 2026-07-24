// @vitest-environment jsdom
/**
 * Account › Privacy — PrivacyForm (ADR-0029 §#331), covering the SegmentedControl-toggle migration
 * (design-out change #2/#7): the Hidden/Visible pill pair replaces the old <input type="checkbox">,
 * but the save/optimistic/rollback contract on `onToggle` must be unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PrivacyForm } from "./PrivacyForm";
import { saveHideEmailAction, saveHidePhoneAction } from "./actions";

vi.mock("./actions", () => ({
  saveHideEmailAction: vi.fn(async () => ({ ok: true })),
  saveHidePhoneAction: vi.fn(async () => ({ ok: true })),
}));

const saveEmailMock = vi.mocked(saveHideEmailAction);
const savePhoneMock = vi.mocked(saveHidePhoneAction);

afterEach(() => {
  cleanup();
  saveEmailMock.mockClear();
  savePhoneMock.mockClear();
});

describe("PrivacyForm", () => {
  it("renders a Hidden/Visible toggle per field, defaulting to the initial value", () => {
    render(<PrivacyForm hideEmail={true} hidePhone={false} />);
    const groups = screen.getAllByRole("group");
    expect(groups.length).toBe(2);
    // Email starts hidden — its "Hidden" pill is pressed.
    const emailGroup = screen.getByRole("group", { name: /hide my email/i });
    expect(
      emailGroup.querySelector('button[aria-pressed="true"]')?.textContent,
    ).toBe("Hidden");
    // Phone starts visible — its "Visible" pill is pressed.
    const phoneGroup = screen.getByRole("group", { name: /hide my phone/i });
    expect(
      phoneGroup.querySelector('button[aria-pressed="true"]')?.textContent,
    ).toBe("Visible");
  });

  it("choosing Visible calls the save action with false and flips the pressed pill", async () => {
    render(<PrivacyForm hideEmail={true} hidePhone={false} />);
    const emailGroup = screen.getByRole("group", { name: /hide my email/i });
    fireEvent.click(within(emailGroup).getByRole("button", { name: "Visible" }));
    await vi.waitFor(() => {
      expect(saveEmailMock).toHaveBeenCalledWith(false);
    });
    expect(
      emailGroup.querySelector('button[aria-pressed="true"]')?.textContent,
    ).toBe("Visible");
  });

  it("rolls back the optimistic flip when the save action errors", async () => {
    saveEmailMock.mockResolvedValueOnce({ error: "save_failed" });
    render(<PrivacyForm hideEmail={false} hidePhone={false} />);
    const emailGroup = screen.getByRole("group", { name: /hide my email/i });
    // The save-status hint renders as a sibling of the toggle row, both inside the field's outer wrapper.
    const emailField = emailGroup.parentElement!.parentElement!;
    fireEvent.click(within(emailGroup).getByRole("button", { name: "Hidden" }));
    await vi.waitFor(() => {
      expect(within(emailField).getByText(/couldn't save/i)).toBeTruthy();
    });
    // Reverted back to Visible after the failed save.
    expect(
      emailGroup.querySelector('button[aria-pressed="true"]')?.textContent,
    ).toBe("Visible");
  });
});
