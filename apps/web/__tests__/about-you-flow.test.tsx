// @vitest-environment jsdom
/**
 * Integration test for AboutYouFlow: verifies the typed path (type → Next → advance) and the
 * record path (tap record button → onRecorded fires → submitIntakeRecording → transcript seeds
 * the editable textarea). Mocks the two server actions and the mic hook so no real MediaRecorder
 * or network call is needed.
 */
import { afterEach, describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AboutYouFlow } from "@/app/hub/about-you/AboutYouFlow";

vi.mock("@/app/hub/about-you/actions", () => ({
  submitIntakeRecording: vi.fn(async () => ({ transcript: "I grew up in Metairie." })),
  saveIntakeAnswer: vi.fn(async () => ({
    nextQuestion: { key: "occupationSummary", text: "Tell me about your work." },
  })),
}));
// Module-level push spy so tests can assert router.push calls (e.g. exit-during-transcription).
// clearAllMocks() in beforeEach resets the call log between tests.
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Mock the mic hook: start() synchronously delivers a stub blob to onRecorded, so the record path
// runs without a real MediaRecorder. The component's record button calls the returned start().
vi.mock("@/lib/use-mic-recorder", () => ({
  useMicRecorder: (opts: { onRecorded: (b: Blob, t: string) => void | Promise<void> }) => ({
    phase: "idle" as const,
    start: () => opts.onRecorded(new Blob(["x"], { type: "audio/webm" }), "audio/webm"),
    finish: () => {},
  }),
}));

import { submitIntakeRecording, saveIntakeAnswer } from "@/app/hub/about-you/actions";

describe("AboutYouFlow", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("typed path: typing then Next saves the text and advances", async () => {
    render(
      <AboutYouFlow
        initialQuestion={{ key: "hometown", text: "Where did you grow up?" }}
        hubHref="/hub"
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New Orleans" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() =>
      expect(saveIntakeAnswer).toHaveBeenCalledWith([], "hometown", "New Orleans"),
    );
    await screen.findByText(/tell me about your work/i);
  });

  it("record path: a finished recording transcribes and fills the editable box", async () => {
    render(
      <AboutYouFlow
        initialQuestion={{ key: "hometown", text: "Where did you grow up?" }}
        hubHref="/hub"
      />,
    );
    // hub.aboutYou.voiceLabel = "Tap to answer" — that is the button's aria-label in idle state.
    fireEvent.click(screen.getByRole("button", { name: /tap to answer/i }));
    await waitFor(() =>
      expect(submitIntakeRecording).toHaveBeenCalledWith("hometown", expect.any(FormData)),
    );
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("Metairie"),
    );
  });

  it("I2 regression: Next is disabled while transcription is in flight", async () => {
    // submitIntakeRecording returns a pending promise so we can assert the disabled state
    // while the async onRecorded handler is suspended mid-flight (transcribing = true).
    let resolveTranscribe!: (val: { transcript: string }) => void;
    (submitIntakeRecording as Mock).mockReturnValueOnce(
      new Promise<{ transcript: string }>((res) => {
        resolveTranscribe = res;
      }),
    );

    render(
      <AboutYouFlow
        initialQuestion={{ key: "hometown", text: "Where did you grow up?" }}
        hubHref="/hub"
      />,
    );

    // Tap record — the mock start() calls onRecorded synchronously. onRecorded sets
    // transcribing=true (before the first await) then suspends at submitIntakeRecording.
    fireEvent.click(screen.getByRole("button", { name: /tap to answer/i }));

    // While the transcription is pending, the Next button must be disabled.
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /next/i }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    // Resolve transcription → transcribing flips back to false → button re-enabled.
    resolveTranscribe({ transcript: "New Orleans" });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /next/i }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("m2: empty transcript leaves the textbox empty and shows no error", async () => {
    (submitIntakeRecording as Mock).mockResolvedValueOnce({ transcript: "" });

    render(
      <AboutYouFlow
        initialQuestion={{ key: "hometown", text: "Where did you grow up?" }}
        hubHref="/hub"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /tap to answer/i }));
    await waitFor(() => expect(submitIntakeRecording).toHaveBeenCalledOnce());

    // With transcript = "" the `if (transcript) setDraft(...)` guard skips the setter.
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""),
    );
    // No error message surfaced — graceful degradation, not a failure.
    expect(screen.queryByText(/couldn't save/i)).toBeNull();
    expect(screen.queryByText(/microphone/i)).toBeNull();
  });

  it("exit-during-transcription: navigates to hub without saving when transcription is in flight", async () => {
    // Hold submitIntakeRecording at a pending promise so transcribing stays true.
    let resolveTranscribe!: (val: { transcript: string }) => void;
    (submitIntakeRecording as Mock).mockReturnValueOnce(
      new Promise<{ transcript: string }>((res) => {
        resolveTranscribe = res;
      }),
    );

    render(
      <AboutYouFlow
        initialQuestion={{ key: "hometown", text: "Where did you grow up?" }}
        hubHref="/hub"
      />,
    );

    // Start the record path — transcribing = true, submitIntakeRecording is pending.
    fireEvent.click(screen.getByRole("button", { name: /tap to answer/i }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /next/i }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    // Click exit while transcription is still in flight.
    fireEvent.click(screen.getByRole("button", { name: /take me to the hub/i }));

    // exitToHub's transcribing guard fires: push immediately, no save attempted.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hub"));
    expect(saveIntakeAnswer).not.toHaveBeenCalled();

    // Clean up the dangling promise so Vitest doesn't warn about unhandled rejections.
    resolveTranscribe({ transcript: "" });
  });

  it("submitIntakeRecording error: shows saveError copy and does not crash", async () => {
    (submitIntakeRecording as Mock).mockRejectedValueOnce(new Error("network failure"));

    render(
      <AboutYouFlow
        initialQuestion={{ key: "hometown", text: "Where did you grow up?" }}
        hubHref="/hub"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /tap to answer/i }));

    // The catch block in onRecorded sets the saveError copy.
    await screen.findByText(/couldn't save that one/i);
    // The textbox and Next button remain usable — user can still type and continue.
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /next/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
