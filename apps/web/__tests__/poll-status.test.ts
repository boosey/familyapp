/**
 * Unit tests for the pure poll-until-ready loop (slice 2b). Fake timers + an injected clock keep
 * these deterministic and instant.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollUntilReady } from "../lib/poll-status";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pollUntilReady", () => {
  it("resolves 'ready' on the first probe (dev/CI synchronous-dispatch case) without sleeping", async () => {
    const getStatus = vi.fn(async () => "ready" as const);
    const outcome = await pollUntilReady({ getStatus, intervalMs: 2500, timeoutMs: 180_000 });
    expect(outcome).toBe("ready");
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps polling through 'processing' and resolves 'ready' once the story renders", async () => {
    vi.useFakeTimers();
    const getStatus = vi
      .fn<() => Promise<"processing" | "ready">>()
      .mockResolvedValueOnce("processing")
      .mockResolvedValueOnce("processing")
      .mockResolvedValueOnce("ready");

    const p = pollUntilReady({ getStatus, intervalMs: 2500, timeoutMs: 180_000 });
    // Advance past two intervals to let the 2nd and 3rd probes fire.
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toBe("ready");
    expect(getStatus).toHaveBeenCalledTimes(3);
  });

  it("resolves 'timeout' when the cap elapses without ever seeing ready (never spins forever)", async () => {
    vi.useFakeTimers();
    const getStatus = vi.fn(async () => "processing" as const);
    // Cap = 5s, interval = 2.5s → probes at 0 and 2.5s, then the next sleep would exceed the cap.
    const p = pollUntilReady({ getStatus, intervalMs: 2500, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toBe("timeout");
  });

  it("treats a probe rejection as a transient miss and keeps polling", async () => {
    vi.useFakeTimers();
    const getStatus = vi
      .fn<() => Promise<"processing" | "ready">>()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce("ready");
    const p = pollUntilReady({ getStatus, intervalMs: 2500, timeoutMs: 180_000 });
    await vi.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toBe("ready");
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("resolves 'aborted' when the signal fires", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const getStatus = vi.fn(async () => "processing" as const);
    const p = pollUntilReady({
      getStatus,
      intervalMs: 2500,
      timeoutMs: 180_000,
      signal: controller.signal,
    });
    // First probe fires, then we abort during the interval sleep.
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toBe("aborted");
  });
});
