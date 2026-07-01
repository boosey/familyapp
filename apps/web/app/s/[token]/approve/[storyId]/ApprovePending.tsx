"use client";

/**
 * Draft-tolerant "almost ready" view for the approval surface (issue #2, slice 2b).
 *
 * The narrator can land here while the story is still `draft` — the durable Inngest pipeline hasn't
 * finished rendering prose yet (in prod, capture returns before the pipeline completes). Rather than
 * the hard "already settled" fallback (which would read as "your story is gone"), this polls the
 * token-scoped status endpoint and, the moment the story becomes `ready` (pending_approval),
 * router.refresh()es the server component — which then renders the real approve UI. On the soft cap
 * it shows a warm "taking longer" message instead of spinning forever.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pollUntilReady } from "@/lib/poll-status";
import { capture } from "@/app/_copy";

export function ApprovePending({ token, storyId }: { token: string; storyId: string }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void pollUntilReady({
      getStatus: async () => {
        const r = await fetch(
          `/api/capture/status?token=${encodeURIComponent(token)}&storyId=${encodeURIComponent(storyId)}`,
          { signal: controller.signal },
        );
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = (await r.json()) as { status?: "processing" | "ready" };
        if (j.status !== "processing" && j.status !== "ready") throw new Error("malformed status");
        return j.status;
      },
      signal: controller.signal,
    }).then((outcome) => {
      if (outcome === "ready") {
        router.refresh(); // re-render the server page → now pending_approval → real approve UI
      } else if (outcome === "timeout") {
        setSlow(true);
      }
    });
    return () => controller.abort();
  }, [token, storyId, router]);

  return (
    <main
      className="kin-fullbleed"
      style={{ alignItems: "center", justifyContent: "center", padding: 32 }}
    >
      {!slow && <div className="kindred-spinner" aria-hidden="true" style={{ marginBottom: 20 }} />}
      <h1
        style={{
          fontFamily: "var(--font-story)",
          fontWeight: 400,
          fontSize: "var(--text-display)",
          margin: 0,
          color: "var(--text-body)",
        }}
      >
        {capture.approve.preparingTitle}
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
        {slow ? capture.approve.takingLonger : capture.approve.preparingBody}
      </p>
    </main>
  );
}
