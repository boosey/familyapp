// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMicRecorder } from "./use-mic-recorder";

/**
 * The hold-to-record wiring the capture surfaces derive from this hook: press-down starts, release
 * stops, and — the regression under test — a release that lands BEFORE the async getUserMedia
 * resolves still stops the recording (via the heldRef honour-late-release path) rather than dropping
 * the stop and leaving a recording that never ends. Mirrors ComposingEditor / NarratorRecorder.
 */
function useHoldToRecord(hook: ReturnType<typeof useMicRecorder>) {
  const heldRef = useRef(false);
  const { phase, start, finish } = hook;
  const onHoldStart = useCallback(async () => {
    if (phase !== "idle") return;
    heldRef.current = true;
    await start();
    if (!heldRef.current) finish();
  }, [phase, start, finish]);
  const onHoldEnd = useCallback(() => {
    heldRef.current = false;
    if (phase === "listening") finish();
  }, [phase, finish]);
  return { onHoldStart, onHoldEnd };
}

/** A stand-in MediaStream whose tracks record stop() calls. */
function fakeStream() {
  const track = { stop: vi.fn() };
  return {
    getTracks: () => [track],
    _track: track,
  } as unknown as MediaStream & { _track: { stop: ReturnType<typeof vi.fn> } };
}

/** The most recently constructed fake recorder, so a test can spy on its stop() / read its state. */
let lastRecorder: {
  state: "inactive" | "recording";
  stop: ReturnType<typeof vi.fn>;
} | null = null;

describe("useMicRecorder", () => {
  beforeEach(() => {
    lastRecorder = null;
    // MediaRecorder stand-in tracking `state` like the real API (inactive → recording → inactive),
    // so the hook's stop-idempotency guard (bail when state === "inactive") is exercised faithfully.
    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      mimeType = "audio/webm";
      state: "inactive" | "recording" = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      stop = vi.fn(() => {
        this.state = "inactive";
        this.onstop?.();
      });
      constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
        if (opts?.mimeType) this.mimeType = opts.mimeType;
        lastRecorder = this;
      }
      start() {
        this.state = "recording";
      }
    }
    // @ts-expect-error test double
    globalThis.MediaRecorder = FakeMediaRecorder;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error cleanup
    delete globalThis.MediaRecorder;
  });

  it("returns a shape that includes phase, start, finish, and stream", () => {
    const { result } = renderHook(() => useMicRecorder({ onRecorded: vi.fn() }));
    expect(result.current).toHaveProperty("phase");
    expect(result.current).toHaveProperty("start");
    expect(result.current).toHaveProperty("finish");
    expect(result.current).toHaveProperty("stream");
    expect(result.current.stream).toBeNull(); // idle → no live stream yet
    expect(typeof result.current.start).toBe("function");
    expect(typeof result.current.finish).toBe("function");
  });

  it("surfaces the live MediaStream on start and clears it on finish", async () => {
    const stream = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const { result } = renderHook(() => useMicRecorder({ onRecorded: vi.fn() }));

    await act(async () => {
      await result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.stream).toBe(stream);
    expect(result.current.phase).toBe("listening");

    act(() => {
      result.current.finish();
    });
    expect(result.current.stream).toBeNull();
    // Tracks are stopped so the mic indicator turns off.
    expect(stream._track.stop).toHaveBeenCalled();
  });

  it("leaves stream null when getUserMedia rejects", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useMicRecorder({ onRecorded: vi.fn(), onError }));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.stream).toBeNull();
    expect(result.current.phase).toBe("idle");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // Regression: a fast tap in hold mode (down + up before getUserMedia resolves) must still stop the
  // recording. Previously onHoldEnd gated on the async-lagging phase (still "idle" at release), so
  // finish() was dropped and the recording ran forever. The heldRef honour-late-release path fixes it.
  it("stops the recording even when released before the mic is ready (fast tap)", async () => {
    const stream = fakeStream();
    let resolveGum: (s: MediaStream) => void = () => {};
    const gumPromise = new Promise<MediaStream>((res) => {
      resolveGum = res;
    });
    const getUserMedia = vi.fn().mockReturnValue(gumPromise);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const { result } = renderHook(() => {
      const hook = useMicRecorder({ onRecorded: vi.fn() });
      return { hook, hold: useHoldToRecord(hook) };
    });

    // Press-and-release before the stream resolves. onHoldStart's await is still pending; onHoldEnd
    // sees phase "idle" and only flips heldRef=false — the stop is deferred to the resolve path.
    let startPromise: Promise<void>;
    act(() => {
      startPromise = result.current.hold.onHoldStart();
    });
    act(() => {
      result.current.hold.onHoldEnd();
    });

    // Now the mic becomes ready; onHoldStart's continuation must call finish() because heldRef is false.
    await act(async () => {
      resolveGum(stream);
      await startPromise;
    });

    // The recording was stopped: its tracks were stopped and the live stream cleared.
    expect(stream._track.stop).toHaveBeenCalled();
    expect(result.current.hook.stream).toBeNull();
  });

  // Regression: on touch, pointerup + pointerleave both fire onHoldEnd in the same tick, so finish()
  // can be called twice before React re-renders. The second call must be a no-op (recorder already
  // inactive) — not a recorder.stop()-on-inactive InvalidStateError.
  it("finish() is idempotent — a second call is a no-op, not a throw", async () => {
    const stream = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const { result } = renderHook(() => useMicRecorder({ onRecorded: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.phase).toBe("listening");
    expect(lastRecorder).not.toBeNull();

    act(() => {
      result.current.finish();
      // Second call in the SAME tick (pointerup then pointerleave) — must not throw.
      expect(() => result.current.finish()).not.toThrow();
    });

    // recorder.stop() ran exactly once despite two finish() calls.
    expect(lastRecorder!.stop).toHaveBeenCalledTimes(1);
    expect(result.current.stream).toBeNull();
  });
});
