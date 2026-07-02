// @vitest-environment jsdom
/**
 * Integration test for AboutYouFlow: verifies the typed path (type → Next → advance) and the
 * record path (tap record button → onRecorded fires → submitIntakeRecording → transcript seeds
 * the editable textarea). Mocks the two server actions and the mic hook so no real MediaRecorder
 * or network call is needed.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AboutYouFlow } from "@/app/hub/about-you/AboutYouFlow";

vi.mock("@/app/hub/about-you/actions", () => ({
  submitIntakeRecording: vi.fn(async () => ({ transcript: "I grew up in Metairie." })),
  saveIntakeAnswer: vi.fn(async () => ({
    nextQuestion: { key: "occupationSummary", text: "Tell me about your work." },
  })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
});
