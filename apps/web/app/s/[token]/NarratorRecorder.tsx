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

// `processing` = capture saved, pipeline rendering out-of-band; `slow` = soft cap reached.
type Phase = "idle" | "listening" | "saving" | "processing" | "slow" | "done" | "softfail";

export function NarratorRecorder({ token, askId = null }: { token: string; askId?: string | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight processing poll on unmount.
  useEffect(() => () => pollAbortRef.current?.abort(), []);

  const upload = useCallback(async () => {
    // Create + register the abort controller as the FIRST statement, before any await: if the
    // component unmounts DURING the capture POST (which happens before we'd otherwise reach the
    // poll), the unmount cleanup must see a live controller to abort. Otherwise the upload would
    // resume as a zombie and could router.push() a user who already navigated away (ghost nav).
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      const type = mediaRecorderRef.current?.mimeType ?? "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
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
      setPhase("processing");
      const outcome = await pollUntilReady({
        getStatus: async () => {
          const r = await fetch(
            `/api/capture/status?token=${encodeURIComponent(token)}&storyId=${encodeURIComponent(storyId)}`,
            { signal: controller.signal },
          );
          if (!r.ok) throw new Error(`status ${r.status}`);
          const j = (await r.json()) as { status?: "processing" | "ready" };
          if (j.status !== "processing" && j.status !== "ready") {
            throw new Error("malformed status");
          }
          return j.status;
        },
        signal: controller.signal,
      });
      // Guard every post-poll action on the live signal: an unmount that raced the final probe
      // must neither navigate nor set state on a dead component.
      if (controller.signal.aborted) return;
      if (outcome === "ready") {
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

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: pickMimeType() });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => void upload();
      mediaRecorderRef.current = mr;
      mr.start();
      setPhase("listening");
    } catch {
      setPhase("softfail");
    }
  }, [upload]);

  const finish = useCallback(() => {
    setPhase("saving");
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

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

  const onClick = phase === "listening" ? finish : phase === "idle" ? start : undefined;

  return (
    <KindredVoiceButton
      listening={phase === "listening"}
      saving={phase === "saving"}
      size={220}
      label={phase === "listening" ? common.voiceButton.listening : phase === "saving" ? common.voiceButton.oneMoment : common.voiceButton.tapToSpeak}
      onClick={onClick}
    />
  );
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
  if (typeof MediaRecorder !== "undefined") {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
  }
  return "audio/webm";
}
