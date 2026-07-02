// @vitest-environment jsdom
/**
 * Regression test for useMicRecorder phase lifecycle. Specifically guards the C1 bug where
 * finish() set phase "saving" but mr.onstop never reset it to "idle", permanently disabling
 * the button in any component that reuses the hook across multiple questions (AboutYouFlow).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useMicRecorder } from "@/lib/use-mic-recorder";

/* ── Minimal harness ────────────────────────────────────────────────────── */

function MicHarness({
  onRecorded,
  onError,
}: {
  onRecorded: (b: Blob, t: string) => void;
  onError?: () => void;
}) {
  const { phase, start, finish } = useMicRecorder({ onRecorded, onError });
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <button data-testid="start" onClick={start}>
        start
      </button>
      <button data-testid="finish" onClick={finish}>
        finish
      </button>
    </div>
  );
}

/* ── Fake MediaRecorder (mirrors narrator-recorder.test.tsx pattern) ────── */

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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe("useMicRecorder phase lifecycle", () => {
  it("resets phase to idle after onstop fires — C1 regression", async () => {
    const onRecorded = vi.fn();
    render(<MicHarness onRecorded={onRecorded} />);

    expect(screen.getByTestId("phase").textContent).toBe("idle");

    // start() is async (awaits getUserMedia), so wait for the phase transition.
    fireEvent.click(screen.getByTestId("start"));
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("listening"));

    // finish() → mr.stop() → onstop fires synchronously → onRecorded dispatched → setPhase("idle").
    // React 18 batches the setPhase("saving") + setPhase("idle") calls from the same synchronous
    // execution, so "saving" may never be observable — what matters is we end up at "idle".
    fireEvent.click(screen.getByTestId("finish"));
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("idle"));

    expect(onRecorded).toHaveBeenCalledWith(expect.any(Blob), "audio/webm");
  });

  it("calls onError and stays idle when getUserMedia is denied", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new Error("Permission denied");
        },
      },
    });
    const onError = vi.fn();
    render(<MicHarness onRecorded={vi.fn()} onError={onError} />);

    fireEvent.click(screen.getByTestId("start"));
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(screen.getByTestId("phase").textContent).toBe("idle");
  });
});
