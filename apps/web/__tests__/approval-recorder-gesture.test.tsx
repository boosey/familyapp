// @vitest-environment jsdom
/**
 * ApprovalRecorder recording-gesture preference (#264) — same phone/desktop resolver as hub
 * compose / onboarding / NarratorRecorder. Default tap; hold when the stored pref says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApprovalRecorder } from "@/app/s/[token]/approve/[storyId]/ApprovalRecorder";
import { PREFERENCES } from "@/app/_kindred/preferences/registry";
import { capture, common } from "@/app/_copy";

const TOKEN = "approve-token-abc";
const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";

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
    // Mirror real MediaRecorder: second stop while inactive throws (catches non-idempotent finish).
    if (this.state === "inactive") {
      throw new DOMException("InvalidStateError");
    }
    this.state = "inactive";
    this.onstop?.();
  }
}

function stubDesktopMatchMedia() {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: "",
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  stubDesktopMatchMedia();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ApprovalRecorder recording gesture", () => {
  it("defaults to tap — click starts, click stops, then uploads", async () => {
    render(<ApprovalRecorder token={TOKEN} storyId={STORY_ID} prose="Once upon a time." />);
    await waitFor(() => expect(screen.getByText(capture.approve.approveAloud)).toBeTruthy());

    const mic = screen.getByRole("button", { name: capture.approve.approveAloud });
    fireEvent.click(mic);
    await waitFor(() => expect(screen.getByText(capture.approve.listening)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: capture.approve.listening }));

    await waitFor(() => expect(screen.getByText(capture.approve.confirmedThanks)).toBeTruthy());
    expect(fetch).toHaveBeenCalled();
  });

  it("honors hold preference — pointer down/up records and uploads", async () => {
    localStorage.setItem(PREFERENCES.recordingGestureDesktop.storageKey, "hold");
    render(<ApprovalRecorder token={TOKEN} storyId={STORY_ID} prose="Once upon a time." />);
    await waitFor(() => expect(screen.getByText(common.voiceButton.holdToSpeak)).toBeTruthy());

    const mic = screen.getByRole("button", { name: common.voiceButton.holdToSpeak });
    fireEvent.pointerDown(mic);
    await waitFor(() => expect(screen.getByText(common.voiceButton.releaseToFinish)).toBeTruthy());
    const live = screen.getByRole("button", { name: common.voiceButton.releaseToFinish });
    // KindredVoiceButton fires both pointerup and pointerleave on release — finish must tolerate both.
    fireEvent.pointerUp(live);
    fireEvent.pointerLeave(live);

    await waitFor(() => expect(screen.getByText(capture.approve.confirmedThanks)).toBeTruthy());
  });
});
