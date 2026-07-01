// @vitest-environment jsdom
/**
 * Integration test: stopping a recording immediately shows the review-pending screen (audio +
 * "Polishing your words…" spinner, editor hidden) while recordAnswerAction is still in flight.
 * Mocks the browser media stack (getUserMedia, MediaRecorder, object URLs) and the server action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnswerFlow } from "@/app/hub/answer/[askId]/AnswerFlow";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => {} }),
}));

const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";

// A controllable record action: resolves only when we call `resolveRecord`, so the test can
// assert the pending screen WHILE the action is still awaiting.
let resolveRecord: (v: { storyId: string } | { error: string }) => void;
const recordAnswerAction = vi.fn(
  (..._args: unknown[]) =>
    new Promise<{ storyId: string } | { error: string }>((res) => (resolveRecord = res)),
);
// Status poll: defaults to "ready" on the first probe (the dev/CI synchronous-dispatch case).
// Individual tests can override the queued return values.
const getAnswerStatusAction = vi.fn(
  async (
    ..._args: unknown[]
  ): Promise<{ status: "processing" | "ready"; storyId: string }> => ({
    status: "ready",
    storyId: STORY_ID,
  }),
);
vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  recordAnswerAction: (...args: unknown[]) => recordAnswerAction(...args),
  getAnswerStatusAction: (...args: unknown[]) => getAnswerStatusAction(...args),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
}));

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  state = "inactive";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public stream: any) {}
  start() {
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: "audio/webm" }) });
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  URL.createObjectURL = vi.fn(() => "blob:local-take");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnswerFlow optimistic transition", () => {
  it("shows the review-pending screen the moment recording stops", async () => {
    render(
      <AnswerFlow
        askId="11834dd1-04f4-44a4-b611-24fdd9c3d8fd"
        questionText="What have you learned about being a grandparent?"
        askerName="Sam"
        draft={null}
      />,
    );

    // Start: click the voice button (idle → listening, async getUserMedia).
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());

    // Stop: click again → MediaRecorder.stop() → onstop → uploadRecording → localTake set.
    fireEvent.click(screen.getByRole("button"));

    // Review-pending appears while recordAnswerAction is still pending.
    await waitFor(() => expect(screen.getByText(/Polishing your words/)).toBeTruthy());
    expect(recordAnswerAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).toBeNull(); // editor hidden
    const audio = document.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("blob:local-take");

    // On success the action returns a storyId; the status poll returns `ready` (dev/CI synchronous
    // dispatch) and the client refreshes (the keyed remount to review-ready is covered elsewhere).
    resolveRecord({ storyId: STORY_ID });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(getAnswerStatusAction).toHaveBeenCalledWith(STORY_ID);
  });

  it("keeps the processing screen until the status poll reports ready, then transitions", async () => {
    // Story is still rendering: first probe returns processing, the next returns ready (the prod
    // durable-queue path — exercised without Inngest via the mocked status poll).
    getAnswerStatusAction
      .mockResolvedValueOnce({ status: "processing", storyId: STORY_ID })
      .mockResolvedValueOnce({ status: "ready", storyId: STORY_ID });

    render(
      <AnswerFlow
        askId="11834dd1-04f4-44a4-b611-24fdd9c3d8fd"
        questionText="What have you learned about being a grandparent?"
        askerName="Sam"
        draft={null}
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Polishing your words/)).toBeTruthy());

    resolveRecord({ storyId: STORY_ID });

    // While processing, the polishing screen stays up and no refresh fires yet.
    await waitFor(() => expect(getAnswerStatusAction).toHaveBeenCalled());
    expect(screen.getByText(/Polishing your words/)).toBeTruthy();

    // The second probe (after the ~2.5s poll interval) returns ready → refresh into review.
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce(), { timeout: 8000 });
  }, 12000);

  it("surfaces a render failure on the pending screen and returns to record on retry", async () => {
    render(
      <AnswerFlow
        askId="11834dd1-04f4-44a4-b611-24fdd9c3d8fd"
        questionText="What have you learned about being a grandparent?"
        askerName="Sam"
        draft={null}
      />,
    );

    // Record then stop → review-pending while the action is in flight.
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/Polishing your words/)).toBeTruthy());

    // Render fails: the error lands on the pending screen (no refresh, no remount).
    resolveRecord({ error: "Could not save your recording. Please try again." });
    await waitFor(() =>
      expect(screen.getByText(/Could not save your recording/)).toBeTruthy(),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(/Polishing your words/)).toBeNull(); // spinner gone

    // "Record again" clears the take (revoking its URL) and returns to the record screen.
    fireEvent.click(screen.getByRole("button", { name: /Record again/ }));
    expect(screen.getByRole("button", { name: /Tap to speak/ })).toBeTruthy();
    expect(screen.queryByText(/Could not save your recording/)).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-take");
  });
});
