"use client";

/**
 * Single primary control for the narrator. Idle -> pulsing voice button. Listening -> calm stop with
 * a transcript-style placeholder. Saving/done/softfail mirror the original flow but in Kindred
 * chrome. Long silences NEVER end the session (silence is thinking).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KindredVoiceButton } from "@/app/_kindred";
import { capture, common } from "@/app/_copy";
import { pollUntilReady } from "@/lib/poll-status";
import { useMicRecorder } from "@/lib/use-mic-recorder";

// `processing` = capture saved, pipeline rendering out-of-band; `slow` = soft cap reached.
type Phase = "processing" | "slow" | "done" | "softfail";

export function NarratorRecorder({ token, askId = null }: { token: string; askId?: string | null }) {
  const router = useRouter();
  // null while recording is active (mic phase drives UI); set once recording completes.
  const [phase, setPhase] = useState<Phase | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight processing poll on unmount.
  useEffect(() => () => pollAbortRef.current?.abort(), []);

  const upload = useCallback(async (blob: Blob) => {
    // Commit to the processing screen before the first await so there is no idle-flash window
    // between onstop (which resets micPhase → idle) and the POST resolving. The processing
    // screen is the correct optimistic state: the audio is captured, the pipeline is next.
    setPhase("processing");
    // Create + register the abort controller as the next statement, still before any await: if
    // the component unmounts DURING the capture POST the unmount cleanup must see a live
    // controller to abort. Otherwise the upload would resume as a zombie and could router.push()
    // a user who already navigated away (ghost nav).
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      const form = new FormData();
      form.append("token", token);
      form.append("audio", blob, "recording.webm");
      if (askId) form.append("askId", askId);
      const res = await fetch("/api/capture", { method: "POST", body: form });
      if (controller.signal.aborted) return; // unmounted during the POST
      if (!res.ok) {
        setPhase("softfail");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { storyId?: string };
      const storyId = body.storyId;
      if (controller.signal.aborted) return;
      if (!storyId) {
        // Capture succeeded but we got no id to poll — fall back to the warm done state rather
        // than hanging. (In dev/CI the story is already pending_approval anyway.)
        setPhase("done");
        return;
      }

      // The story may still be rendering out-of-band (prod durable queue) or already ready
      // (dev/CI synchronous dispatch). Poll the token-scoped status until ready, then route to
      // the approval surface. On the soft cap, show a warm "taking longer" message (never hang).
      const outcome = await pollUntilReady({
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
      });
      // Guard every post-poll action on the live signal: an unmount that raced the final probe
      // must neither navigate nor set state on a dead component.
      if (controller.signal.aborted) return;
      if (outcome === "ready" || outcome === "failed") {
        // `failed` (issue #11) also routes to the approve surface — its ApprovePending view detects
        // the failure and offers the retry affordance, so the recovery path lives in one place.
        router.push(`/s/${token}/approve/${storyId}`);
      } else if (outcome === "timeout") {
        setPhase("slow");
      }
      // "aborted" → unmounted; do nothing.
    } catch {
      if (controller.signal.aborted) return; // an abort-induced throw is not a soft failure
      setPhase("softfail");
    }
  }, [token, askId, router]);

  const { phase: micPhase, start, finish } = useMicRecorder({
    onRecorded: (blob) => void upload(blob),
    onError: () => setPhase("softfail"),
  });

  if (phase === "processing") {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          textAlign: "center",
        }}
      >
        <div className="kindred-spinner" aria-hidden="true" />
        <p
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story-lg)",
            color: "var(--text-body)",
            margin: 0,
          }}
        >
          {capture.narrator.preparing}
        </p>
        <p
          className="kin-muted"
          style={{ fontSize: "var(--text-ui-sm)", margin: 0 }}
        >
          {capture.narrator.preparingSub}
        </p>
      </div>
    );
  }

  if (phase === "slow") {
    return (
      <p
        aria-live="polite"
        className="kin-muted"
        style={{ fontSize: "var(--text-ui-sm)", margin: 0, textAlign: "center", maxWidth: 360 }}
      >
        {capture.narrator.takingLonger}
      </p>
    );
  }

  if (phase === "done") {
    return (
      <p
        aria-live="polite"
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          color: "var(--text-body)",
          margin: 0,
          textAlign: "center",
        }}
      >
        {capture.narrator.thanks}
      </p>
    );
  }

  if (phase === "softfail") {
    return (
      <p
        aria-live="polite"
        className="kin-muted"
        style={{ fontSize: "var(--text-ui-sm)", margin: 0, textAlign: "center", maxWidth: 360 }}
      >
        {capture.narrator.pickUpLater}
      </p>
    );
  }

  const onClick = micPhase === "listening" ? finish : micPhase === "idle" ? start : undefined;

  return (
    <KindredVoiceButton
      listening={micPhase === "listening"}
      saving={micPhase === "saving"}
      size={220}
      label={micPhase === "listening" ? common.voiceButton.listening : micPhase === "saving" ? common.voiceButton.oneMoment : common.voiceButton.tapToSpeak}
      onClick={onClick}
    />
  );
}
