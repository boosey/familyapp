// @vitest-environment jsdom
/**
 * Integration test: stopping a recording immediately shows the review-pending screen (audio +
 * "Polishing your words…" spinner, editor hidden) while the capture action is still in flight.
 * Mocks the browser media stack (getUserMedia, MediaRecorder, object URLs) and the server action.
 *
 * ADR-0014 Inc 3 (Slice 5): the flag-off voice capture now resolves to the per-take `appended` step
 * (the take was transcribed/cleaned and concatenated onto the draft's working prose synchronously).
 * An `appended` story stays `draft`, so the composing surface must NOT poll — a poll would map to
 * `processing` forever and falsely surface "taking longer". It refreshes once. (The poll path was
 * removed in ADR-0014 Inc 3 slice 11.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryComposer } from "@/app/hub/StoryComposer";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => {} }),
}));

const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";
const ASK = {
  id: "11834dd1-04f4-44a4-b611-24fdd9c3d8fd",
  questionText: "What have you learned about being a grandparent?",
  askerName: "Sam",
};

type AppendedStep = {
  kind: "appended";
  storyId: string;
  prose: string;
  appendedSegment: string;
};

// A controllable compose action (the initial-capture front door): resolves only when we call
// `resolveRecord`, so the test can assert the pending screen WHILE the action is still awaiting.
let resolveRecord: (v: AppendedStep | { error: string }) => void;
const composeStoryAction = vi.fn(
  (..._args: unknown[]) =>
    new Promise<AppendedStep | { error: string }>((res) => (resolveRecord = res)),
);
vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  composeStoryAction: (...args: unknown[]) => composeStoryAction(...args),
  shareAnswerAction: vi.fn(),
  discardAnswerAction: vi.fn(),
}));

// ComposingEditor loads tag typeahead via loadTagSuggestionsAction (a "use server" module that boots
// getRuntime()/db) in an effect the moment a story id exists — which happens once composeStoryAction
// resolves here. Mock it so the test doesn't boot the real dev runtime (an unmocked getRuntime() boot
// is a slow, variable floating promise that can stall the test to the vitest 5s timeout).
vi.mock("@/app/hub/tag-suggestions-actions", () => ({
  loadTagSuggestionsAction: vi.fn(async () => ({ people: [], families: [], tags: [] })),
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

// T7 hold-to-record mounts the live-waveform meter (useAudioLevel), which opens a Web Audio
// AudioContext off the mic stream. jsdom has no Web Audio API, so stub a no-op AudioContext (mirrors
// the MediaRecorder/getUserMedia stubs) — the meter is decorative and not under test here.
class FakeAudioContext {
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 128,
      getByteTimeDomainData() {},
      connect() {},
      disconnect() {},
    };
  }
  close() {
    return Promise.resolve();
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).AudioContext = FakeAudioContext;
  URL.createObjectURL = vi.fn(() => "blob:local-take");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The capture screen now has a voice⇄text toggle, so several buttons coexist — target the voice
// control by its aria-label rather than the (now-ambiguous) bare button role. Default recording
// gesture is tap-to-toggle (#263): click starts, click again stops. Accessible name flips
// "Tap to speak" → "Listening…"; grab the element on start and click that same node to stop.
const startVoice = () => {
  const btn = screen.getByRole("button", { name: /Tap to speak/ });
  fireEvent.click(btn);
  return btn;
};
const stopVoice = (btn: HTMLElement) => fireEvent.click(btn);

describe("StoryComposer optimistic transition", () => {
  it("shows the review-pending screen the moment recording stops", async () => {
    render(<StoryComposer mode="answer" ask={ASK} draft={null} />);

    // Start: tap the voice button (idle → listening, async getUserMedia).
    const mic = startVoice();
    await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());

    // Stop: tap again → MediaRecorder.stop() → onstop → uploadRecording → localTake set.
    stopVoice(mic);

    // Review-pending appears while composeStoryAction is still pending.
    await waitFor(() => expect(screen.getByText(/Polishing your words/)).toBeTruthy());
    expect(composeStoryAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).toBeNull(); // editor hidden
    const audio = document.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("blob:local-take");

    // On success the action resolves to an `appended` step. The client seeds the prose and refreshes
    // once — it does NOT poll the status (an appended draft stays `draft`; there is nothing to await).
    resolveRecord({
      kind: "appended",
      storyId: STORY_ID,
      prose: "The polished words so far.",
      appendedSegment: "The polished words so far.",
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByText(/taking longer/i)).toBeNull();
  });

  it("never shows 'taking longer' after an appended step (deploy-safety regression guard)", async () => {
    // The bug this guards: before Slice 5, an `appended` step fell through to a `ready` poll, which
    // maps a still-`draft` story to `processing` until the soft cap → a false "taking longer" after
    // EVERY successful capture. The poll path (and getAnswerStatusAction) were removed in slice 11.
    render(<StoryComposer mode="answer" ask={ASK} draft={null} />);

    const mic = startVoice();
    await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());
    stopVoice(mic);
    await waitFor(() => expect(screen.getByText(/Polishing your words/)).toBeTruthy());

    resolveRecord({
      kind: "appended",
      storyId: STORY_ID,
      prose: "A first take.",
      appendedSegment: "A first take.",
    });

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    // Give any (buggy) poll a chance to fire before asserting the warm message never appeared.
    await Promise.resolve();
    expect(screen.queryByText(/taking longer/i)).toBeNull();
  });

  it("surfaces a render failure on the pending screen and returns to record on retry", async () => {
    render(<StoryComposer mode="answer" ask={ASK} draft={null} />);

    // Record then stop → review-pending while the action is in flight.
    const mic = startVoice();
    await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());
    stopVoice(mic);
    await waitFor(() => expect(screen.getByText(/Polishing your words/)).toBeTruthy());

    // Render fails: the error lands on the pending screen (no refresh, no remount). The `{ error }`
    // path is unchanged by the append contract.
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
