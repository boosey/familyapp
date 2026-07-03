// @vitest-environment jsdom
/**
 * WelcomeFlow voice wiring: the name + DOB steps each capture a clip via useMicRecorder, transcribe
 * it server-side, and PRE-FILL the typed field (name input / DOB dropdowns). This is the mic that used
 * to be a dead stub ("Voice isn't available here yet"). We mock the recorder so we can fire its
 * onRecorded directly, and mock the two transcription actions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Capture the opts useMicRecorder is called with so a test can invoke onRecorded (simulate a
// finished recording) without a real MediaRecorder.
let recorderOpts: {
  onRecorded: (blob: Blob, mime: string) => void | Promise<void>;
  onError?: () => void;
} | null = null;
vi.mock("@/lib/use-mic-recorder", () => ({
  useMicRecorder: (opts: never) => {
    recorderOpts = opts;
    return { phase: "idle", start: vi.fn(), finish: vi.fn() };
  },
}));

type SpokenDate = { year: number | null; month: number | null; day: number | null };
const transcribeOnboardingName = vi.fn<() => Promise<{ name: string }>>(async () => ({
  name: "Rosa Parks",
}));
const transcribeOnboardingDob = vi.fn<() => Promise<SpokenDate>>(async () => ({
  year: 1913,
  month: 2,
  day: 4,
}));
vi.mock("@/app/welcome/actions", () => ({
  completeAccountOnboarding: vi.fn(async () => {}),
  transcribeOnboardingName: (...a: unknown[]) => transcribeOnboardingName(...(a as [])),
  transcribeOnboardingDob: (...a: unknown[]) => transcribeOnboardingDob(...(a as [])),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { WelcomeFlow } from "@/app/welcome/WelcomeFlow";

const finishRecording = () =>
  act(async () => {
    await recorderOpts!.onRecorded(new Blob(["audio"]), "audio/webm");
  });

describe("WelcomeFlow — voice pre-fill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorderOpts = null;
    transcribeOnboardingName.mockResolvedValue({ name: "Rosa Parks" });
    transcribeOnboardingDob.mockResolvedValue({ year: 1913, month: 2, day: 4 });
  });
  afterEach(() => cleanup());

  it("name step: a spoken name fills the name input", async () => {
    render(<WelcomeFlow initialName="" invited={false} />);
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));

    await finishRecording();

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Rosa Parks");
    expect(transcribeOnboardingName).toHaveBeenCalledTimes(1);
  });

  it("dob step: a spoken date fills the month/day/year dropdowns", async () => {
    render(<WelcomeFlow initialName="" invited={false} />);
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Rosa" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await finishRecording();

    const [monthSel, daySel, yearSel] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(monthSel!.value).toBe("2");
    expect(daySel!.value).toBe("4");
    expect(yearSel!.value).toBe("1913");
    expect(transcribeOnboardingDob).toHaveBeenCalledTimes(1);
  });

  it("empty transcription falls back to a gentle 'type it instead' hint (no crash)", async () => {
    transcribeOnboardingName.mockResolvedValueOnce({ name: "" });
    render(<WelcomeFlow initialName="" invited={false} />);
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));

    await finishRecording();

    await screen.findByText(/voice didn't catch that/i);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  // Regression (reviewer #1): leaving a step while a recording/transcription is in flight would
  // orphan the recorder and misroute its transcript. Forward nav must be blocked while voice is busy.
  it("name-step Continue is disabled while a transcription is in flight", async () => {
    // A transcription that never resolves keeps `transcribing` true.
    transcribeOnboardingName.mockReturnValueOnce(new Promise(() => {}));
    render(<WelcomeFlow initialName="Alex Boudreaux" invited={false} />);
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));
    // A real, complete name is present → Continue would normally be enabled.
    expect((screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    await act(async () => {
      void recorderOpts!.onRecorded(new Blob(["audio"]), "audio/webm");
    });

    expect((screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  // Regression (reviewer #2): a partial spoken correction (month only) must clear a previously-picked
  // day that no longer fits the new month, matching the typed <select> handlers.
  it("dob step: a spoken month-only correction clears a now-out-of-range day", async () => {
    render(<WelcomeFlow initialName="" invited={false} />);
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Rosa" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const [monthSel, daySel, yearSel] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // Pick January 31, 2000 by hand.
    fireEvent.change(yearSel!, { target: { value: "2000" } });
    fireEvent.change(monthSel!, { target: { value: "1" } });
    fireEvent.change(daySel!, { target: { value: "31" } });
    expect(daySel!.value).toBe("31");

    // Now the voice says only "April" (30 days) — day 31 no longer fits and must clear.
    transcribeOnboardingDob.mockResolvedValueOnce({ year: null, month: 4, day: null });
    await finishRecording();

    expect(monthSel!.value).toBe("4");
    expect(daySel!.value).toBe("");
  });
});
