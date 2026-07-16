// @vitest-environment jsdom
/**
 * ApprovePending failed→retry flow (issue #11). When the status poll reports `failed` (a pipeline
 * stage exhausted its retries), the view swaps the spinner for a warm error + a "try again" button.
 * Clicking it POSTs /api/capture/retry; on success it returns to polling (and this time sees ready →
 * router.refresh reveals the approve UI). Mocks fetch + the router.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApprovePending } from "@/app/s/[token]/approve/[storyId]/ApprovePending";
import { capture } from "@/app/_copy";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh }),
}));

const TOKEN = "narrator-token-abc";
const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";

// Status responses returned in order (last repeats). Retry POST responses are separate.
let statusQueue: Array<"processing" | "ready" | "failed">;
let retryResponse: { status: number; body: unknown };
let retryCalls: string[];

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/capture/retry")) {
        retryCalls.push(url);
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify(retryResponse.body), {
          status: retryResponse.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      // /api/capture/status
      const next = statusQueue.length > 1 ? statusQueue.shift()! : statusQueue[0]!;
      return new Response(JSON.stringify({ ok: true, status: next, storyId: STORY_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

beforeEach(() => {
  refresh.mockClear();
  statusQueue = ["failed"];
  retryResponse = { status: 200, body: { ok: true, storyId: STORY_ID, attempt: 1 } };
  retryCalls = [];
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ApprovePending — failed → retry (issue #11)", () => {
  it("shows the failure message + a try-again button when the poll reports failed", async () => {
    render(<ApprovePending token={TOKEN} storyId={STORY_ID} />);
    await waitFor(() => {
      expect(screen.getByText(capture.approve.failedTitle)).toBeTruthy();
    });
    expect(screen.getByText(capture.approve.failedBody)).toBeTruthy();
    expect(screen.getByRole("button", { name: capture.approve.tryAgain })).toBeTruthy();
  });

  it("clicking try-again POSTs the retry route, then returns to polling and reveals the approve UI on ready", async () => {
    render(<ApprovePending token={TOKEN} storyId={STORY_ID} />);
    const btn = await screen.findByRole("button", { name: capture.approve.tryAgain });

    // Next poll after a successful retry should see `ready`.
    statusQueue = ["ready"];
    fireEvent.click(btn);

    await waitFor(() => {
      expect(retryCalls.length).toBe(1);
    });
    expect(retryCalls[0]).toContain(`token=${TOKEN}`);
    expect(retryCalls[0]).toContain(`storyId=${STORY_ID}`);

    // Back to polling → sees ready → router.refresh reveals the real approve UI.
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("a 409 (story already recovered) refreshes the server page instead of showing the error again", async () => {
    render(<ApprovePending token={TOKEN} storyId={STORY_ID} />);
    const btn = await screen.findByRole("button", { name: capture.approve.tryAgain });

    retryResponse = { status: 409, body: { ok: false, reason: "not_failed" } };
    fireEvent.click(btn);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });
});
