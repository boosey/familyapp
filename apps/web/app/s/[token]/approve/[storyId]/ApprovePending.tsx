"use client";

/**
 * Draft-tolerant "almost ready" view for the approval surface (issue #2 slice 2b + issue #11).
 *
 * The narrator can land here while the story is still `draft` — the durable Inngest pipeline hasn't
 * finished rendering prose yet (in prod, capture returns before the pipeline completes). This polls
 * the token-scoped status endpoint and:
 *   - the moment the story becomes `ready` (pending_approval), router.refresh()es the server
 *     component — which then renders the real approve UI;
 *   - on the soft cap, shows a warm "taking longer" message instead of spinning forever;
 *   - on a `failed` status (issue #11 — a pipeline stage exhausted its retries), shows a warm error
 *     with a one-tap "try again" that clears the failure and re-dispatches the pipeline.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pollUntilReady } from "@/lib/poll-status";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { capture } from "@/app/_copy";

type Phase = "polling" | "slow" | "failed" | "retrying";

export function ApprovePending({ token, storyId }: { token: string; storyId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("polling");
  // Bumping this restarts the poll effect after a successful retry (fresh AbortController + loop).
  const [pollGeneration, setPollGeneration] = useState(0);

  useEffect(() => {
    // Only run the poll loop while we're actively waiting (not while showing the failed screen).
    if (phase !== "polling") return;
    const controller = new AbortController();
    void pollUntilReady({
      getStatus: async () => {
        const r = await fetch(
          `/api/capture/status?token=${encodeURIComponent(token)}&storyId=${encodeURIComponent(storyId)}`,
          { signal: controller.signal },
        );
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = (await r.json()) as { status?: "processing" | "ready" | "failed" };
        if (j.status !== "processing" && j.status !== "ready" && j.status !== "failed") {
          throw new Error("malformed status");
        }
        return j.status;
      },
      signal: controller.signal,
    }).then((outcome) => {
      if (outcome === "ready") {
        router.refresh(); // re-render the server page → now pending_approval → real approve UI
      } else if (outcome === "failed") {
        setPhase("failed");
      } else if (outcome === "timeout") {
        setPhase("slow");
      }
      // "aborted" → do nothing (unmount or a retry restarted the loop).
    });
    return () => controller.abort();
    // pollGeneration is a dep so a retry restarts a fresh loop.
  }, [token, storyId, router, phase, pollGeneration]);

  const onRetry = useCallback(async () => {
    setPhase("retrying");
    try {
      const r = await fetch(
        `/api/capture/retry?token=${encodeURIComponent(token)}&storyId=${encodeURIComponent(storyId)}`,
        { method: "POST" },
      );
      if (r.ok) {
        // Re-dispatched — go back to polling (fresh loop) to watch for ready/failed again.
        setPollGeneration((g) => g + 1);
        setPhase("polling");
        return;
      }
      // 409 = the story already recovered/advanced; let the server page re-resolve to the right view.
      if (r.status === 409) {
        router.refresh();
        return;
      }
      // Any other error: fall back to the failed screen so the narrator can try once more.
      setPhase("failed");
    } catch {
      setPhase("failed");
    }
  }, [token, storyId, router]);

  const isFailed = phase === "failed" || phase === "retrying";

  return (
    <main
      className="kin-fullbleed"
      style={{ alignItems: "center", justifyContent: "center", padding: 32 }}
    >
      {phase === "polling" && (
        <div className="kindred-spinner" aria-hidden="true" style={{ marginBottom: 20 }} />
      )}
      <h1
        style={{
          fontFamily: "var(--font-story)",
          fontWeight: 400,
          fontSize: "var(--text-display)",
          margin: 0,
          color: "var(--text-body)",
        }}
      >
        {isFailed ? capture.approve.failedTitle : capture.approve.preparingTitle}
      </h1>
      <p
        role="status"
        aria-live="polite"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-muted)",
          maxWidth: "32ch",
          textAlign: "center",
          marginTop: 16,
        }}
      >
        {isFailed
          ? capture.approve.failedBody
          : phase === "slow"
            ? capture.approve.takingLonger
            : capture.approve.preparingBody}
      </p>
      {isFailed && (
        <div style={{ marginTop: 24 }}>
          <ActionButton
            label={phase === "retrying" ? capture.approve.retrying : capture.approve.tryAgain}
            variant="primary"
            onClick={onRetry}
            disabled={phase === "retrying"}
          />
        </div>
      )}
    </main>
  );
}
