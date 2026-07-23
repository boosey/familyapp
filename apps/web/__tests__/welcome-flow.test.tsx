// @vitest-environment jsdom
/**
 * WelcomeFlow: onboarding is welcome → name → dob → phone (optional SMS). The final Continue (or
 * Skip on phone) submits name + DOB (+ optional SMS opt-in), then routes into /hub/about-you.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WelcomeFlow } from "@/app/welcome/WelcomeFlow";
import { welcome } from "@/app/_copy";

vi.mock("@/app/welcome/actions", () => ({
  completeAccountOnboarding: vi.fn(async () => {}),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { completeAccountOnboarding } from "@/app/welcome/actions";

/** Drive welcome → name → dob and fill in the three DOB selects. Leaves you on the DOB step. */
function fillNameAndDob(name = "Alex Boudreaux") {
  fireEvent.click(screen.getByRole("button", { name: /begin/i }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  const [monthSel, daySel, yearSel] = screen.getAllByRole("combobox");
  fireEvent.change(monthSel!, { target: { value: "6" } });
  fireEvent.change(daySel!, { target: { value: "15" } });
  fireEvent.change(yearSel!, { target: { value: "1970" } });
}

/** After DOB is filled, advance to the phone step. */
function goToPhoneStep() {
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  expect(screen.getByTestId("welcome-phone")).toBeTruthy();
}

describe("WelcomeFlow", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("pre-fills the name field from initialName", () => {
    render(<WelcomeFlow initialName="Alex Boudreaux" invited={false} />);
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Alex Boudreaux");
  });

  it("blank initialName: Continue on the name step is disabled until a name is typed", () => {
    render(<WelcomeFlow initialName="" invited={false} />);
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));
    expect(
      (screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Rosa" } });
    expect(
      (screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("skips phone: submits name + DOB only, then routes into intake", async () => {
    render(<WelcomeFlow initialName="" invited={false} />);

    fillNameAndDob("Alex Boudreaux");
    goToPhoneStep();
    fireEvent.click(screen.getByRole("button", { name: welcome.phoneSkip }));

    await waitFor(() =>
      expect(completeAccountOnboarding).toHaveBeenCalledWith({
        displayName: "Alex Boudreaux",
        year: 1970,
        month: 6,
        day: 15,
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hub/about-you"));
  });

  it("trims the entered name before submitting (via phone skip)", async () => {
    render(<WelcomeFlow initialName="" invited={false} />);

    fillNameAndDob("  Alex Boudreaux  ");
    goToPhoneStep();
    fireEvent.click(screen.getByRole("button", { name: welcome.phoneSkip }));

    await waitFor(() =>
      expect(completeAccountOnboarding).toHaveBeenCalledWith({
        displayName: "Alex Boudreaux",
        year: 1970,
        month: 6,
        day: 15,
      }),
    );
  });

  it("phone + unchecked consent: Continue stays disabled; after check, submits with smsConsent", async () => {
    render(<WelcomeFlow initialName="" invited={false} />);
    fillNameAndDob("Alex Boudreaux");
    goToPhoneStep();

    fireEvent.change(screen.getByTestId("welcome-phone"), { target: { value: "+15551230000" } });
    const consent = screen.getByTestId("welcome-sms-consent");
    expect(consent.textContent).toContain("SMS text messages");
    expect(consent.textContent).toContain("STOP");
    expect((screen.getByTestId("welcome-sms-consent-checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(
      (screen.getByRole("button", { name: welcome.continue }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByTestId("welcome-sms-consent-checkbox"));
    fireEvent.click(screen.getByRole("button", { name: welcome.continue }));

    await waitFor(() =>
      expect(completeAccountOnboarding).toHaveBeenCalledWith({
        displayName: "Alex Boudreaux",
        year: 1970,
        month: 6,
        day: 15,
        phone: "+15551230000",
        smsConsent: true,
      }),
    );
  });

  it("save error: shows error copy, does not navigate, re-enables Continue", async () => {
    (completeAccountOnboarding as Mock).mockRejectedValueOnce(new Error("boom"));

    render(<WelcomeFlow initialName="" invited={false} />);

    fillNameAndDob("Alex Boudreaux");
    goToPhoneStep();
    fireEvent.click(screen.getByRole("button", { name: welcome.phoneSkip }));

    await screen.findByText("boom");
    expect(push).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: welcome.phoneSkip }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
