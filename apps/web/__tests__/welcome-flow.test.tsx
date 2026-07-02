// @vitest-environment jsdom
/**
 * WelcomeFlow: after the DOB step is saved, the flow routes STRAIGHT into the intake surface
 * (/hub/about-you) — the old "doors" fork is gone, so family creation can no longer be skipped
 * from here. Mocks the saveDob server action and next/navigation's router.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WelcomeFlow } from "@/app/welcome/WelcomeFlow";

vi.mock("@/app/welcome/actions", () => ({
  saveDob: vi.fn(async () => {}),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { saveDob } from "@/app/welcome/actions";

describe("WelcomeFlow", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("after saving DOB, routes into intake (no doors fork)", async () => {
    render(<WelcomeFlow firstName="Alex" invited={false} />);

    // welcome step → begin ("Let's begin")
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));

    // dob step: the three selects are month / day / year in order.
    const [monthSel, daySel, yearSel] = screen.getAllByRole("combobox");
    fireEvent.change(monthSel!, { target: { value: "6" } });
    fireEvent.change(daySel!, { target: { value: "15" } });
    fireEvent.change(yearSel!, { target: { value: "1970" } });

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(saveDob).toHaveBeenCalledWith({ year: 1970, month: 6, day: 15 }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hub/about-you"));
  });

  it("saveDob error: shows dobSaveError copy, does not navigate, re-enables Continue", async () => {
    (saveDob as Mock).mockRejectedValueOnce(new Error("boom"));

    render(<WelcomeFlow firstName="Alex" invited={false} />);

    fireEvent.click(screen.getByRole("button", { name: /begin/i }));

    const [monthSel, daySel, yearSel] = screen.getAllByRole("combobox");
    fireEvent.change(monthSel!, { target: { value: "6" } });
    fireEvent.change(daySel!, { target: { value: "15" } });
    fireEvent.change(yearSel!, { target: { value: "1970" } });

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
