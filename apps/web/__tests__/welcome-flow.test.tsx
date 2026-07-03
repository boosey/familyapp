// @vitest-environment jsdom
/**
 * WelcomeFlow: the onboarding state machine is welcome → name → dob. The final Continue submits the
 * user-entered name AND the DOB in one server call, then routes STRAIGHT into the intake surface
 * (/hub/about-you) — the old "doors" fork is gone, so family creation can no longer be skipped from
 * here. Mocks the completeAccountOnboarding server action and next/navigation's router.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WelcomeFlow } from "@/app/welcome/WelcomeFlow";

vi.mock("@/app/welcome/actions", () => ({
  completeAccountOnboarding: vi.fn(async () => {}),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { completeAccountOnboarding } from "@/app/welcome/actions";

/** Drive welcome → name → dob and fill in the three DOB selects. */
function fillNameAndDob(name = "Alex Boudreaux") {
  // welcome step → begin ("Let's begin")
  fireEvent.click(screen.getByRole("button", { name: /begin/i }));

  // name step: type a name, then Continue
  fireEvent.change(screen.getByRole("textbox"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));

  // dob step: the three selects are month / day / year in order.
  const [monthSel, daySel, yearSel] = screen.getAllByRole("combobox");
  fireEvent.change(monthSel!, { target: { value: "6" } });
  fireEvent.change(daySel!, { target: { value: "15" } });
  fireEvent.change(yearSel!, { target: { value: "1970" } });
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

  it("submits the entered name + DOB in one call, then routes into intake (no doors fork)", async () => {
    render(<WelcomeFlow initialName="" invited={false} />);

    fillNameAndDob("Alex Boudreaux");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

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

  it("trims the entered name before submitting", async () => {
    render(<WelcomeFlow initialName="" invited={false} />);

    fillNameAndDob("  Alex Boudreaux  ");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(completeAccountOnboarding).toHaveBeenCalledWith({
        displayName: "Alex Boudreaux",
        year: 1970,
        month: 6,
        day: 15,
      }),
    );
  });

  it("save error: shows dobSaveError copy, does not navigate, re-enables Continue", async () => {
    (completeAccountOnboarding as Mock).mockRejectedValueOnce(new Error("boom"));

    render(<WelcomeFlow initialName="" invited={false} />);

    fillNameAndDob("Alex Boudreaux");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // catch block surfaces welcome.dobSaveError.
    await screen.findByText(/something went wrong saving that/i);
    // The failure must not navigate away.
    expect(push).not.toHaveBeenCalled();
    // busy reset to false → Continue re-enabled (asserting the disabled prop directly,
    // matching the project convention in about-you-flow.test.tsx).
    expect(
      (screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
