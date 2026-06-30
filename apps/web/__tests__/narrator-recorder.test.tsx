// @vitest-environment jsdom
/**
 * Integration test for the link-session recorder's async-aware capture (slice 2b): after POST
 * /api/capture returns a storyId, the recorder enters a processing phase that polls
 * /api/capture/status until `ready`, then routes to the approval surface. Covers the instant-ready
 * case (dev/CI synchronous dispatch) and the processing→ready case (prod durable queue, simulated
 * via the mocked status poll). Mocks the browser media stack, fetch, and the router.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NarratorRecorder } from "@/app/s/[token]/NarratorRecorder";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: () => {} }),
}));

const TOKEN = "narrator-token-abc";
const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";

// Queue of status responses the fake /api/capture/status returns in order (last one repeats).
let statusQueue: Array<"processing" | "ready">;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/capture/status")) {
        const next = statusQueue.length > 1 ? statusQueue.shift()! : statusQueue[0]!;
        return new Response(JSON.stringify({ ok: true, status: next, storyId: STORY_ID }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // POST /api/capture
      return new Response(JSON.stringify({ ok: true, storyId: STORY_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

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
  statusQueue = ["ready"];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function recordAndStop() {
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByText(/Listening/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button"));
}

describe("NarratorRecorder async-aware capture", () => {
  it("routes straight to the approval surface when the story is already ready (dev/CI case)", async () => {
    statusQueue = ["ready"];
    render(<NarratorRecorder token={TOKEN} />);
    await recordAndStop();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/s/${TOKEN}/approve/${STORY_ID}`),
    );
  });

  it("shows the processing screen, then routes to approve once status flips to ready", async () => {
    statusQueue = ["processing", "ready"];
    render(<NarratorRecorder token={TOKEN} />);
    await recordAndStop();

    // Processing screen up while the first poll says processing.
    await waitFor(() => expect(screen.getByText(/getting your story ready/)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();

    // After the poll interval, the second probe returns ready → route to approve.
    await waitFor(
      () => expect(push).toHaveBeenCalledWith(`/s/${TOKEN}/approve/${STORY_ID}`),
      { timeout: 8000 },
    );
  }, 12000);

  it("does NOT navigate when unmounted mid-poll, even if status later resolves ready (ghost-nav regression)", async () => {
    // /api/capture/status hangs until we release it. The component unmounts while the poll is
    // in flight; a late "ready" must not fire router.push at a user who already navigated away.
    let releaseStatus: (r: Response) => void = () => {};
    const statusPromise = new Promise<Response>((res) => {
      releaseStatus = res;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/capture/status")) return statusPromise;
        return new Response(JSON.stringify({ ok: true, storyId: STORY_ID }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    render(<NarratorRecorder token={TOKEN} />);
    await recordAndStop();
    // Reached the processing phase (POST resolved, poll in flight on the hanging status fetch).
    await waitFor(() => expect(screen.getByText(/getting your story ready/)).toBeTruthy());

    // Unmount → the cleanup aborts the live controller (assigned as upload()'s first statement).
    cleanup();

    // Now the status request finally resolves "ready" — the post-poll abort guard must swallow it.
    releaseStatus(
      new Response(JSON.stringify({ ok: true, status: "ready", storyId: STORY_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await new Promise((r) => setTimeout(r, 50)); // let the post-poll code run

    expect(push).not.toHaveBeenCalled();
  });

  it("soft-fails (no route) when the capture POST is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 500 })),
    );
    render(<NarratorRecorder token={TOKEN} />);
    await recordAndStop();
    await waitFor(() => expect(screen.getByText(/pick this up another time/)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
  });
});
